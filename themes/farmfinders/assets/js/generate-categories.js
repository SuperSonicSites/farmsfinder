const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Read all farm files
const farmsDir = './content/farms';
const contentDir = './content';

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dirPath}`);
  }
}

function formatTitle(text) {
  // Convert hyphens to spaces and capitalize each word
  return text.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function createIndexFile(filePath, title) {
  if (!fs.existsSync(filePath)) {
    const content = `---
title: "${title}"
---
`;
    fs.writeFileSync(filePath, content);
    console.log(`Created: ${filePath}`);
  }
}

function createCityPage(filePath, city, province, category) {
  const cityTitle = formatTitle(city);
  const provinceTitle = formatTitle(province);
  const categoryTitle = formatTitle(category);
  
  const content = `---
title: "${cityTitle} ${categoryTitle} Farms"
description: "Find the best ${categoryTitle} farms in ${cityTitle}, ${provinceTitle}. Discover local farms, their offerings, and plan your visit."
layout: section
category: ${category}
province: ${province}
city: ${city}
---

# ${cityTitle} ${categoryTitle} Farms

Discover the best ${categoryTitle} farms in ${cityTitle}, ${provinceTitle}. Explore local farms, their unique offerings, and plan your visit today.

## Featured Farms in ${cityTitle}

<!-- Farm listings will be automatically generated here -->
`;

  fs.writeFileSync(filePath, content);
  console.log(`Created city page: ${filePath}`);
}

function generateCategoryStructure() {
  const farms = fs.readdirSync(farmsDir)
    .filter(file => file.endsWith('.md'))
    .map(file => {
      const content = fs.readFileSync(path.join(farmsDir, file), 'utf8');
      const frontmatter = content.split('---')[1];
      return { 
        ...yaml.load(frontmatter),
        _file: file
      };
    });

  const structures = new Set();
  const cityFarms = new Map(); // Track farms by city

  console.log(`Processing ${farms.length} farms...`);

  // First pass: collect all structures and organize farms by city
  farms.forEach(farm => {
    if (farm.categories && farm.address && farm.address.province && farm.address.city) {
      console.log(`Processing farm: ${farm.title} - ${farm.address.city}, ${farm.address.province}`);
      
      farm.categories.forEach(category => {
        const categoryFolder = category;
        const provinceFolder = farm.address.province.toLowerCase().replace(/\s+/g, '-');
        const cityFolder = farm.address.city.toLowerCase().replace(/\s+/g, '-').replace(/\//g, '-');
        const cityKey = `${category}/${provinceFolder}/${cityFolder}`;

        // Add to structures set
        structures.add(categoryFolder);
        structures.add(`${categoryFolder}/${provinceFolder}`);
        structures.add(cityKey);
        
        // Add farm to city's farm list
        if (!cityFarms.has(cityKey)) {
          cityFarms.set(cityKey, []);
        }
        cityFarms.get(cityKey).push(farm);
        
        console.log(`  Added to: ${cityKey}`);
      });
    } else {
      console.log(`Skipping farm: ${farm.title || 'Unknown'} - missing required data`);
      if (!farm.categories) console.log(`    Missing categories`);
      if (!farm.address) console.log(`    Missing address object`);
      if (farm.address && !farm.address.province) console.log(`    Missing address.province`);
      if (farm.address && !farm.address.city) console.log(`    Missing address.city`);
    }
  });

  console.log(`\nGenerated ${structures.size} unique structures:`);
  structures.forEach(structure => console.log(`  ${structure}`));

  // Create directories and index files
  structures.forEach(structure => {
    const parts = structure.split('/');
    const dirPath = path.join(contentDir, structure);
    const indexPath = path.join(dirPath, '_index.md');

    ensureDirectoryExists(dirPath);

    if (parts.length === 1) {
      // Category level
      createIndexFile(indexPath, formatTitle(parts[0]));
    } else if (parts.length === 2) {
      // Province level
      createIndexFile(indexPath, `${formatTitle(parts[1])} ${formatTitle(parts[0])} Farms`);
    } else if (parts.length === 3) {
      // City level - create a more detailed page
      const cityKey = structure;
      const [category, province, city] = parts;
      createCityPage(indexPath, city, province, category);
    }
  });

  console.log('Category structure generation complete!');
}

generateCategoryStructure();
