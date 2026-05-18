const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
  const binDir = path.join(context.appOutDir, 'resources', 'bin');
  if (fs.existsSync(binDir)) {
    const files = fs.readdirSync(binDir);
    let hiddenCount = 0;
    for (const file of files) {
      if (file.endsWith('.exe')) {
        const oldPath = path.join(binDir, file);
        const newPath = path.join(binDir, file + '.hidden');
        fs.renameSync(oldPath, newPath);
        hiddenCount++;
        console.log(`[BitKit] Hid binary from signtool: ${file} -> ${file}.hidden`);
      }
    }
    if (hiddenCount > 0) {
      console.log(`[BitKit] Successfully hid ${hiddenCount} binaries from signtool to preserve Delta Update sizes.`);
    }
  }
};
