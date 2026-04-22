const { execSync } = require('child_process');
const path = require('path');
const pkg = require('../package.json');

const version = pkg.version;
const exePath = `dist/BitKit-Setup-${version}.exe`;
const yamlPath = `dist/latest.yml`;
const blockmapPath = `dist/BitKit-Setup-${version}.exe.blockmap`;

console.log(`🚀 Publishing BitKit v${version} to GitHub... Please wait.`);

try {

  const cmd = `gh release create v${version} "${exePath}" "${yamlPath}" "${blockmapPath}" --title "BitKit v${version}" --notes "BitKit v${version}"`;
  execSync(cmd, { stdio: 'inherit' });
  console.log(`✅ BitKit v${version} has been successfully published! You can check it on your GitHub releases page.`);
} catch (err) {
  console.error(`❌ An error occurred during publishing. Please make sure the .exe file exists in the dist folder.`);
  process.exit(1);
}
