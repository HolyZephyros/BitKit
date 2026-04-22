const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const pkg = require('../package.json');

const version = pkg.version;
const distDir = 'dist';
const exePath = path.join(distDir, `BitKit-Setup-${version}.exe`);
const yamlPath = path.join(distDir, 'latest.yml');
const blockmapPath = path.join(distDir, `BitKit-Setup-${version}.exe.blockmap`);

// Patch latest.yml with blockMapSize for differential updates
if (fs.existsSync(blockmapPath) && fs.existsSync(yamlPath)) {
  const blockmapSize = fs.statSync(blockmapPath).size;
  let yaml = fs.readFileSync(yamlPath, 'utf-8');

  if (!yaml.includes('blockMapSize')) {
    // Insert blockMapSize after the size line inside files array
    yaml = yaml.replace(
      /(    size: \d+)/,
      `$1\n    blockMapSize: ${blockmapSize}`
    );
    fs.writeFileSync(yamlPath, yaml, 'utf-8');
    console.log(`📦 Patched latest.yml with blockMapSize: ${blockmapSize}`);
  }
}

console.log(`🚀 Publishing BitKit v${version} to GitHub... Please wait.`);

try {
  const cmd = `gh release create v${version} "${exePath}" "${yamlPath}" "${blockmapPath}" --title "BitKit v${version}" --notes "BitKit v${version}"`;
  execSync(cmd, { stdio: 'inherit' });
  console.log(`✅ BitKit v${version} has been successfully published! You can check it on your GitHub releases page.`);
} catch (err) {
  console.error(`❌ An error occurred during publishing. Please make sure the .exe file exists in the dist folder.`);
  process.exit(1);
}
