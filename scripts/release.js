const { execSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const pkg = require('../package.json');

const version = pkg.version;
const dryRun = process.argv.includes('--dry-run');
const nsisDir = path.join('src-tauri', 'target', 'release', 'bundle', 'nsis');

if (!fs.existsSync(nsisDir)) {
  console.error(`❌ NSIS bundle folder not found: ${nsisDir}. Please run "npm run build" first.`);
  process.exit(1);
}

const rawInstallers = fs
  .readdirSync(nsisDir)
  .filter((f) => f.endsWith('.exe') && f.includes(version) && !f.startsWith('BitKit-Setup-'));

const setupFileName = `BitKit-Setup-${version}.exe`;
const setupPath = path.join(nsisDir, setupFileName);

if (rawInstallers.length > 0) {
  const srcPath = path.join(nsisDir, rawInstallers[0]);
  fs.copyFileSync(srcPath, setupPath);
  console.log(`📦 Prepared installer: ${setupFileName}`);
} else if (!fs.existsSync(setupPath)) {
  console.error(`❌ No NSIS installer found for v${version} in ${nsisDir}.`);
  process.exit(1);
}

// Compute SHA-512 (base64) and exact byte size for legacy electron-updater (v1.x -> v2.0+) bridge
function computeSha512Base64(filePath) {
  const hash = crypto.createHash('sha512');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('base64');
}

const stat = fs.statSync(setupPath);
const sha512 = computeSha512Base64(setupPath);
const releaseDate = new Date().toISOString();

const latestYml = [
  `version: ${version}`,
  `files:`,
  `  - url: ${setupFileName}`,
  `    sha512: ${sha512}`,
  `    size: ${stat.size}`,
  `path: ${setupFileName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  ''
].join('\n');

const yamlPath = path.join(nsisDir, 'latest.yml');
fs.writeFileSync(yamlPath, latestYml, 'utf-8');
console.log(`📝 Generated latest.yml for seamless v1.x -> v${version} migration (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);

if (dryRun) {
  console.log('--- latest.yml preview ---');
  console.log(latestYml);
  console.log('✅ Dry run complete (skipping GitHub upload).');
  process.exit(0);
}

console.log(`🚀 Publishing BitKit v${version} to GitHub Releases...`);

try {
  const cmd = `gh release create v${version} "${setupPath}" "${yamlPath}" --title "BitKit v${version}" --notes "BitKit v${version} — Native Rust + Tauri v2"`;
  execSync(cmd, { stdio: 'inherit' });
  console.log(`✅ BitKit v${version} has been successfully published!`);
} catch (err) {
  console.error('❌ An error occurred during publishing. Make sure gh CLI is authenticated and the release tag does not already exist.');
  process.exit(1);
}
