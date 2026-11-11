const clean = value => String(value ?? '').replace(/[^\x20-\x7e]/g, '?');
const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : 'N/D';
const SCOPES = ['turn', 'request', 'session'];

class OverlayState {
  constructor(saved = {}) {
    this.x = Number.isInteger(saved.x) && saved.x >= 0 ? saved.x : null;
    this.y = Number.isInteger(saved.y) && saved.y >= 0 ? saved.y : 0;
    this.scope = SCOPES.includes(saved.scope) ? saved.scope : 'turn';
    this.visible = saved.visible !== false;
    this.editing = false;
    this.suspended = false;
    this.commandCenterShortcut = true;
  }
  rect(cols, rows) {
    if (!this.visible || cols < 52 || rows < 12) return null;
    return { x: Math.min(this.x ?? cols - 48, cols - 48), y: Math.min(this.y, rows - 8), width: 48, height: 8 };
  }
  move(dx, dy, cols, rows) {
    const rect = this.rect(cols, rows); if (!rect) return;
    this.x = Math.max(0, Math.min(cols - rect.width, rect.x + dx));
    this.y = Math.max(0, Math.min(rows - rect.height, rect.y + dy));
  }
  saved() { return { x: this.x, y: this.y, scope: this.scope, visible: this.visible }; }
}

const F12 = '\x1b[24~', F9 = '\x1b[20~', PASTE_START = '\x1b[200~', PASTE_END = '\x1b[201~';
const ARROWS = { '\x1b[A': [0, -1], '\x1b[B': [0, 1], '\x1b[C': [1, 0], '\x1b[D': [-1, 0],
  '\x1bOA': [0, -1], '\x1bOB': [0, 1], '\x1bOC': [1, 0], '\x1bOD': [-1, 0] };
const KEYS = [F12, F9, PASTE_START, PASTE_END, ...Object.keys(ARROWS)];

class InputRouter {
  constructor(state, size, onCommandCenter = () => {}, { context, onColorReport, colorReportExpected = () => false } = {}) { this.state = state; this.size = size; this.onCommandCenter = onCommandCenter; this.context = context; this.onColorReport = onColorReport; this.colorReportExpected = colorReportExpected; this.buffer = ''; this.wireBuffer = ''; this.pasting = false; this.windowsKeys = new Set(); }
  commandCenter() { this.state.editing = false; this.state.suspended = true; this.onCommandCenter(); }
  navigate(key, windows = false) {
    const context = this.context?.();
    if (this.state.editing) return;
    if (context?.kind === 'center' && !context.editing && ['right', 'escape'].includes(key)) return '';
    if (key === 'escape' && context?.canGoDashboard && this.state.commandCenterShortcut) {
      this.commandCenter();
      return windows ? '\x1b[120;67;0;1;0;1_\x1b[120;67;0;0;0;1_' : F9;
    }
  }
  resumePresentation() { if (!this.context || this.context()?.kind === 'chat') this.state.suspended = false; }
  push(data) {
    if (this.colorUntil && Date.now() > this.colorUntil) { this.buffer = ''; this.colorUntil = 0; }
    this.wireBuffer += data;
    const lastEscape = this.wireBuffer.lastIndexOf('\x1b');
    const tail = this.wireBuffer.slice(lastEscape);
    const pending = lastEscape >= 0 && tail.length < 128 && /^\x1b(?:\[[\d;]*)?$/.test(tail);
    const ready = pending ? this.wireBuffer.slice(0, lastEscape) : this.wireBuffer;
    this.wireBuffer = pending ? tail : '';
    // ConPTY may wrap pasted VT bytes in VK=0 character records instead of raw bytes.
    this.buffer += ready.replace(/\x1b\[0;\d+;(\d+);([01]);0;(\d+)_/g, (record, code, down, repeats) => {
      const value = Number(code);
      if (!value || value > 0x10ffff) return record;
      return down === '1' ? String.fromCodePoint(value).repeat(Math.min(1000, Number(repeats))) : '';
    });
    let forward = '';
    while (this.buffer) {
      if (this.pasting) {
        const end = this.buffer.indexOf(PASTE_END);
        if (end >= 0) { forward += this.buffer.slice(0, end + PASTE_END.length); this.buffer = this.buffer.slice(end + PASTE_END.length); this.pasting = false; continue; }
        let keep = 0;
        for (let n = 1; n < PASTE_END.length; n++) if (this.buffer.endsWith(PASTE_END.slice(0, n))) keep = n;
        forward += this.buffer.slice(0, this.buffer.length - keep); this.buffer = this.buffer.slice(this.buffer.length - keep); break;
      }
      if (this.onColorReport && this.buffer.startsWith('\x1b]') && (this.colorReportExpected() || /^\x1b\]1[01];rgb:/i.test(this.buffer))) {
        const report = /^\x1b\][^\x07]*?(?:\x07|\x1b\\)/.exec(this.buffer);
        if (report) {
          if (!this.onColorReport(report[0])) forward += report[0];
          this.colorUntil = 0; this.buffer = this.buffer.slice(report[0].length); continue;
        }
        const color = /^\x1b\]1[01];rgb:[0-9a-f/]*/i.exec(this.buffer);
        const header = ['\x1b]10;rgb:', '\x1b]11;rgb:'].some(value => value.startsWith(this.buffer));
        if ((color?.[0] === this.buffer || header) && this.buffer.length < 128) { this.colorUntil ||= Date.now() + 1000; break; }
        // Abandoned metadata must not consume the next real key, especially Ctrl+C.
        if (color) { this.colorUntil = 0; this.buffer = this.buffer.slice(color[0].length); continue; }
        this.colorUntil = 0;
      }
      const key = KEYS.find(value => this.buffer.startsWith(value));
      if (key) {
        this.buffer = this.buffer.slice(key.length);
        if (key === PASTE_START) { this.state.editing = false; this.pasting = true; forward += key; }
        else if (key === F12) { this.state.visible = true; this.state.suspended = false; this.state.editing = !this.state.editing; }
        else if (key === F9) { if (this.state.commandCenterShortcut) this.commandCenter(); else this.state.editing = false; forward += key; }
        else if (this.state.editing && ARROWS[key]) { const { cols, rows } = this.size(); this.state.move(...ARROWS[key], cols, rows); }
        else if (ARROWS[key]?.[0] === 1 && this.navigate('right') !== undefined) {}
        else forward += key;
        continue;
      }
      if (KEYS.some(value => value.startsWith(this.buffer))) break;
      if (this.buffer[0] === '\x1b' && this.buffer.length > 1) {
        if (/^\x1b(?:\[[0-?]*[ -/]*|O)$/.test(this.buffer) && this.buffer.length < 128) break;
        const sequence = /^\x1b(?:\[[0-?]*[ -/]*[@-~]|O.|.)/.exec(this.buffer);
        if (sequence) {
          const windows = /^\x1b\[(\d+);\d+;\d+;([01]);(\d+);(\d+)_$/.exec(sequence[0]);
          let handled = false;
          if (windows) {
            const [, vk, down, modifiers, repeats] = windows;
            if (down === '0' && this.windowsKeys.delete(vk)) handled = true;
            else if (down === '1' && !(Number(modifiers) & 31)) {
              const navigation = this.navigate(vk === '39' ? 'right' : vk === '27' ? 'escape' : null, true);
              if (navigation !== undefined) { forward += navigation; handled = true; }
              else if (vk === '120' && this.state.commandCenterShortcut) this.commandCenter();
              else if (vk === '123') { this.state.visible = true; this.state.suspended = false; this.state.editing = !this.state.editing; handled = true; }
              else if (this.state.editing) {
                const arrows = { 37: [-1, 0], 38: [0, -1], 39: [1, 0], 40: [0, 1] };
                if (arrows[vk]) { const { cols, rows } = this.size(); this.state.move(...arrows[vk].map(value => value * Math.min(1000, Number(repeats))), cols, rows); handled = true; }
                else if (vk === '9') { this.state.scope = SCOPES[(SCOPES.indexOf(this.state.scope) + 1) % SCOPES.length]; handled = true; }
                else if (vk === '27' || vk === '72') { if (vk === '72') this.state.visible = false; this.state.editing = false; handled = true; }
              }
              if (handled) this.windowsKeys.add(vk);
              else {
                this.state.editing = false;
                if (vk === '13' || vk === '27') this.resumePresentation();
              }
            }
          }
          if (!handled) { this.state.editing = false; forward += sequence[0]; }
          this.buffer = this.buffer.slice(sequence[0].length); continue;
        }
      }
      const char = this.buffer[0]; this.buffer = this.buffer.slice(1);
      if (this.state.editing && char === '\t') this.state.scope = SCOPES[(SCOPES.indexOf(this.state.scope) + 1) % SCOPES.length];
      else if (this.state.editing && ['h', 'H'].includes(char)) { this.state.visible = false; this.state.editing = false; }
      else {
        this.state.editing = false;
        if (char === '\r' || char === '\n') this.resumePresentation();
        forward += char;
      }
    }
    return forward;
  }
  flush() {
    if (this.wireBuffer === '\x1b') { this.buffer += this.wireBuffer; this.wireBuffer = ''; }
    if (this.pasting) return '';
    if (this.colorUntil) {
      if (Date.now() > this.colorUntil) { this.buffer = ''; this.colorUntil = 0; }
      return '';
    }
    if (/^\x1b(?:\[[0-?]*[ -/]*|O)$/.test(this.buffer)) return '';
    const value = this.buffer; this.buffer = '';
    if (value === '\x1b' && this.state.editing) { this.state.editing = false; return ''; }
    if (value === '\x1b') {
      const navigation = this.navigate('escape'); if (navigation !== undefined) return navigation;
      this.resumePresentation();
    }
    return value;
  }
}

function duration(stats) {
  const value = stats.latency_ms;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/D';
  const seconds = value / 1000;
  return (stats.latency_is_estimate ? '~' : '') + (seconds < 60 ? seconds.toFixed(1) + 's' : Math.floor(seconds / 60) + 'm' + String(Math.floor(seconds % 60)).padStart(2, '0') + 's');
}

function quotaLabel(window) {
  if (!window) return 'N/D';
  const minutes = window.window_minutes;
  const label = minutes === 10080 ? 'sem' : minutes && minutes % 60 === 0 ? minutes / 60 + 'h' : minutes ? minutes + 'm' : 'cota';
  return label + ' ' + window.used_percent + '%';
}

function panelLines(state, snapshot = {}) {
  const stats = snapshot[state.scope] || {}, labels = { turn: 'Turno', request: 'Requisicao', session: 'Sessao' };
  const cache = typeof stats.cache_hit_pct === 'number' ? stats.cache_hit_pct.toFixed(1) + '%' : 'N/D';
  const dollars = stats.usd_reference == null ? 'N/D' : Number(stats.usd_reference).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const age = Date.parse(snapshot.observed_at) - Date.parse(snapshot.quota_updated_at);
  const freshness = Number.isFinite(age) && age >= 0 ? Math.floor(age / 1000) + 's' : 'N/D';
  const body = [
    snapshot.session_id ? 'Sessao ' + clean(snapshot.session_id).slice(0, 8) + ' | ' + (stats.model || snapshot.model || 'modelo N/D') : 'Aguardando identificacao da sessao',
    'Total ' + count(stats.total_tokens) + ' | Out ' + count(stats.output_tokens),
    'In ' + count(stats.input_tokens) + ' | Cache ' + cache,
    'US$ ref.std ' + dollars + ' | Lat ' + duration(stats),
    'Conta ' + (snapshot.plan || 'N/D') + ' | ' + quotaLabel(snapshot.quota?.primary) + ' | ' + quotaLabel(snapshot.quota?.secondary),
    state.editing ? 'Setas mover | Tab escopo | H ocultar | Esc' : (state.commandCenterShortcut ? 'F9 sessoes' : '/agents') + ' | F12 painel | Cota ' + freshness
  ];
  return ['+' + (' NotDex / ' + labels[state.scope] + (state.editing ? ' [Mover] ' : ' ')).padEnd(46, '-') + '+',
    ...body.map(line => '|' + clean(line).slice(0, 46).padEnd(46) + '|'), '+' + '-'.repeat(46) + '+'];
}

function composeFrame(terminal, serialize, state, snapshot, { showCursor = true } = {}) {
  let body = serialize.serialize({ scrollback: 0, excludeModes: true });
  if (terminal.buffer.active.type === 'alternate') {
    // Pinned SerializeAddon includes normal + alternate buffers; render only the active one.
    const marker = '\x1b[?1049h\x1b[H';
    body = body.slice(body.lastIndexOf(marker) + marker.length);
  }
  let frame = '\x1b[?2026h\x1b[?25l\x1b[?6l\x1b[r\x1b[?7h\x1b[0m\x1b[H\x1b[2J' + body;
  const rect = state.rect(terminal.cols, terminal.rows);
  if (rect) {
    frame += '\x1b[?7l\x1b[0;37;40m';
    for (const [index, line] of panelLines(state, snapshot).entries()) frame += '\x1b[' + (rect.y + index + 1) + ';' + (rect.x + 1) + 'H' + (index === 0 || index === 7 ? '\x1b[36m' : '\x1b[37m') + line;
  }
  const modes = terminal.modes, buffer = terminal.buffer.active;
  frame += '\x1b[0m\x1b[?7h\x1b[' + (buffer.cursorY + 1) + ';' + (buffer.cursorX + 1) + 'H';
  frame += '\x1b[?1' + (modes.applicationCursorKeysMode ? 'h' : 'l') + '\x1b[?2004' + (modes.bracketedPasteMode ? 'h' : 'l');
  frame += showCursor ? '\x1b[?25h' : '\x1b[?25l';
  return frame + '\x1b[?2026l';
}

module.exports = { OverlayState, InputRouter, panelLines, composeFrame, clean };
