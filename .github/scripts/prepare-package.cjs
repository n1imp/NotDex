const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const lock = require(path.join(root, 'package-lock.json'));
  const platforms = Object.entries(lock.packages).filter(([, info]) => info.optional && info.os);
  if (platforms.length !== 6) throw Error('Review the supported native package set before publishing.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-package-'));
  try {
    for (const [key, info] of platforms) {
      if (!/^node_modules\/@lydell\/node-pty-(darwin|linux|win32)-(arm64|x64)$/.test(key)) throw Error('Unexpected native package.');
      const url = new URL(info.resolved);
      if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') throw Error('Unexpected package registry.');
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw Error('Could not download ' + key);
      const bytes = Buffer.from(await response.arrayBuffer());
      if ('sha512-' + createHash('sha512').update(bytes).digest('base64') !== info.integrity) throw Error('Package integrity mismatch: ' + key);
      const archive = path.join(temporary, 'package.tgz');
      fs.writeFileSync(archive, bytes);
      const destination = path.join(root, key);
      fs.mkdirSync(destination, { recursive: true });
      const result = spawnSync('tar', ['-xzf', archive, '-C', destination, '--strip-components=1'], { encoding: 'utf8', windowsHide: true });
      if (result.status !== 0) throw Error('Could not extract ' + key);
      if (JSON.parse(fs.readFileSync(path.join(destination, 'package.json'), 'utf8')).version !== info.version) throw Error('Native version mismatch.');
    }
  } finally {
    if (fs.existsSync(path.join(temporary, 'package.tgz'))) fs.unlinkSync(path.join(temporary, 'package.tgz'));
    fs.rmdirSync(temporary);
  }
  console.log('Verified and bundled six native platform packages from package-lock.json.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
