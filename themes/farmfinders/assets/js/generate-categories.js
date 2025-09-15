const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Configuration
const SEARCH_RADIUS_KM = 80; // Match the radius used in regional-map.html
const farmsDir = './content/farms';
const contentDir = './content';
const dataDir = './data';

// Haversine formula to calculate distance between two points
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

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

function createIndexFile(filePath, title, metadata = {}) {
  if (!fs.existsSync(filePath)) {
    let frontmatter = {
      title: title,
      ...metadata
    };
    
    const yamlContent = yaml.dump(frontmatter, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      quotingType: '"'
    });
    
    const content = `---\n${yamlContent}---\n`;
    fs.writeFileSync(filePath, content);
    console.log(`Created: ${filePath}`);
  }
}

function generateCategoryStructure() {
  // Load Canadian cities data
  let citiesData;
  try {
    citiesData = JSON.parse(fs.readFileSync(path.join(dataDir, 'canada-cities.json'), 'utf8'));
    console.log(`✅ Loaded cities data: ${citiesData.metadata.totalCities} cities across ${citiesData.metadata.totalProvinces} provinces`);
  } catch (error) {
    console.error('❌ Error loading canada-cities.json:', error);
    return;
  }

  // Load all farms with valid coordinates
  const farms = fs.readdirSync(farmsDir)
    .filter(file => file.endsWith('.md'))
    .map(file => {
      const content = fs.readFileSync(path.join(farmsDir, file), 'utf8');
      const frontmatter = content.split('---')[1];
      try {
        return yaml.load(frontmatter);
      } catch (e) {
        console.log(`Warning: Could not parse ${file}`);
        return null;
      }
    })
    .filter(farm => farm && farm.coordinates && farm.coordinates.latitude && farm.coordinates.longitude);

  console.log(`📦 Processing ${farms.length} farms with valid coordinates\n`);

  // Group farms by category
  const farmsByCategory = {};
  farms.forEach(farm => {
    if (farm.categories && farm.address && farm.address.province) {
      farm.categories.forEach(category => {
        if (!farmsByCategory[category]) {
          farmsByCategory[category] = [];
        }
        farmsByCategory[category].push(farm);
      });
    }
  });

  const structures = new Set();
  const cityFarmCounts = {}; // Track farm counts per city for statistics

  console.log('🔍 Analyzing farm categories and locations...\n');

  // Process each category
  Object.keys(farmsByCategory).forEach(category => {
    const categoryFarms = farmsByCategory[category];
    console.log(`📁 ${formatTitle(category)}: ${categoryFarms.length} farms`);
    
    // Always create category root
    structures.add(`${category}`);
    
    // Group farms by province (using normalized province names)
    const provinceMap = {};
    categoryFarms.forEach(farm => {
      // Normalize province name to match cities data
      const farmProvince = farm.address.province.toLowerCase().replace(/\s+/g, '-');
      
      // Find matching province in cities data
      const provinceData = Object.values(citiesData.provinces).find(p => {
        const provinceName = p.name.toLowerCase().replace(/\s+/g, '-');
        return provinceName === farmProvince || p.slug === farmProvince;
      });
      
      if (provinceData) {
        const provinceSlug = provinceData.slug;
        if (!provinceMap[provinceSlug]) {
          provinceMap[provinceSlug] = {
            farms: [],
            cities: provinceData.cities || []
          };
        }
        provinceMap[provinceSlug].farms.push(farm);
      }
    });

    // Process each province
    Object.keys(provinceMap).forEach(provinceSlug => {
      const provinceInfo = provinceMap[provinceSlug];
      
      // Add province structure
      structures.add(`${category}/${provinceSlug}`);
      
      // Check each city in this province for nearby farms
      provinceInfo.cities.forEach(city => {
        let nearbyFarmCount = 0;
        let closestDistance = Infinity;
        
        // Check distance to all farms in this province/category
        provinceInfo.farms.forEach(farm => {
          const distance = calculateDistance(
            city.coordinates.latitude,
            city.coordinates.longitude,
            farm.coordinates.latitude,
            farm.coordinates.longitude
          );
          
          if (distance <= SEARCH_RADIUS_KM) {
            nearbyFarmCount++;
            closestDistance = Math.min(closestDistance, distance);
          }
        });
        
        // Only create city page if there are nearby farms
        if (nearbyFarmCount > 0) {
          structures.add(`${category}/${provinceSlug}/${city.slug}`);
          
          // Track statistics
          const cityKey = `${category}/${provinceSlug}/${city.slug}`;
          cityFarmCounts[cityKey] = {
            count: nearbyFarmCount,
            closestDistance: closestDistance.toFixed(1)
          };
        }
      });
    });
  });

  console.log(`\n📊 Summary:`);
  console.log(`• Total structures to create: ${structures.size}`);
  console.log(`• Search radius: ${SEARCH_RADIUS_KM}km`);

  // Create directories and index files
  structures.forEach(structure => {
    const parts = structure.split('/');
    const dirPath = path.join(contentDir, structure);
    const indexPath = path.join(dirPath, '_index.md');

    ensureDirectoryExists(dirPath);

    let metadata = {};
    
    if (parts.length === 1) {
      // Category level
      createIndexFile(indexPath, formatTitle(parts[0]), metadata);
    } else if (parts.length === 2) {
      // Province level
      const provinceSlug = parts[1];
      const provinceData = Object.values(citiesData.provinces).find(p => p.slug === provinceSlug);
      const title = provinceData ? provinceData.name : formatTitle(parts[1]);
      createIndexFile(indexPath, title, metadata);
    } else if (parts.length === 3) {
      // City level - add coordinates for map centering
      const [category, provinceSlug, citySlug] = parts;
      const provinceData = Object.values(citiesData.provinces).find(p => p.slug === provinceSlug);
      const cityData = provinceData?.cities?.find(c => c.slug === citySlug);
      
      if (cityData) {
        metadata = {
          coordinates: cityData.coordinates,
          location_type: 'city',
          population: cityData.population
        };
      }
      
      const title = cityData ? cityData.name : formatTitle(parts[2]);
      createIndexFile(indexPath, title, metadata);
    }
  });

  // Generate detailed statistics
  console.log('\n📈 Detailed Statistics:\n');
  
  Object.keys(farmsByCategory).forEach(category => {
    const categoryStructures = Array.from(structures).filter(s => s.startsWith(category));
    const provinces = new Set(categoryStructures.filter(s => s.split('/').length === 2).map(s => s.split('/')[1]));
    const cities = categoryStructures.filter(s => s.split('/').length === 3);
    
    console.log(`${formatTitle(category)}:`);
    console.log(`  • Total farms: ${farmsByCategory[category].length}`);
    console.log(`  • Provinces covered: ${provinces.size}`);
    console.log(`  • Cities with farms nearby: ${cities.length}`);
    
    // Show top 3 cities by farm count
    const categoryCities = cities
      .map(s => ({ path: s, ...cityFarmCounts[s] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    
    if (categoryCities.length > 0) {
      console.log(`  • Top cities:`);
      categoryCities.forEach(city => {
        const cityName = city.path.split('/')[2];
        console.log(`    - ${formatTitle(cityName)}: ${city.count} farms (closest: ${city.closestDistance}km)`);
      });
    }
    console.log('');
  });

  // Create manifest for debugging/reference
  const manifest = {
    generated: new Date().toISOString(),
    config: {
      searchRadiusKm: SEARCH_RADIUS_KM,
      farmsProcessed: farms.length,
      categoriesFound: Object.keys(farmsByCategory).length
    },
    structures: {
      total: structures.size,
      byType: {
        categories: Array.from(structures).filter(s => !s.includes('/')).length,
        provinces: Array.from(structures).filter(s => s.split('/').length === 2).length,
        cities: Array.from(structures).filter(s => s.split('/').length === 3).length
      }
    },
    paths: Array.from(structures).sort()
  };
  
  fs.writeFileSync(
    path.join(contentDir, 'category-generation-manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  
  console.log('✅ Created category-generation-manifest.json');
  console.log('✨ Category structure generation complete!');
  
  // Clean up orphaned directories (optional)
  console.log('\n🧹 Checking for orphaned category directories...');
  cleanupOrphanedDirectories(structures);
}

function cleanupOrphanedDirectories(validStructures) {
  const validPaths = new Set(Array.from(validStructures));
  let orphanedCount = 0;
  
  // Get all existing category directories
  const categories = fs.readdirSync(contentDir)
    .filter(dir => {
      const fullPath = path.join(contentDir, dir);
      return fs.statSync(fullPath).isDirectory() && 
             !dir.startsWith('_') && 
             !dir.startsWith('.') &&
             dir !== 'farms'; // Exclude farms directory
    });
  
  categories.forEach(category => {
    checkDirectory(category, '');
  });
  
  function checkDirectory(dir, parentPath) {
    const currentPath = parentPath ? `${parentPath}/${dir}` : dir;
    
    if (!validPaths.has(currentPath) && !['about', 'contact', 'privacy'].includes(dir)) {
      console.log(`  ⚠️  Orphaned: ${currentPath}`);
      orphanedCount++;
      // Uncomment to actually delete:
      // fs.rmSync(path.join(contentDir, currentPath), { recursive: true });
    }
    
    // Check subdirectories
    const fullPath = path.join(contentDir, currentPath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      const subdirs = fs.readdirSync(fullPath)
        .filter(subdir => {
          const subPath = path.join(fullPath, subdir);
          return fs.statSync(subPath).isDirectory() && !subdir.startsWith('_');
        });
      
      subdirs.forEach(subdir => checkDirectory(subdir, currentPath));
    }
  }
  
  if (orphanedCount > 0) {
    console.log(`\n  Found ${orphanedCount} orphaned directories.`);
    console.log(`  To remove them, uncomment the fs.rmSync line in cleanupOrphanedDirectories()`);
  } else {
    console.log('  No orphaned directories found.');
  }
}

// Run the generator
generateCategoryStructure();