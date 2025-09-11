const yaml = require('js-yaml');

class FarmWebhookHandler {
  constructor(config) {
    this.zohoClientId = config.zohoClientId;
    this.zohoClientSecret = config.zohoClientSecret;
    this.zohoRefreshToken = config.zohoRefreshToken;
    this.githubToken = config.githubToken;
    this.githubRepo = config.githubRepo;
    this.accessToken = null;
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

    const data = await response.json();
    
    if (!data.access_token) {
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

    const data = await response.json();
    
    if (!data.data || data.data.length === 0) {
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
      .trim('-');
  }

  parseCategories(categoryArray) {
    if (!categoryArray) return [];
    const categories = Array.isArray(categoryArray) ? categoryArray : [categoryArray];
    return categories.map(cat => 
      String(cat).trim().toLowerCase().replace(/\s+/g, '-')
    );
  }

  parseArray(arrayData) {
    if (!arrayData) return [];
    if (Array.isArray(arrayData)) {
      return arrayData.map(item => String(item).trim()).filter(item => item);
    }
    return String(arrayData).split(',').map(item => item.trim()).filter(item => item);
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
      quotingType: '"'
    });

    const description = account.Description || '';
    return `---\n${yamlContent}---\n\n${description}\n`;
  }

  async getGitHubFile(filepath) {
    try {
      console.log(`Checking if file exists: ${filepath}`);
      console.log(`GitHub API URL: https://api.github.com/repos/${this.githubRepo}/contents/${filepath}`);
      
      const response = await fetch(`https://api.github.com/repos/${this.githubRepo}/contents/${filepath}`, {
        headers: {
          'Authorization': `token ${this.githubToken}`,
          'User-Agent': 'Farm-Webhook-Handler'
        }
      });

      console.log(`GitHub file check response status: ${response.status}`);
      
      if (response.ok) {
        const result = await response.json();
        console.log(`File exists, SHA: ${result.sha}`);
        return result;
      }
      
      if (response.status === 404) {
        console.log('File does not exist (404) - will create new file');
        return null;
      }
      
      // Other error
      const errorData = await response.json();
      console.error(`GitHub file check error: ${response.status}`, errorData);
      return null;
      
    } catch (error) {
      console.error('Error checking GitHub file:', error.message);
      return null;
    }
  }

  async commitFileToGit(filepath, content, commitMessage) {
    console.log(`Starting GitHub commit process:`);
    console.log(`  Repository: ${this.githubRepo}`);
    console.log(`  File path: ${filepath}`);
    console.log(`  GitHub token starts with: ${this.githubToken.substring(0, 10)}...`);
    console.log(`  Commit message: ${commitMessage}`);
    
    // Check if file exists to get SHA
    const existingFile = await this.getGitHubFile(filepath);
    
    const requestBody = {
      message: commitMessage,
      content: btoa(unescape(encodeURIComponent(content)))
    };

    // Include SHA if updating existing file
    if (existingFile && existingFile.sha) {
      requestBody.sha = existingFile.sha;
      console.log(`Updating existing file with SHA: ${existingFile.sha}`);
    } else {
      console.log('Creating new file');
    }

    console.log(`Making GitHub API call to create/update file...`);
    
    const response = await fetch(`https://api.github.com/repos/${this.githubRepo}/contents/${filepath}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${this.githubToken}`,
        'User-Agent': 'Farm-Webhook-Handler',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    console.log(`GitHub commit response status: ${response.status}`);

    if (!response.ok) {
      const error = await response.json();
      console.error('GitHub commit error details:', error);
      throw new Error(`GitHub API error: ${error.message || 'Unknown error'}`);
    }

    const result = await response.json();
    console.log(`GitHub commit successful:`, result.commit.sha);
    return result;
  }

  async processRecord(accountId) {
    console.log(`\n=== Processing Zoho account: ${accountId} ===`);
    console.log(`Configuration check:`);
    console.log(`  Zoho Client ID: ${this.zohoClientId.substring(0, 10)}...`);
    console.log(`  GitHub repo: ${this.githubRepo}`);
    console.log(`  GitHub token configured: ${this.githubToken ? 'Yes' : 'No'}`);

    try {
      // Fetch account data from Zoho
      console.log(`\n--- Step 1: Fetching from Zoho CRM ---`);
      const account = await this.fetchAccountFromZoho(accountId);
      const businessName = account.Account_Name;

      console.log(`Successfully fetched farm: ${businessName}`);

      // Generate markdown content
      console.log(`\n--- Step 2: Generating markdown content ---`);
      const markdownContent = this.generateMarkdownContent(account);
      console.log(`Generated ${markdownContent.length} characters of markdown`);

      // Use record ID as filename for reliability
      const filepath = `content/farms/${accountId}.md`;
      const commitMessage = `Update farm: ${businessName} (${accountId})`;

      console.log(`\n--- Step 3: Committing to GitHub ---`);
      // Commit to GitHub
      await this.commitFileToGit(filepath, markdownContent, commitMessage);

      console.log(`\n=== SUCCESS: ${businessName} processed ===`);

      return {
        success: true,
        businessName,
        accountId,
        filepath,
        action: 'processed'
      };

    } catch (error) {
      console.error(`\n=== ERROR processing account ${accountId} ===`);
      console.error(`Error: ${error.message}`);
      console.error(`Stack: ${error.stack}`);
      throw error;
    }
  }
}

// Cloudflare Pages Function handler
exports.onRequest = async function(context) {
  const startTime = Date.now();
  
  try {
    console.log('\n========== WEBHOOK STARTED ==========');
    
    // Parse request
    const request = context.request;
    
    // Handle different HTTP methods
    if (request.method !== 'POST') {
      console.log(`Rejected ${request.method} request - only POST allowed`);
      return new Response('Method not allowed', { status: 405 });
    }

    // Parse JSON body
    const body = await request.json();
    console.log('Webhook payload received:', JSON.stringify(body, null, 2));

    // Extract record ID from various possible field names
    const accountId = body.recordId || body.accountId || body.id || body.record_id;
    
    if (!accountId) {
      console.error('Missing account ID in payload:', body);
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing account ID in webhook payload'
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`Processing account ID: ${accountId}`);

    // Validate environment variables
    const requiredEnvVars = ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_REPO'];
    const missingVars = requiredEnvVars.filter(varName => !context.env[varName]);
    
    if (missingVars.length > 0) {
      console.error('Missing environment variables:', missingVars);
      return new Response(JSON.stringify({
        success: false,
        error: `Missing environment variables: ${missingVars.join(', ')}`
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('All environment variables present');

    // Initialize handler
    const config = {
      zohoClientId: context.env.ZOHO_CLIENT_ID,
      zohoClientSecret: context.env.ZOHO_CLIENT_SECRET,
      zohoRefreshToken: context.env.ZOHO_REFRESH_TOKEN,
      githubToken: context.env.GITHUB_TOKEN,
      githubRepo: context.env.GITHUB_REPO
    };

    const handler = new FarmWebhookHandler(config);
    
    // Process the record
    const result = await handler.processRecord(accountId);
    
    const processingTime = Date.now() - startTime;
    console.log(`\n========== WEBHOOK COMPLETED (${processingTime}ms) ==========`);

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
    console.error(`\n========== WEBHOOK FAILED (${processingTime}ms) ==========`);
    console.error(`Error: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      processingTimeMs: processingTime
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};