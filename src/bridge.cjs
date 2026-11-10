const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const META_FIELDS = ['event', 'session_id', 'turn_id', 'transcript_path', 'cwd', 'model'];

function metadata(data) {
  return Object.fromEntries(META_FIELDS.filter(field => typeof data[field] === 'string').map(field => [field, data[field]]));
}

function publishEvent(data, { env = process.env, request = http.request } = {}) {
  let target;
  try { target = new URL(env.NOTDEX_OVERLAY_ENDPOINT); } catch { return Promise.resolve(false); }
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.pathname !== '/event' || target.username || target.password || target.search || target.hash || !env.NOTDEX_OVERLAY_TOKEN) return Promise.resolve(false);
  const body = JSON.stringify(metadata(data));
  return new Promise(resolve => {
    try {
      const req = request(target, { method: 'POST', headers: { authorization: 'Bearer ' + env.NOTDEX_OVERLAY_TOKEN,
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, response => {
        response.resume(); resolve(response.statusCode === 204);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => { req.destroy(); resolve(false); });
      req.end(body);
    } catch { resolve(false); }
  });
}

function createEventReceiver({ token, onEvent }) {
  const expected = Buffer.from('Bearer ' + token);
  return http.createServer((req, res) => {
    const supplied = Buffer.from(req.headers.authorization || '');
    if (req.headers.origin || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) { res.writeHead(401).end(); return; }
    if (req.method !== 'POST' || req.url !== '/event') { res.writeHead(404).end(); return; }
    const chunks = []; let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 65536) { res.writeHead(413).end(); req.destroy(); } else chunks.push(chunk);
    });
    req.on('error', () => {});
    req.on('end', () => {
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!['prompt', 'stop'].includes(data.event) || typeof data.session_id !== 'string' || Object.keys(data).some(key => !META_FIELDS.includes(key))) throw Error('Invalid metadata');
        onEvent(metadata(data)); res.writeHead(204).end();
      } catch { res.writeHead(400).end(); }
    });
  });
}

module.exports = { metadata, publishEvent, createEventReceiver };
