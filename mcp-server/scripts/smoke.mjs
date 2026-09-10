/* Smoke test: spawn the server, speak JSON-RPC over stdio (newline-delimited),
   list tools, call all 3, assert band quantiles. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srv = spawn('node', [join(root, 'dist', 'index.js')], { stdio: ['pipe', 'pipe', 'inherit'] });

let buf = '';
const pending = new Map();
let nextId = 1;
const tools = {};

srv.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

const send = (method, params) => new Promise((res, rej) => {
  const id = nextId++;
  pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result)));
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const notify = (method, params) =>
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');

const fail = (msg) => { console.error('FAIL:', msg); srv.kill(); process.exit(1); };

try {
  const init = await send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'edi-smoke', version: '0.1.0' },
  });
  if (!init?.serverInfo) fail('no serverInfo in initialize');
  notify('notifications/initialized', {});

  const list = await send('tools/list', {});
  const names = (list.tools || []).map((t) => t.name).sort();
  if (names.length !== 3) fail(`expected 3 tools, got ${names.length}: ${names}`);

  const call = async (name, args) => {
    const r = await send('tools/call', { name, arguments: args });
    const data = r.structuredContent ?? JSON.parse(r.content[0].text);
    return data;
  };

  const now = new Date();
  const inH = (h) => new Date(now.getTime() + h * 3600e3).toISOString();
  const tmr8 = new Date(now); tmr8.setDate(tmr8.getDate() + 1); tmr8.setHours(8, 0, 0, 0);

  tools.edi_open_case = await call('edi_open_case', {
    here: 'tpe', home: 'khh', flight: 'BR123', deadlineHours: 24,
    pax: 2, kids: true, card: 'visa_sig', prefTime: 'cheap',
  });
  tools.edi_price_band = await call('edi_price_band', {
    quotes: [
      { label: 'JX 8400', price: 8400, arriveAt: inH(4) },
      { label: 'CI 6200', price: 6200, arriveAt: inH(6) },
      { label: 'BR 4500', price: 4500, arriveAt: tmr8.toISOString() },
    ],
    deadline: inH(24),
    prefTime: 'cheap', kids: true,
  });
  tools.edi_floor_plan = await call('edi_floor_plan', {
    here: 'TPE', home: 'KHH', flight: 'BR123', pax: 2, kids: true, card: 'visa_sig',
  });

  const b = tools.edi_price_band.band;
  const exp = { p16: 5044, p50: 6200, p84: 7696, n: 3 };
  for (const k of Object.keys(exp)) {
    if (b[k] !== exp[k]) fail(`band.${k}: expected ${exp[k]}, got ${b[k]}`);
  }
  if (tools.edi_open_case.airline?.code !== 'BR') fail('open_case airline should be BR');
  if ((tools.edi_floor_plan.actions || []).length < 5) fail('floor_plan actions < 5');

  console.log('tools:', names.join(', '));
  console.log('band:', JSON.stringify(b));
  console.log('decision:', tools.edi_price_band.decision);
  console.log('PASS');
  srv.kill();
  process.exit(0);
} catch (e) {
  fail(e.stack || String(e));
}
