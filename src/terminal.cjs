const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, randomUUID } = require('node:crypto');
const { OverlayState, InputRouter, clean } = require('./overlay.cjs');
const { FrameRenderer } = require('./renderer.cjs');
const { createEventReceiver } = require('./bridge.cjs');
const { TranscriptMonitor } = require('./monitor.cjs');
const { AccountClient } = require('./account.cjs');
const { resolveCodex } = require('./codex.cjs');
const { canBindCommandCenter, navigationContext } = require('./navigation.cjs');
const { TerminalTheme } = require('./theme.cjs');

function loadSettings(file) {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) return {};
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

function saveSettings(file, value) {
  let before = {};
  if (fs.existsSync(file)) {
    if (fs.lstatSync(file).isSymbolicLink() || !fs.lstatSync(file).isFile()) return;
    before = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!before || typeof before !== 'object' || Array.isArray(before)) return;
  }
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify({ ...before, ...value }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

async function runTerminal({ codex, args = [], codexHome, input = process.stdin, output = process.stdout, env: parentEnv = process.env }) {
  if (!input.isTTY || !output.isTTY) throw Error('Open NotDex in an interactive terminal. Use the normal Codex command for piped/noninteractive output.');
  const pty = require('@lydell/node-pty');
  const { Terminal } = require('@xterm/headless');
  const root = fs.realpathSync(codexHome);
  const preferences = path.join(root, 'notdex/overlay-settings.json');
  const state = new OverlayState(loadSettings(preferences));
  state.commandCenterShortcut = canBindCommandCenter(root, process.cwd(), args);
  const virtual = new Terminal({ cols: output.columns || 100, rows: output.rows || 30, scrollback: 2000, allowProposedApi: true });
  const renderer = new FrameRenderer();
  let child, stopped = false, blocked = false, renderTimer, inputTimer, saveTimer, showCursor = true, accountSnapshot, navigationPending = false, awaitingCenter = false;
  const theme = new TerminalTheme({ output: data => { if (!stopped) output.write(data); }, forward: data => { if (!stopped) child?.write(data); }, changed: () => schedule(), enabled: parentEnv.NO_COLOR === undefined && parentEnv.TERM !== 'dumb' });
  const monitor = new TranscriptMonitor({ codexRoot: root, onChange: () => schedule() });
  const token = randomBytes(32).toString('hex');
  const receiver = createEventReceiver({ token, onEvent: data => {
    if (data.event === 'stop' && (navigationPending || state.suspended || monitor.data && data.session_id !== monitor.data.session_id)) return;
    if (data.event === 'start' || data.event === 'prompt') navigationPending = false;
    if (monitor.attach(data)) monitor.tick().catch(() => {});
  } });
  receiver.requestTimeout = 1500; receiver.headersTimeout = 1500;
  await new Promise((resolve, reject) => { receiver.once('error', reject); receiver.listen(0, '127.0.0.1', resolve); });
  const env = { ...parentEnv, CODEX_HOME: root, TERM: parentEnv.TERM || 'xterm-256color',
    NOTDEX_OVERLAY_ENDPOINT: 'http://127.0.0.1:' + receiver.address().port + '/event', NOTDEX_OVERLAY_TOKEN: token };
  let account;
  let refreshing = false;
  const refresh = async () => {
    if (refreshing || stopped) return; refreshing = true;
    try {
      account ||= new AccountClient(codex, { env: { ...parentEnv, CODEX_HOME: root } });
      accountSnapshot = await account.read(); schedule();
    } catch { account?.close(); account = null; } finally { refreshing = false; }
  };
  const accountTimer = setInterval(refresh, 60000); refresh();
  const clockTimer = setInterval(() => schedule(), 1000);
  const router = new InputRouter(state, () => ({ cols: virtual.cols, rows: virtual.rows }), () => { navigationPending = true; awaitingCenter = true; monitor.detach(); }, {
    context: () => navigationContext(virtual, showCursor), onColorReport: data => theme.consume(data), colorReportExpected: () => theme.expecting
  });
  function snapshot() {
    const result = monitor.snapshot();
    if (accountSnapshot) {
      if (Date.parse(accountSnapshot.updated_at) >= (Date.parse(result.quota_updated_at) || 0)) {
        result.plan = accountSnapshot.plan; result.quota = accountSnapshot.quota;
        result.quota_updated_at = accountSnapshot.quota ? accountSnapshot.updated_at : null;
      }
    }
    return result;
  }
  function draw() {
    renderTimer = null;
    if (stopped || blocked) return;
    const context = navigationContext(virtual, showCursor);
    if (context.kind === 'center') { if (!state.editing) state.suspended = true; awaitingCenter = false; }
    else if (context.kind === 'chat' && !awaitingCenter) state.suspended = false;
    const frame = renderer.frame(virtual, state, snapshot(), { showCursor, suppressed: state.suspended, theme });
    if (frame && !output.write(frame)) {
      blocked = true; child?.pause();
      output.once('drain', () => { blocked = false; if (!stopped) { child?.resume(); schedule(); } });
    }
  }
  function schedule() { if (!stopped && !renderTimer) renderTimer = setTimeout(draw, 33); }
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { saveSettings(preferences, state.saved()); } catch {} }, 150);
  };
  const forward = data => { if (data && !stopped) { try { child?.write(data); } catch {} } };
  const inputData = data => {
    const before = JSON.stringify(state.saved()) + state.editing;
    forward(router.push(data));
    if (!state.suspended) awaitingCenter = false;
    clearTimeout(inputTimer); inputTimer = setTimeout(() => { forward(router.flush()); schedule(); }, 50);
    if (before !== JSON.stringify(state.saved()) + state.editing) { persist(); schedule(); }
  };
  const resize = () => {
    if (stopped) return;
    const cols = Math.max(1, output.columns || 100), rows = Math.max(1, output.rows || 30);
    virtual.resize(cols, rows); try { child?.resize(cols, rows); } catch {} schedule();
  };
  const wasRaw = input.isRaw;
  return new Promise((resolve, reject) => {
    const cleanup = (code, error) => {
      if (stopped) return; stopped = true;
      for (const timer of [renderTimer, inputTimer, saveTimer, accountTimer, clockTimer]) clearTimeout(timer);
      try { saveSettings(preferences, state.saved()); } catch {}
      monitor.close(); account?.close(); receiver.closeAllConnections(); receiver.close();
      input.off('data', inputData); output.off('resize', resize); output.off('error', outputError);
      process.off('SIGTERM', terminate); process.off('SIGHUP', terminate);
      process.off('SIGINT', interrupt);
      try { input.setRawMode(!!wasRaw); input.pause(); } catch {}
      try { output.write('\x1b[?2026l\x1b[0m\x1b[?25h\x1b[?2004l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1006l\x1b[?9001l\x1b[?1049l'); } catch {}
      virtual.dispose();
      if (error) reject(error); else resolve(code);
    };
    const terminate = () => { try { child?.kill(); } catch {} cleanup(143); };
    const interrupt = () => forward('\x03');
    const outputError = () => terminate();
    process.on('SIGTERM', terminate); process.on('SIGHUP', terminate); output.on('error', outputError);
    process.on('SIGINT', interrupt);
    try {
      output.write('\x1b[?1049h'); input.setEncoding('utf8'); input.setRawMode(true); input.resume();
      const overrides = state.commandCenterShortcut ? ['-c', 'tui.keymap.global.open_agents=["f9"]'] : [];
      const owner = loadSettings(path.join(root, 'notdex/manifest.json'));
      if (owner.app === 'NotDex' && owner.format_version === 2) {
        for (const key of ['NOTDEX_OVERLAY_ENDPOINT', 'NOTDEX_OVERLAY_TOKEN']) overrides.push('-c', 'mcp_servers.notdex.env.' + key + '=' + JSON.stringify(env[key]));
      }
      if (args[0] === 'resume' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(args[1] || '')) {
        monitor.attach({ event: 'start', session_id: args[1] }); monitor.tick().catch(() => {});
      }
      child = pty.spawn(codex.file, [...codex.args, ...overrides, ...args], { cols: virtual.cols, rows: virtual.rows, cwd: process.cwd(), env, name: 'xterm-256color' });
      virtual.onData(forward);
      for (const slot of [10, 11]) virtual.parser.registerOscHandler(slot, data => {
        if (data !== '?') return false;
        theme.query(slot, true); return true;
      });
      virtual.onTitleChange(title => { if (!stopped) output.write('\x1b]0;' + clean(title) + '\x07'); });
      for (const [final, visible] of [['h', true], ['l', false]]) virtual.parser.registerCsiHandler({ prefix: '?', final }, params => {
        for (const mode of params.flat()) {
          if (mode === 25) showCursor = visible;
          else if ([1000, 1002, 1003, 1004, 1006, 9001].includes(mode) && !stopped) output.write('\x1b[?' + mode + final);
        }
        return false;
      });
      virtual.parser.registerOscHandler(52, data => {
        if (data.length < 8 * 1024 * 1024 && /^[cps0-7]*;[A-Za-z0-9+/=?]*$/.test(data) && !stopped) output.write('\x1b]52;' + data + '\x07');
        return true;
      });
      child.onData(data => { if (!stopped) virtual.write(data, schedule); });
      child.on('error', error => {
        // Unix PTYs report EIO when the slave closes; onExit carries the real status.
        if (process.platform !== 'win32' && error.code === 'EIO') return;
        try { child.kill(); } catch {} cleanup(1, error);
      });
      child.onExit(({ exitCode, signal }) => {
        // Explicitly release node-pty's Windows conout worker after the child exits.
        if (process.platform === 'win32') { try { child.kill(); } catch {} }
        cleanup(signal ? 128 + signal : Number.isInteger(exitCode) ? exitCode : 1);
      });
      input.on('data', inputData); output.on('resize', resize);
      theme.query(10); theme.query(11); schedule();
    } catch (error) { try { child?.kill(); } catch {} cleanup(1, error); }
  });
}

async function main(arguments_ = process.argv.slice(2)) {
  try {
    let selected, home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const args = [];
    for (let i = 0; i < arguments_.length; i++) {
      if (arguments_[i] === '--codex' && arguments_[i + 1]) selected = arguments_[++i];
      else if (arguments_[i] === '--codex-home' && arguments_[i + 1]) home = arguments_[++i];
      else if (arguments_[i] === '--help') { console.log('NotDex [--codex PATH] [--codex-home PATH] [-- CODEX_ARGS]\nF9: Codex command center; F12: overlay controls; arrows: move; Tab: session/turn/request; H: hide; Esc: finish positioning. Typing releases overlay controls.'); return; }
      else if (arguments_[i] === '--') { args.push(...arguments_.slice(i + 1)); break; }
      else args.push(arguments_[i]);
    }
    process.exitCode = await runTerminal({ codex: resolveCodex(selected), args, codexHome: home });
  } catch (error) { console.error('NotDex: ' + error.message); process.exitCode = 1; }
}

module.exports = { main, runTerminal, loadSettings, saveSettings };
if (require.main === module) main();
