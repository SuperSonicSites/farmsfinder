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

  farms.forEach(farm => {
    if (farm.categories && farm.province && farm.city) {
      farm.categories.forEach(category => {
        // Use the category name as-is for folder names (with spaces)
        const categoryFolder = category;
        const provinceFolder = farm.province;
        const cityFolder = farm.city;

        // Add to structures set
        structures.add(`${categoryFolder}`);
        structures.add(`${categoryFolder}/${provinceFolder}`);
        structures.add(`${categoryFolder}/${provinceFolder}/${cityFolder}`);
      });
    }
  });

  // Create directories and index files
  structures.forEach(structure => {
    const parts = structure.split('/');
    const dirPath = path.join(contentDir, structure);
    const indexPath = path.join(dirPath, '_index.md');

    ensureDirectoryExists(dirPath);

    if (parts.length === 1) {
      // Category level
      createIndexFile(indexPath, parts[0].replace(/\b\w/g, l => l.toUpperCase()));
    } else if (parts.length === 2) {
      // Province level
      createIndexFile(indexPath, parts[1].replace(/\b\w/g, l => l.toUpperCase()));
    } else if (parts.length === 3) {
      // City level
      createIndexFile(indexPath, parts[2].replace(/\b\w/g, l => l.toUpperCase()));
    }
  });

  console.log('Category structure generation complete!');
}

generateCategoryStructure();
