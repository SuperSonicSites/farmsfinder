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

function generateCategoryStructure() {
  const farms = fs.readdirSync(farmsDir)
    .filter(file => file.endsWith('.md'))
    .map(file => {
      const content = fs.readFileSync(path.join(farmsDir, file), 'utf8');
      const frontmatter = content.split('---')[1];
      return yaml.load(frontmatter);
    });

  const structures = new Set();

  console.log(`Processing ${farms.length} farms...`);

  farms.forEach(farm => {
    // Updated to use nested address structure
    if (farm.categories && farm.address && farm.address.province && farm.address.city) {
      console.log(`Processing farm: ${farm.title} - ${farm.address.city}, ${farm.address.province}`);
      
      farm.categories
        .filter(category => category === 'christmas-tree')
        .forEach(category => {
        // Use the category name as-is for folder names
        const categoryFolder = category;
        const provinceFolder = farm.address.province.toLowerCase().replace(/\s+/g, '-');
        const cityFolder = farm.address.city.toLowerCase().replace(/\s+/g, '-').replace(/\//g, '-');

        // Add to structures set
        structures.add(`${categoryFolder}`);
        structures.add(`${categoryFolder}/${provinceFolder}`);
        structures.add(`${categoryFolder}/${provinceFolder}/${cityFolder}`);
        
        console.log(`  Added: ${categoryFolder}/${provinceFolder}/${cityFolder}`);
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
      // Category level - use formatTitle to handle hyphens properly
      createIndexFile(indexPath, formatTitle(parts[0]));
    } else if (parts.length === 2) {
      // Province level
      createIndexFile(indexPath, formatTitle(parts[1]));
    } else if (parts.length === 3) {
      // City level
      createIndexFile(indexPath, formatTitle(parts[2]));
    }
  });

  console.log('Category structure generation complete!');
}

generateCategoryStructure();
