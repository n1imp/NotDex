const fs = require('node:fs');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { MetricsAccumulator } = require('./observability.cjs');
const relevant = /"(?:token_count|token_usage_record|task_started|task_complete|turn_context|session_meta)"/;
const normal = value => process.platform === 'win32' ? value.replace(/^\\\\\?\\UNC\\/, '\\\\').replace(/^\\\\\?\\/, '') : value;
const inside = (root, file) => { const relative = path.relative(normal(root), normal(file)); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };

class TranscriptMonitor {
  constructor({ codexRoot, intervalMs = 500, onChange = () => {} }) {
    this.root = fs.realpathSync(codexRoot);
    this.onChange = onChange;
    this.generation = 0;
    this.metrics = new MetricsAccumulator();
    this.timer = setInterval(() => this.tick().catch(() => {}), intervalMs); this.timer.unref();
  }
  allowed(file) {
    const resolved = normal(path.resolve(file));
    return ['sessions', 'archived_sessions'].some(name => {
      let root = path.join(this.root, name), candidate = resolved;
      try { root = fs.realpathSync(root); } catch {}
      try { candidate = fs.realpathSync(resolved); } catch {}
      return inside(root, candidate);
    });
  }
  reset() {
    this.offset = 0; this.identity = null; this.pending = ''; this.skipLine = false; this.decoder = new StringDecoder('utf8');
    this.metrics = new MetricsAccumulator({ sessionId: this.data?.session_id });
    if (this.data?.turn_id && this.data?.model) this.metrics.consume({ type: 'turn_context', payload: { turn_id: this.data.turn_id, model: this.data.model } });
  }
  attach(data) {
    if (!data || typeof data.session_id !== 'string' || typeof data.transcript_path !== 'string' || !this.allowed(data.transcript_path)) return false;
    if (this.data?.session_id !== data.session_id || this.data?.transcript_path !== data.transcript_path) {
      this.generation++; this.data = { ...data }; this.reset();
    } else this.data = { ...this.data, ...data };
    return true;
  }
  consume(text) {
    for (const part of text.split(/(?<=\n)/)) {
      if (!this.skipLine) this.pending += part;
      if (this.pending.length > 1024 * 1024) { this.skipLine = true; this.pending = ''; }
      if (part.endsWith('\n')) {
        if (!this.skipLine && relevant.test(this.pending)) { try { this.metrics.consume(JSON.parse(this.pending)); } catch {} }
        this.pending = ''; this.skipLine = false;
      }
    }
  }
  tick() {
    if (this.reading) return this.reading;
    if (this.closed || !this.data) return Promise.resolve();
    const generation = this.generation, file = this.data.transcript_path;
    this.reading = (async () => {
      let handle;
      try {
        if (!this.allowed(file)) return;
        const canonical = fs.realpathSync(file);
        handle = await fs.promises.open(canonical, fs.constants.O_RDONLY | (process.platform === 'win32' ? 0 : fs.constants.O_NOFOLLOW || 0));
        const stat = await handle.stat(); if (!stat.isFile() || generation !== this.generation) return;
        const identity = stat.dev + ':' + stat.ino + ':' + stat.birthtimeMs;
        if (stat.size < this.offset || this.identity && this.identity !== identity) this.reset();
        this.identity = identity;
        const buffer = Buffer.alloc(65536);
        while (this.offset < stat.size && generation === this.generation && !this.closed) {
          const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - this.offset), this.offset);
          if (!bytesRead || generation !== this.generation) break;
          this.offset += bytesRead; this.consume(this.decoder.write(buffer.subarray(0, bytesRead)));
        }
        if (generation === this.generation && !this.closed) this.onChange(this.snapshot());
      } catch {} finally { await handle?.close(); }
    })().finally(() => { this.reading = null; });
    return this.reading;
  }
  snapshot(now = new Date().toISOString()) {
    return { ...this.metrics.snapshot({ turnId: this.data?.turn_id || undefined, now }), observed_at: now, session_id: this.data?.session_id || null, model: this.data?.model || null };
  }
  close() { this.closed = true; clearInterval(this.timer); }
}

module.exports = { TranscriptMonitor };
