import yaml from 'js-yaml';

class FarmWebhookHandler {
  constructor(config) {
    this.zohoClientId = config.zohoClientId;
    this.zohoClientSecret = config.zohoClientSecret;
    this.zohoRefreshToken = config.zohoRefreshToken;
    this.githubToken = config.githubToken;
    this.githubRepo = config.githubRepo;
    this.accessToken = null;
    
    // Debug logging
    console.log('Handler initialized with repo:', this.githubRepo);
    console.log('GitHub token present:', !!this.githubToken);
    console.log('Token length:', this.githubToken ? this.githubToken.length : 0);
  }

  async getZohoAccessToken() {
    const body = new URLSearchParams({
      refresh_token: this.zohoRefreshToken,
      client_id: this.zohoClientId,
      client_secret: this.zohoClientSecret,
      grant_type: 'refresh_token'
    });

    const response = await fetch('https://accounts.zohocloud.ca/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    console.log('Zoho auth response status:', response.status);
    const data = await response.json();
    
    if (!data.access_token) {
      console.error('Zoho auth failed:', JSON.stringify(data));
      throw new Error(`Zoho auth failed: ${JSON.stringify(data)}`);
    }

    this.accessToken = data.access_token;
    return data.access_token;
  }

  async fetchAccountFromZoho(accountId) {
    if (!this.accessToken) {
      await this.getZohoAccessToken();
    }

    const response = await fetch(`https://www.zohoapis.ca/crm/v2/Accounts/${accountId}`, {
      headers: {
        'Authorization': `Zoho-oauthtoken ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Zoho fetch response status:', response.status);
    const data = await response.json();
    
    if (!data.data || data.data.length === 0) {
      console.error('Account not found:', accountId);
      throw new Error(`Account ${accountId} not found in Zoho`);
    }

    return data.data[0];
  }

  generateSlug(businessName) {
    if (!businessName) return '';
    return businessName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, ''); // Fixed trim syntax
  }

  parseCategories(categoryArray) {
    if (!categoryArray) return [];
    
    let categories;
    
    // Handle different data types from Zoho (same logic as parseArray)
    if (Array.isArray(categoryArray)) {
      // If it's already an array, process each item and split any comma-separated values
      categories = categoryArray.flatMap(item => 
        String(item).split(',').map(subItem => subItem.trim()).filter(subItem => subItem)
      );
    } else if (typeof categoryArray === 'object' && categoryArray !== null) {
      // If it's an object (common from Zoho), convert to string and split
      const stringValue = String(categoryArray);
      categories = stringValue.split(',').map(item => item.trim()).filter(item => item);
    } else {
      // If it's a string, split by comma and trim each item
      categories = String(categoryArray).split(',').map(item => item.trim()).filter(item => item);
    }
    
    // Convert to lowercase and replace spaces with hyphens
    return categories.map(cat => 
      cat.toLowerCase().replace(/\s+/g, '-')
    );
  }

  parseArray(arrayData) {
    if (!arrayData) return [];
    
    let result;
    
    // Handle different data types from Zoho
    if (Array.isArray(arrayData)) {
      // If it's already an array, process each item and split any comma-separated values
      result = arrayData.flatMap(item => 
        String(item).split(',').map(subItem => subItem.trim()).filter(subItem => subItem)
      );
    } else if (typeof arrayData === 'object' && arrayData !== null) {
      // If it's an object (common from Zoho), convert to string and split
      const stringValue = String(arrayData);
      result = stringValue.split(',').map(item => item.trim()).filter(item => item);
    } else {
      // If it's a string, split by comma and trim each item
      result = String(arrayData).split(',').map(item => item.trim()).filter(item => item);
    }
    
    // Debug logging
    console.log('parseArray input type:', typeof arrayData);
    console.log('parseArray input:', arrayData);
    console.log('parseArray output:', result);
    
    return result;
  }

  parseHours(account) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const hours = {};
    
    days.forEach(day => {
      const dayHours = account[day];
      if (dayHours && dayHours !== 'Closed' && dayHours.trim() !== '') {
        hours[day.toLowerCase()] = dayHours;
      }
    });
    
    return hours;
  }

  convertToFrontmatter(account) {
    const frontmatter = {
      title: account.Account_Name || '',
      slug: this.generateSlug(account.Account_Name || ''),
      zoho_id: account.id,
      categories: this.parseCategories(account.Type_of_Farm),
      type: this.parseArray(account.Services_Type).join(', '),
      established: account.Year_Established || '',
      opening_date: account.Open_Date || '',
      closing_date: account.Close_Date || '',
      amenities: this.parseArray(account.Amenities),
      varieties: this.parseArray(account.Varieties),
      pet_friendly: account.Pet_Friendly === 'TRUE',
      price_range: account.Price_Range || '',
      payment_methods: this.parseArray(account.Payment_Methods),
      website: account.Website || '',
      location_link: account.Google_My_Business || '',
      hours: this.parseHours(account),
      schema_hours: account.Schema_Hours || '',
      address: {
        street: account.Billing_Street || '',
        city: account.Billing_City || '',
        postal_code: account.Billing_Code || '',
        province: account.Billing_State || '',
        country: account.Billing_Country || ''
      },
      coordinates: {
        latitude: parseFloat(account.latitude) || null,
        longitude: parseFloat(account.longitude) || null
      },
      place_id: account.PlaceID || '',
      phone: account.Phone || '',
      email: account.Email || '',
      status: 'active'
    };

    // Add social media if present
    const social = {};
    if (account.Facebook) social.facebook = account.Facebook;
    if (account.Instagram) social.instagram = account.Instagram;
    if (Object.keys(social).length > 0) {
      frontmatter.social = social;
    }

    // Clean up empty objects
    if (Object.keys(frontmatter.hours).length === 0) {
      delete frontmatter.hours;
    }
    if (!frontmatter.coordinates.latitude && !frontmatter.coordinates.longitude) {
      delete frontmatter.coordinates;
    }
    if (frontmatter.amenities.length === 0) {
      delete frontmatter.amenities;
    }
    if (frontmatter.varieties.length === 0) {
      delete frontmatter.varieties;
    }
    if (frontmatter.payment_methods.length === 0) {
      delete frontmatter.payment_methods;
    }

    return frontmatter;
  }

  generateMarkdownContent(account) {
    const frontmatter = this.convertToFrontmatter(account);
    
    const yamlContent = yaml.dump(frontmatter, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
      flowLevel: 2,
      forceQuotes: false,
      styles: {
        '!!seq': 'flow'
      }
    });

    const description = account.Description || '';
    return `---\n${yamlContent}---\n\n${description}\n`;
  }

  async getGitHubFile(filepath) {
    try {
      const url = `https://api.github.com/repos/${this.githubRepo}/contents/${filepath}`;
      console.log('Checking for existing file at:', url);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `token ${this.githubToken}`,
          'User-Agent': 'Farm-Webhook-Handler'
        }
      });

      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (error) {
      console.log('File does not exist (this is normal for new files)');
      return null;
    }
  }

  async commitFileToGit(filepath, content, commitMessage) {
    // Check if file exists to get SHA
    const existingFile = await this.getGitHubFile(filepath);
    
    const requestBody = {
      message: commitMessage,
      content: btoa(unescape(encodeURIComponent(content)))
    };

    // Include SHA if updating existing file
    if (existingFile && existingFile.sha) {
      requestBody.sha = existingFile.sha;
      console.log('Updating existing file with SHA:', existingFile.sha);
    } else {
      console.log('Creating new file');
    }

    const url = `https://api.github.com/repos/${this.githubRepo}/contents/${filepath}`;
    console.log('Committing to:', url);
    console.log('Using repo:', this.githubRepo);
    console.log('Token present:', !!this.githubToken);
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${this.githubToken}`,
        'User-Agent': 'Farm-Webhook-Handler',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    console.log('GitHub API response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('GitHub API full error:', errorText);
      console.error('Request URL was:', url);
      console.error('Repo value was:', this.githubRepo);
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    return await response.json();
  }

  async processRecord(accountId) {
    console.log(`Processing Zoho account: ${accountId}`);

    try {
      // Fetch account data from Zoho
      const account = await this.fetchAccountFromZoho(accountId);
      const businessName = account.Account_Name;

      console.log(`Processing farm: ${businessName}`);

      // Generate markdown content
      const markdownContent = this.generateMarkdownContent(account);

      // Use record ID as filename for reliability
      const filepath = `content/farms/${accountId}.md`;
      const commitMessage = `Update farm: ${businessName} (${accountId})`;

      // Commit to GitHub
      await this.commitFileToGit(filepath, markdownContent, commitMessage);

      console.log(`Successfully processed: ${businessName} -> ${filepath}`);

      return {
        success: true,
        businessName,
        accountId,
        filepath,
        action: 'processed'
      };

    } catch (error) {
      console.error(`Error processing account ${accountId}:`, error.message);
      throw error;
    }
  }
}

// Cloudflare Pages Function handler
export async function onRequest(context) {
  const startTime = Date.now();
  
  try {
    // Parse request
    const request = context.request;
    
    // Handle different HTTP methods
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Parse JSON body
    const body = await request.json();
    console.log('Webhook received:', JSON.stringify(body));

    // DEBUG MODE - Check environment variables
    if (body.debug === true) {
      return new Response(JSON.stringify({
        env_check: {
          has_github_token: !!context.env.GITHUB_TOKEN,
          github_token_length: context.env.GITHUB_TOKEN ? context.env.GITHUB_TOKEN.length : 0,
          github_token_starts: context.env.GITHUB_TOKEN ? context.env.GITHUB_TOKEN.substring(0, 10) + '...' : 'NOT_SET',
          github_repo: context.env.GITHUB_REPO || 'NOT_SET',
          has_zoho_client_id: !!context.env.ZOHO_CLIENT_ID,
          has_zoho_secret: !!context.env.ZOHO_CLIENT_SECRET,
          has_zoho_token: !!context.env.ZOHO_REFRESH_TOKEN,
          all_env_keys: Object.keys(context.env)
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // TEST MODE - Test GitHub connection directly
    if (body.test_github === true) {
      const testUrl = `https://api.github.com/repos/${context.env.GITHUB_REPO}`;
      const testResponse = await fetch(testUrl, {
        headers: {
          'Authorization': `token ${context.env.GITHUB_TOKEN}`,
          'User-Agent': 'Farm-Webhook-Test'
        }
      });
      
      return new Response(JSON.stringify({
        github_test: {
          url_tested: testUrl,
          status: testResponse.status,
          success: testResponse.ok,
          repo_value: context.env.GITHUB_REPO
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Extract record ID from various possible field names
    const accountId = body.recordId || body.accountId || body.id || body.record_id;
    
    if (!accountId) {
      console.error('Missing account ID in payload:', body);
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing account ID in webhook payload',
        received_fields: Object.keys(body)
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate environment variables
    const requiredEnvVars = ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_REPO'];
    const missingVars = requiredEnvVars.filter(varName => !context.env[varName]);
    
    if (missingVars.length > 0) {
      console.error('Missing environment variables:', missingVars);
      return new Response(JSON.stringify({
        success: false,
        error: `Missing environment variables: ${missingVars.join(', ')}`,
        debug: {
          required: requiredEnvVars,
          missing: missingVars,
          present: requiredEnvVars.filter(v => context.env[v])
        }
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Initialize handler
    const config = {
      zohoClientId: context.env.ZOHO_CLIENT_ID,
      zohoClientSecret: context.env.ZOHO_CLIENT_SECRET,
      zohoRefreshToken: context.env.ZOHO_REFRESH_TOKEN,
      githubToken: context.env.GITHUB_TOKEN,
      githubRepo: context.env.GITHUB_REPO
    };

    console.log('Config initialized with repo:', config.githubRepo);

    const handler = new FarmWebhookHandler(config);
    
    // Process the record
    const result = await handler.processRecord(accountId);
    
    const processingTime = Date.now() - startTime;
    console.log(`Webhook completed in ${processingTime}ms:`, result);

    return new Response(JSON.stringify({
      success: true,
      message: `Successfully processed ${result.businessName}`,
      data: {
        accountId: result.accountId,
        businessName: result.businessName,
        filepath: result.filepath,
        processingTimeMs: processingTime
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`Webhook failed after ${processingTime}ms:`, error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      stack: error.stack,
      processingTimeMs: processingTime
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}