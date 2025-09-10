const https = require('https');

class ZohoFieldInspector {
  constructor(clientId, clientSecret, refreshToken) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.accessToken = null;
  }

  // Get access token
  async getAccessToken() {
    const postData = `refresh_token=${this.refreshToken}&client_id=${this.clientId}&client_secret=${this.clientSecret}&grant_type=refresh_token`;
    
    const options = {
      hostname: 'accounts.zohocloud.ca',
      path: '/oauth/v2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': postData.length
      }
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.access_token) {
              this.accessToken = response.access_token;
              resolve(response.access_token);
            } else {
              reject(new Error('No access token received: ' + data));
            }
          } catch (error) {
            reject(error);
          }
        });
      });
      
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  // Get field metadata
  async getFieldMetadata() {
    if (!this.accessToken) {
      await this.getAccessToken();
    }

    const options = {
      hostname: 'www.zohoapis.ca',
      path: '/crm/v2/settings/fields?module=Accounts',
      method: 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    return this.makeRequest(options);
  }

  // Fetch sample accounts
  async getSampleAccounts() {
    if (!this.accessToken) {
      await this.getAccessToken();
    }

    const options = {
      hostname: 'www.zohoapis.ca',
      path: '/crm/v2/Accounts?per_page=3',
      method: 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    return this.makeRequest(options);
  }

  // Helper method to make HTTPS requests
  makeRequest(options) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            resolve(response);
          } catch (error) {
            reject(error);
          }
        });
      });
      
      req.on('error', reject);
      req.end();
    });
  }

  // Main inspection function
  async inspect() {
    try {
      console.log('🔍 Inspecting Zoho CRM structure...\n');

      // Get field metadata
      console.log('📋 Available Fields in Accounts module:');
      console.log('=====================================');
      const fields = await this.getFieldMetadata();
      
      if (fields.fields) {
        fields.fields.forEach(field => {
          console.log(`• ${field.field_label} (${field.api_name}) - ${field.data_type}`);
        });
      }

      console.log('\n📊 Sample Account Data:');
      console.log('=======================');
      
      // Get sample data
      const accounts = await this.getSampleAccounts();
      
      if (accounts.data && accounts.data.length > 0) {
        const sampleAccount = accounts.data[0];
        console.log('\nFirst account structure:');
        console.log(JSON.stringify(sampleAccount, null, 2));
        
        console.log('\n🗝️  Available field keys in your data:');
        Object.keys(sampleAccount).forEach(key => {
          console.log(`• ${key}: ${typeof sampleAccount[key]} = ${sampleAccount[key]}`);
        });
      } else {
        console.log('No accounts found in your CRM');
      }

    } catch (error) {
      console.error('❌ Error inspecting Zoho CRM:', error.message);
      if (error.message.includes('INVALID_TOKEN')) {
        console.log('💡 Try regenerating your refresh token');
      }
    }
  }
}

// Usage
async function main() {
  const inspector = new ZohoFieldInspector(
    process.env.ZOHO_CLIENT_ID || '1000.3SRIWU6TRFFBFDSECPZAK6771V45JC',
    process.env.ZOHO_CLIENT_SECRET || '449667604fcf4435fe38c50f2cb5b6969ebe88b076',
    process.env.ZOHO_REFRESH_TOKEN || '1000.a76e108c85d35ba4114ae2bb5d03138d.2cf2b5d26446793d6afd2afb26f279ab'
  );
  
  await inspector.inspect();
}

if (require.main === module) {
  main();
}

module.exports = ZohoFieldInspector;