const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

class FarmGenerator {
  constructor(csvPath, outputDir) {
    this.csvPath = csvPath;
    this.outputDir = outputDir;
    this.farms = [];
  }

  // Clean and format text fields
  cleanText(text) {
    if (!text || text === 'Unknown' || text === 'None') return '';
    return String(text).trim();
  }

  // Convert CSV categories to array format
  parseCategories(categoryString) {
    if (!categoryString) return [];
    return categoryString.split(',').map(cat => cat.trim().toLowerCase().replace(/\s+/g, '-'));
  }

  // Parse comma-separated values into array
  parseArray(arrayString) {
    if (!arrayString) return [];
    return arrayString.split(',').map(item => item.trim()).filter(item => item);
  }

  // Parse hours into structured format
  parseHours(row) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const hours = {};
    
    days.forEach(day => {
      const dayHours = this.cleanText(row[day]);
      if (dayHours && dayHours !== 'Closed') {
        hours[day.toLowerCase()] = dayHours;
      }
    });
    
    return hours;
  }

  // Generate slug from business name
  generateSlug(businessName) {
    return businessName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim('-');
  }

  // Convert CSV row to Hugo frontmatter
  convertToFrontmatter(row) {
    const frontmatter = {
      title: this.cleanText(row['Business Name']),
      slug: this.generateSlug(row['Business Name']),
      categories: this.parseCategories(row['Categories']),
      other_categories: this.cleanText(row['Other Categories']),
      established: this.cleanText(row['Established in']),
      opening_date: this.cleanText(row['Opening Date']),
      type: this.cleanText(row['Type']),
      amenities: this.parseArray(row['amenities']),
      varieties: this.parseArray(row['Varieties']),
      pet_friendly: row['Pet Friendly'] === 'TRUE',
      price_range: this.cleanText(row['Price Range']),
      payment_methods: this.parseArray(row['Payment Methods']),
      website: this.cleanText(row['website']),
      location_link: this.cleanText(row['location_link']),
      social: {
        facebook: this.cleanText(row['facebook']),
        instagram: this.cleanText(row['instagram']),
        linkedin: this.cleanText(row['linkedin']),
        youtube: this.cleanText(row['youtube'])
      },
      hours: this.parseHours(row),
      schema_hours: this.cleanText(row['Schema Hours (GENERATED']),
      other_specialities: this.cleanText(row['Other Specialities (Pumpkins, Sugar Shack, etc.)']),
      address: {
        street: this.cleanText(row['street']),
        city: this.cleanText(row['city']).replace(/\//g, '-'),
        postal_code: this.cleanText(row['postal_code']),
        province: this.cleanText(row['state']),
        country: this.cleanText(row['country'])
      },
      coordinates: {
        latitude: parseFloat(row['latitude']) || null,
        longitude: parseFloat(row['longitude']) || null
      },
      place_id: this.cleanText(row['place_id']),
      phone: this.cleanText(row['phone']),
      email: this.cleanText(row['email_1'])
    };

    // Clean up empty objects and arrays
    if (Object.keys(frontmatter.social).every(key => !frontmatter.social[key])) {
      delete frontmatter.social;
    }
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

  // Generate YAML frontmatter string
  generateYAML(data) {
    const yaml = require('js-yaml');
    return yaml.dump(data, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      quotingType: '"'
    });
  }

  // Create markdown file for a farm
  createFarmFile(farmData, description) {
    const slug = farmData.slug;
    const filename = `${slug}.md`;
    const filepath = path.join(this.outputDir, filename);

    const yamlContent = this.generateYAML(farmData);
    const markdownContent = `---\n${yamlContent}---\n\n${description || ''}\n`;

    fs.writeFileSync(filepath, markdownContent, 'utf8');
    console.log(`✓ Created: ${filename}`);
  }

  // Process CSV and generate all farm files
  async generateFarms() {
    console.log(`🚜 Starting farm generation from ${this.csvPath}`);
    
    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Clear existing farm files (except _index.md)
    const existingFiles = fs.readdirSync(this.outputDir)
      .filter(file => file.endsWith('.md') && file !== '_index.md');
    
    existingFiles.forEach(file => {
      fs.unlinkSync(path.join(this.outputDir, file));
    });
    console.log(`🗑️  Cleared ${existingFiles.length} existing farm files`);

    return new Promise((resolve, reject) => {
      const farms = [];
      
      fs.createReadStream(this.csvPath)
        .pipe(csv())
        .on('data', (row) => {
          try {
            const farmData = this.convertToFrontmatter(row);
            const description = this.cleanText(row['description']);
            farms.push({ farmData, description });
          } catch (error) {
            console.error(`Error processing row: ${row['Business Name']}`, error);
          }
        })
        .on('end', () => {
          try {
            // Generate farm files
            farms.forEach(farm => this.createFarmFile(farm.farmData, farm.description));
            
            console.log(`✅ Generated ${farms.length} farm files`);
            resolve(farms);
          } catch (error) {
            reject(error);
          }
        })
        .on('error', reject);
    });
  }
}

// Main execution
async function main() {
  const csvPath = path.join(__dirname, '..', '..', '..', '..', 'static', 'farms.csv');
  const outputDir = path.join(__dirname, '..', '..', '..', '..', 'content', 'farms');
  
  const generator = new FarmGenerator(csvPath, outputDir);
  
  try {
    await generator.generateFarms();
    console.log('🎉 Farm generation complete!');
  } catch (error) {
    console.error('❌ Error generating farms:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = FarmGenerator;
