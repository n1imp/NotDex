const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { shouldOverlay, realEnvironment, launch } = require('../src/cli.cjs');
const { resolveCodex } = require('../src/codex.cjs');

test('ordinary CLI, prompts, resume and fork use the overlay; control commands and pipes pass through', () => {
  for (const args of [[], ['resume', '--last'], ['fork'], ['agents'], ['fix this'], ['-m', 'exec', 'fix this'], ['--', 'exec'], ['--', '--help']]) assert(shouldOverlay(args, true, true), JSON.stringify(args));
  for (const args of [['--version'], ['--help'], ['app-server'], ['exec', 'hello'], ['e', 'hello'], ['-c', 'model="x"', 'mcp', 'list'], ['completion', 'zsh'], ['update']]) assert(!shouldOverlay(args, true, true), JSON.stringify(args));
  assert(!shouldOverlay([], false, true)); assert(!shouldOverlay([], true, false));
});

test('real Codex lookup excludes owned PATH entries without discarding other directories', () => {
  const env = realEnvironment({ PATH: '/one:/owned:/two:/owned' }, '/owned', 'linux');
  assert.equal(env.PATH, '/one:/two');
  assert.equal(realEnvironment({ Path: 'C:\\one;C:\\owned;C:\\two' }, 'c:/owned', 'win32').PATH, 'C:\\one;C:\\two');
});

test('passthrough preserves literal arguments and the upstream exit code without drawing an overlay', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-cli-'));
  const target = path.join(root, 'fake.cjs'), output = path.join(root, 'args.json');
  fs.writeFileSync(target, 'require("node:fs").writeFileSync(process.env.NOTDEX_ARGS,JSON.stringify(process.argv.slice(2)));process.exit(7)');
  const args = ['exec', 'spaces & $literal', 'quote"here', '--config', 'x="y"'];
  const code = await launch(args, { directory: root, codex: { file: process.execPath, args: [target] },
    env: { ...process.env, NOTDEX_ARGS: output }, input: { isTTY: false }, output: { isTTY: false } });
  assert.equal(code, 7); assert.deepEqual(JSON.parse(fs.readFileSync(output)), args);
});

test('PATH aliases to the owned shim directory are excluded before real Codex lookup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-path-alias-'));
  const real = path.join(root, 'real'), alias = path.join(root, 'alias');
  fs.mkdirSync(real); fs.mkdirSync(path.join(real, 'bin'));
  fs.symlinkSync(real, alias, 'junction');
  const env = realEnvironment({ PATH: path.join(alias, 'bin') }, path.join(real, 'bin'));
  assert.equal(env.PATH, '');
});

test('a managed launcher from another profile resolves upstream and cycles fail closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-other-profile-'));
  fs.mkdirSync(path.join(root, 'bin'));
  const file = path.join(root, 'bin', process.platform === 'win32' ? 'codex.cmd' : 'codex');
  fs.writeFileSync(file, '', { mode: 0o700 });
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ app: 'NotDex', format_version: 2, owns_cli: true }));
  fs.writeFileSync(path.join(root, 'codex-target.json'), JSON.stringify({ path: process.execPath }));
  assert.equal(resolveCodex(file).file, fs.realpathSync(process.execPath));
  fs.writeFileSync(path.join(root, 'codex-target.json'), JSON.stringify({ path: file }));
  assert.throws(() => resolveCodex(file), /recursive/i);
});
