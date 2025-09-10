const fs = require('fs');
const path = require('path');
const https = require('https');

class ZohoToCSV {
  constructor(clientId, clientSecret, refreshToken, outputPath) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.outputPath = outputPath;
    this.accessToken = null;
  }

  async getAccessToken() {
    console.log('🔐 Getting access token...');
    
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
              console.log('✅ Access token obtained');
              resolve(response.access_token);
            } else {
              reject(new Error('Authentication failed: ' + data));
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

  async fetchAccounts() {
    if (!this.accessToken) {
      await this.getAccessToken();
    }

    console.log('📊 Fetching accounts from Zoho CRM...');

    const options = {
      hostname: 'www.zohoapis.ca',
      path: '/crm/v2/Accounts?per_page=200',
      method: 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.data) {
              console.log(`✅ Fetched ${response.data.length} accounts`);
              resolve(response.data);
            } else {
              reject(new Error('No data received: ' + data));
            }
          } catch (error) {
            reject(error);
          }
        });
      });
      
      req.on('error', reject);
      req.end();
    });
  }

  // Convert Zoho account to CSV row (exact same fields as your original CSV)
  accountToCSVRow(account) {
    const arrayToString = (arr) => {
      if (!arr) return '';
      if (Array.isArray(arr)) return arr.join(', ');
      return String(arr);
    };

    return {
      'Business Name': account.Account_Name || '',
      'Categories': arrayToString(account.Type_of_Farm),
      'Other Categories': arrayToString(account.Services_Type),
      'Established in': account.Year_Established || '',
      'Opening Date': account.Open_Date || '',
      'Type': arrayToString(account.Type_of_Farm),
      'amenities': arrayToString(account.Amenities),
      'Varieties': arrayToString(account.Varieties),
      'Pet Friendly': account.Pet_Friendly || 'FALSE',
      'Price Range': account.Price_Range || '',
      'Payment Methods': arrayToString(account.Payment_Methods),
      'website': account.Website || '',
      'location_link': account.Google_My_Business || '',
      'facebook': account.Facebook || '',
      'instagram': account.Instagram || '',
      'linkedin': '',
      'youtube': '',
      'Sunday': account.Sunday || 'Closed',
      'Monday': account.Monday || 'Closed',
      'Tuesday': account.Tuesday || 'Closed',
      'Wednesday': account.Wednesday || 'Closed',
      'Thursday': account.Thursday || 'Closed',
      'Friday': account.Friday || 'Closed',
      'Saturday': account.Saturday || 'Closed',
      'Schema Hours (GENERATED': account.Schema_Hours || '',
      'Other Specialities (Pumpkins, Sugar Shack, etc.)': '',
      'street': account.Billing_Street || '',
      'city': account.Billing_City || '', // This should be actual city name, not coordinates
      'postal_code': account.Billing_Code || '',
      'state': account.Billing_State || '',
      'country': account.Billing_Country || '',
      'latitude': account.latitude || '',
      'longitude': account.longitude || '',
      'place_id': account.PlaceID || '',
      'phone': account.Phone || '',
      'email_1': account.Email || '',
      'description': account.Description || ''
    };
  }

  // Convert array of accounts to CSV string
  generateCSV(accounts) {
    if (accounts.length === 0) return '';
    
    // Define the exact column order to match your CORRECT CSV
    const headers = [
      'Business Name',
      'Categories', 
      'Type',
      'Established in',
      'Opening Date',
      'amenities',
      'Varieties',
      'Pet Friendly',
      'Price Range',
      'Payment Methods',
      'website',
      'location_link',
      'facebook',
      'instagram',
      'linkedin',
      'youtube',
      'Sunday',
      'Monday', 
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Schema Hours (GENERATED',
      'Other Specialities (Pumpkins',
      'street',
      'city',
      'postal_code',
      'state',
      'country',
      'latitude',
      'longitude',
      'place_id',
      'phone',
      'email_1',
      'description'
    ];
    
    const rows = accounts.map(account => this.accountToCSVRow(account));
    
    // Create CSV content with fixed headers
    let csv = headers.join(',') + '\n';
    
    rows.forEach(row => {
      const values = headers.map(header => {
        const value = (row[header] || '').toString();
        // Escape values with commas, quotes, or newlines
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      });
      csv += values.join(',') + '\n';
    });
    
    return csv;
  }

  // Main sync function
  async sync() {
    try {
      console.log('🚀 Starting Zoho CRM to CSV sync...\n');
      
      const accounts = await this.fetchAccounts();
      
      if (accounts.length === 0) {
        console.log('⚠️  No accounts found');
        return;
      }

      console.log('📝 Converting to CSV...');
      const csv = this.generateCSV(accounts);
      
      // Ensure output directory exists
      const dir = path.dirname(this.outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Write CSV file
      fs.writeFileSync(this.outputPath, csv, 'utf8');
      
      console.log(`✅ CSV saved: ${this.outputPath}`);
      console.log(`📊 Processed ${accounts.length} accounts`);
      console.log('\n🎉 Sync complete!');
      
    } catch (error) {
      console.error('❌ Sync failed:', error.message);
      throw error;
    }
  }
}

// Main execution
async function main() {
  const config = {
    clientId: process.env.ZOHO_CLIENT_ID || '1000.3SRIWU6TRFFBFDSECPZAK6771V45JC',
    clientSecret: process.env.ZOHO_CLIENT_SECRET || '449667604fcf4435fe38c50f2cb5b6969ebe88b076',
    refreshToken: process.env.ZOHO_REFRESH_TOKEN || '1000.a76e108c85d35ba4114ae2bb5d03138d.2cf2b5d26446793d6afd2afb26f279ab',
    outputPath: path.join(__dirname, '..', '..', '..', '..', 'static', 'farms.csv')
  };

  const syncer = new ZohoToCSV(
    config.clientId,
    config.clientSecret, 
    config.refreshToken,
    config.outputPath
  );
  
  await syncer.sync();
}

if (require.main === module) {
  main();
}

module.exports = ZohoToCSV;