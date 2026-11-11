const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { normalizeQuota } = require('./observability.cjs');

class AccountClient {
  constructor(codex, { timeoutMs = 15000, startupTimeoutMs = 120000, env = process.env } = {}) {
    this.pending = new Map(); this.sequence = 0; this.timeoutMs = timeoutMs;
    this.child = spawn(codex.file, [...codex.args, 'app-server'], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error) entry.reject(Error('Codex account read unavailable')); else entry.resolve(message.result);
    });
    const failed = () => {
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(Error('Codex account connection closed')); }
      this.pending.clear();
    };
    this.child.on('error', failed); this.child.on('exit', failed); this.child.stdin.on('error', failed);
    // Cold Codex process startup runs in the background, independently of hook deadlines.
    this.ready = this.request('initialize', { clientInfo: { name: 'notdex_observability', version: '0.2.0' }, capabilities: { experimentalApi: true } }, startupTimeoutMs).then(() => {
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }) + '\n');
    });
    this.ready.catch(() => {});
  }
  request(method, params, timeoutMs = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Codex account request timed out')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n'); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(Error('Codex account connection unavailable')); }
    });
  }
  async read() {
    await this.ready;
    const result = await this.request('account/read', { refreshToken: false });
    const account = result?.account;
    if (!account) return { plan: null, quota: null, updated_at: new Date().toISOString() };
    let limits;
    if (account.type !== 'apiKey') {
      try { const data = await this.request('account/rateLimits/read'); limits = data?.rateLimitsByLimitId?.codex || data?.rateLimits; } catch {}
    }
    return { plan: account.planType || limits?.planType || (account.type === 'apiKey' ? 'api-key' : null),
      quota: normalizeQuota(limits), updated_at: new Date().toISOString() };
  }
  close() {
    this.child.stdin.end();
    const timer = setTimeout(() => { if (this.child.exitCode === null) this.child.kill(); }, 1500); timer.unref();
    this.child.once('exit', () => clearTimeout(timer));
  }
}

async function readAccount(codex, options) {
  const client = new AccountClient(codex, options);
  try { return await client.read(); } finally { client.close(); }
}

module.exports = { AccountClient, readAccount };
