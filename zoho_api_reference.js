// /functions/zoho.js
// Zoho → Cloudflare Pages Function webhook
// - Auth via Bearer ZOHO_WEBHOOK_TOKEN
// - Robust payload parsing (Zoho CRM + Flow; JSON or form-encoded)
// - Slugify Account_Name (stable, collision-safe)
// - Upsert by zoho_id (Zoho "id") into D1
// - Detect structural changes (slug, city, province, lat/lon, place_id, Type_of_Farm, Services_Type)
// - On structural change: (a) optional GitHub front-matter update, (b) optional rebuild trigger

const MD_PATH_PREFIX = "content/farms"; // adjust to your repo structure, e.g. "site/content/farms"

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // --- Auth ---
  const auth = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return new Response("Forbidden", { status: 403 });
  const token = auth.slice("Bearer ".length).trim();
  if (!env.ZOHO_WEBHOOK_TOKEN || token !== env.ZOHO_WEBHOOK_TOKEN) {
    return new Response("Forbidden", { status: 403 });
  }

  // --- Parse body (JSON or x-www-form-urlencoded with JSON payload) ---
  const ctype = (request.headers.get("content-type") || "").toLowerCase();
  let raw;
  try {
    if (ctype.includes("application/json") || ctype.includes("text/json")) {
      raw = await request.json();
    } else if (ctype.includes("application/x-www-form-urlencoded")) {
      const text = await request.text();
      const params = new URLSearchParams(text);
      const payload = params.get("payload") || params.get("data");
      raw = payload ? JSON.parse(payload) : Object.fromEntries(params.entries());
    } else {
      // try JSON first, then raw text->JSON
      try { raw = await request.json(); }
      catch {
        const t = await request.text();
        try { raw = JSON.parse(t); } catch { raw = { _raw: t }; }
      }
    }
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  // Unwrap Zoho CRM style { data: [ { ...record... } ] }
  const rec = (Array.isArray(raw?.data) && raw.data.length) ? raw.data[0] : raw;

  // --- helpers ---
  const slugify = (s) => (s || "")
    .toString().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").replace(/--+/g, "-");

  const truthy = (v) => typeof v === "boolean" ? v :
    (typeof v === "number" ? v !== 0 :
      (typeof v === "string" ? ["true","yes","1","y"].includes(v.trim().toLowerCase()) : false));

  const arr = (x) => (!x ? [] : Array.isArray(x) ? x : [x]);
  const num = (x) => (x == null || x === "" ? null : Number(x));

  // --- Required IDs & canonical fields (use your exact Zoho keys) ---
  const zoho_id = (rec.id ?? "").toString().trim();
  if (!zoho_id) return new Response("Missing id", { status: 400 });

  const accountName = (rec.Account_Name ?? rec.Name ?? "").toString().trim();
  if (!accountName) return new Response("Missing Account_Name", { status: 400 });

  const desiredSlug = slugify(accountName);

  // Structural fields
  const city     = (rec.Billing_City  ?? "").toString().trim();
  const province = (rec.Billing_State ?? "").toString().trim();
  const latitude  = num(rec.latitude);
  const longitude = num(rec.longitude);
  const place_id  = (rec.PlaceID ?? "").toString().trim();
  const types     = arr(rec.Type_of_Farm);   // structural
  const services  = arr(rec.Services_Type);  // treat as structural if it affects static pages

  // Non-structural (live via D1)
  const phone        = (rec.Phone        ?? "").toString().trim();
  const email        = (rec.Email        ?? "").toString().trim();
  const price_range  = (rec.Price_Range  ?? "").toString().trim();
  const opening_date = rec.Open_Date ?? "";
  const closing_date = rec.Close_Day ?? "";
  const established  = (rec.Year_Established ?? "").toString().trim();

  const website   = rec.Website ?? "";
  const facebook  = rec.Facebook ?? "";
  const instagram = rec.Instagram ?? "";
  const gmb       = rec.Google_My_Business ?? "";
  const location_link = gmb || (rec.FarmsFinder_Profile_URL ?? "");

  const pet_friendly = truthy(rec.Pet_Friendly);
  const description  = rec.Description ?? "";

  const amenities       = arr(rec.Amenities);
  const varieties       = arr(rec.Varieties);
  const payment_methods = arr(rec.Payment_Methods);

  const hours = {
    monday:    rec.Monday    ?? "",
    tuesday:   rec.Tuesday   ?? "",
    wednesday: rec.Wednesday ?? "",
    thursday:  rec.Thursday  ?? "",
    friday:    rec.Friday    ?? "",
    saturday:  rec.Saturday  ?? "",
    sunday:    rec.Sunday    ?? "",
  };

  // --- Slug stability & uniqueness ---
  // Prefer existing slug for same zoho_id
  let existingById = await env.FARMS_DB
    .prepare("SELECT slug, details FROM farm_data WHERE zoho_id = ?")
    .bind(zoho_id)
    .first();

  let slug = existingById?.slug || desiredSlug;

  // Disambiguate if slug is used by another record
  const clash = await env.FARMS_DB.prepare("SELECT zoho_id FROM farm_data WHERE slug = ?").bind(slug).first();
  if (clash && clash.zoho_id !== zoho_id) {
    const attempt = city ? `${desiredSlug}-${slugify(city)}` : desiredSlug;
    const clash2 = await env.FARMS_DB.prepare("SELECT zoho_id FROM farm_data WHERE slug = ?").bind(attempt).first();
    slug = (clash2 && clash2.zoho_id !== zoho_id) ? `${desiredSlug}-${zoho_id.slice(-6)}` : attempt;
  }

  // --- Structural snapshot (for diff) ---
  const newStructural = { slug, city, province, latitude, longitude, place_id, types, services };

  let oldStructural;
  if (existingById?.details) {
    try { oldStructural = JSON.parse(existingById.details)?.structural_snapshot; } catch {}
  }
  const structuralChanged = JSON.stringify(oldStructural || null) !== JSON.stringify(newStructural);

  // --- details blob (for compatibility / SEO helpers / next compare) ---
  const detailsObj = {
    hours, amenities, varieties, payment_methods,
    social: { facebook, instagram },
    services, types,
    website, place_id, location_link,
    opening_date, closing_date, established,
    description,
    structural_snapshot: newStructural,
  };

  // --- Upsert by zoho_id (PK) into D1 ---
  const sql = `
    INSERT INTO farm_data (
      zoho_id, slug, phone, email, price_range, details, updated_at,
      established, opening_date, closing_date,
      website, location_link,
      hours_json, amenities_json, varieties_json, payment_methods_json, social_json,
      pet_friendly
    )
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP,
            ?, ?, ?,
            ?, ?,
            ?, ?, ?, ?, ?,
            ?)
    ON CONFLICT(zoho_id) DO UPDATE SET
      slug        = excluded.slug,
      phone       = excluded.phone,
      email       = excluded.email,
      price_range = excluded.price_range,
      details     = excluded.details,
      updated_at  = CURRENT_TIMESTAMP,
      established = excluded.established,
      opening_date= excluded.opening_date,
      closing_date= excluded.closing_date,
      website     = excluded.website,
      location_link = excluded.location_link,
      hours_json  = excluded.hours_json,
      amenities_json = excluded.amenities_json,
      varieties_json = excluded.varieties_json,
      payment_methods_json = excluded.payment_methods_json,
      social_json = excluded.social_json,
      pet_friendly = excluded.pet_friendly
  `;

  await env.FARMS_DB.prepare(sql).bind(
    zoho_id, slug, phone, email, price_range, JSON.stringify(detailsObj),
    established, opening_date, closing_date,
    website, location_link,
    JSON.stringify(hours), JSON.stringify(amenities), JSON.stringify(varieties), JSON.stringify(payment_methods), JSON.stringify({ facebook, instagram }),
    pet_friendly ? 1 : 0
  ).run();

  // --- On structural change: (a) update Markdown front-matter (optional), (b) trigger rebuild (optional) ---
  let frontMatterUpdated = false;
  if (structuralChanged && env.GH_TOKEN && env.GH_OWNER && env.GH_REPO) {
    try {
      const fm = buildFrontMatter({
        title: accountName,
        slug,
        zoho_id,
        categories: types,
        address: {
          street: rec.Billing_Street ?? "",
          city, province,
          postal_code: rec.Billing_Code ?? "",
          country: rec.Billing_Country ?? ""
        },
        coordinates: { latitude, longitude },
        place_id,
        status: "active"
      });

      const mdPath = `${MD_PATH_PREFIX}/${slug}/index.md`; // e.g. content/farms/my-farm/index.md
      frontMatterUpdated = await upsertMarkdownFile(env, mdPath, fm);
    } catch (e) {
      console.log("front-matter update failed:", e?.message || e);
    }
  }

  let rebuildTriggered = false;
  if (structuralChanged) {
    rebuildTriggered = await triggerRebuild(env, { slug, city, province });
  }

  return Response.json({
    ok: true,
    zoho_id,
    slug,
    action: structuralChanged ? "structural_change" : "content_update",
    structuralChanged,
    frontMatterUpdated,
    rebuildTriggered
  }, { headers: { "Cache-Control": "no-store" } });
}

/* ---------------- helpers: rebuild trigger + GitHub front-matter write ---------------- */

async function triggerRebuild(env, payload) {
  try {
    if (env.PAGES_DEPLOY_HOOK_URL) {
      const res = await fetch(env.PAGES_DEPLOY_HOOK_URL, { method: "POST" });
      return res.ok;
    }
    if (env.GH_TOKEN && env.GH_OWNER && env.GH_REPO) {
      const branch = env.GH_BRANCH || "main";
      const r = await fetch(`https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/dispatches`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.GH_TOKEN}`,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: "structural_change",
          client_payload: { ...payload, reason: "zoho_structural_change", branch }
        })
      });
      return r.ok;
    }
  } catch (e) {
    console.log("rebuild trigger error:", e?.message || e);
  }
  return false;
}

function buildFrontMatter(data) {
  // Minimal structural front-matter for Hugo
  const {
    title, slug, zoho_id, categories = [],
    address = {}, coordinates = {}, place_id = "", status = "active"
  } = data;

  const esc = (s) => String(s ?? "").replace(/"/g, '\\"');

  const lines = [];
  lines.push("---");
  lines.push(`title: "${esc(title)}"`);
  lines.push(`slug: ${slug}`);
  lines.push(`zoho_id: "${esc(zoho_id)}"`);
  lines.push("categories:");
  for (const c of categories) lines.push(`  - ${c}`);
  lines.push("address:");
  lines.push(`  street: "${esc(address.street)}"`);
  lines.push(`  city: "${esc(address.city)}"`);
  lines.push(`  postal_code: "${esc(address.postal_code)}"`);
  lines.push(`  province: "${esc(address.province)}"`);
  lines.push(`  country: "${esc(address.country)}"`);
  lines.push("coordinates:");
  lines.push(`  latitude: ${coordinates.latitude ?? ""}`);
  lines.push(`  longitude: ${coordinates.longitude ?? ""}`);
  lines.push(`place_id: ${place_id}`);
  lines.push(`status: ${status}`);
  lines.push("---");
  lines.push(""); // ensure trailing newline
  return lines.join("\n");
}

async function upsertMarkdownFile(env, path, frontMatterYAML) {
  const base = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${encodeURIComponent(path)}`;
  const branch = env.GH_BRANCH || "main";
  const headers = {
    "Authorization": `Bearer ${env.GH_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  // 1) Get existing file (to obtain sha)
  let sha = null;
  let getRes = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, { headers });
  if (getRes.status === 200) {
    const json = await getRes.json();
    sha = json.sha;
  } else if (getRes.status !== 404) {
    // unexpected
    const txt = await getRes.text();
    console.log("GET content error:", getRes.status, txt);
  }

  // 2) Put new content (base64-encoded)
  const msg = sha ? `chore: update farm front-matter (${path})` : `feat: add farm front-matter (${path})`;
  const b64 = btoa(unescape(encodeURIComponent(frontMatterYAML)));

  const body = {
    message: msg,
    content: b64,
    branch,
  };
  if (sha) body.sha = sha;

  const putRes = await fetch(base, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  if (!putRes.ok) {
    const t = await putRes.text();
    console.log("PUT content error:", putRes.status, t);
  }
  return putRes.ok;
}
