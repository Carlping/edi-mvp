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

  // ---- connection-protection case: PIT->JFK, DL123, must catch JL 00:05 tomorrow
  const dep = new Date(now); dep.setDate(dep.getDate() + 1); dep.setHours(0, 5, 0, 0);
  const conn = { flight: 'JL 00:05 JFK→HND', departAt: dep.toISOString(), samePnr: false, bufferHours: 3 };
  const expDeadline = new Date(dep.getTime() - 3 * 3600e3).toISOString();
  const connCase = await call('edi_open_case', {
    here: 'pit', home: 'jfk', flight: 'DL123', pax: 2, kids: true, card: 'visa_sig', connection: conn,
  });
  if (connCase.mode !== 'connection') fail('conn open_case mode');
  if (connCase.deadline !== expDeadline) fail(`conn deadline ${connCase.deadline} != ${expDeadline}`);
  if (JSON.stringify(connCase.connection.altAirports) !== JSON.stringify(['LGA', 'EWR']))
    fail('conn altAirports: ' + JSON.stringify(connCase.connection.altAirports));
  const connPlan = await call('edi_floor_plan', {
    here: 'PIT', home: 'JFK', flight: 'DL123', pax: 2, kids: true, card: 'visa_sig', connection: conn,
  });
  if (connPlan.actions[0].id !== 'hold_tomorrow_onward') fail('conn plan first action: ' + connPlan.actions[0].id);
  if (!connPlan.actions.some((a) => a.id === 'drive')) fail('conn plan missing drive');
  if (!Array.isArray(connPlan.phoneScript)) fail('conn plan missing phoneScript');
  const connBand = await call('edi_price_band', {
    quotes: [{ label: 'DL now', price: 320, arriveAt: new Date(dep.getTime() - 3 * 3600e3 - 600e3).toISOString() }],
    deadline: expDeadline, connection: true,
  });
  if (connBand.decision !== 'decide_now') fail('conn band decision: ' + connBand.decision);
  if (!connBand.verdict.includes('直接買')) fail('conn band verdict');

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
