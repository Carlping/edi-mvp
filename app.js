/* EDI MVP — no backend, no PII upload. State lives in localStorage only. */
const KEY = 'edi.v1';
const $ = (s) => document.querySelector(s);
const el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; };
const fmt = (n) => 'NT$ ' + Math.round(n).toLocaleString('zh-Hant');
const pad = (n) => String(n).padStart(2, '0');
const hm = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const AIRLINES = {
  BR: ['長榮航空', 'https://www.evaair.com'], CI: ['中華航空', 'https://www.china-airlines.com'],
  JX: ['星宇航空', 'https://www.starlux-airlines.com'], IT: ['台灣虎航', 'https://www.tigerairtw.com'],
  B7: ['立榮航空', 'https://www.uniair.com.tw'], AE: ['華信航空', 'https://www.mandarin-airlines.com'],
  CX: ['國泰航空', 'https://www.cathaypacific.com'], JL: ['日本航空', 'https://www.jal.co.jp'],
  NH: ['全日空', 'https://www.ana.co.jp'], SQ: ['新加坡航空', 'https://www.singaporeair.com'],
  TG: ['泰國航空', 'https://www.thaiairways.com'], KE: ['大韓航空', 'https://www.koreanair.com'],
  OZ: ['韓亞航空', 'https://flyasiana.com'], VN: ['越南航空', 'https://www.vietnamairlines.com'],
  UA: ['聯合航空', 'https://www.united.com'], DL: ['達美航空', 'https://www.delta.com'],
  AA: ['美國航空', 'https://www.aa.com'], AF: ['法國航空', 'https://www.airfrance.com'],
  KL: ['荷蘭航空', 'https://www.klm.com'], LH: ['漢莎航空', 'https://www.lufthansa.com'],
  BA: ['英國航空', 'https://www.britishairways.com'], EK: ['阿聯酋航空', 'https://www.emirates.com'],
  QR: ['卡達航空', 'https://www.qatarairways.com'], TR: ['酷航', 'https://www.flyscoot.com'],
  MM: ['樂桃航空', 'https://www.flypeach.com'], '7C': ['濟州航空', 'https://www.jejuair.net'],
  VJ: ['越捷航空', 'https://www.vietjetair.com'], '5J': ['宿霧太平洋', 'https://www.cebupacificair.com'],
  PR: ['菲律賓航空', 'https://www.philippineairlines.com'], HX: ['香港航空', 'https://www.hongkongairlines.com'],
  UO: ['香港快運', 'https://www.hkexpress.com'], MU: ['東方航空', 'https://www.ceair.com'],
  CA: ['中國國際航空', 'https://www.airchina.com'], CZ: ['南方航空', 'https://www.csair.com'],
  MH: ['馬來西亞航空', 'https://www.malaysiaairlines.com'], GA: ['印尼鷹航', 'https://www.garuda-indonesia.com'],
  QF: ['澳洲航空', 'https://www.qantas.com'], TW: ["德威航空", 'https://www.twayair.com'],
};
const TW = new Set(['TPE', 'TSA', 'KHH', 'RMQ', 'TNN', 'HUN', 'TTT', 'KNH', 'MZG', 'CYI', 'PIF', 'MFK', 'LZN', 'GNI', 'WOT', 'CMJ']);
const EU = new Set(['CDG', 'ORY', 'AMS', 'FRA', 'MUC', 'DUS', 'HAM', 'BER', 'FCO', 'MXP', 'LIN', 'MAD', 'BCN', 'VIE', 'ZRH', 'GVA', 'CPH', 'ARN', 'OSL', 'HEL', 'BRU', 'DUB', 'LIS', 'WAW', 'PRG', 'BUD', 'ATH', 'NCE', 'LYS', 'LHR', 'LGW', 'STN', 'LTN', 'MAN', 'EDI']);
const US = new Set(['JFK', 'EWR', 'LGA', 'LAX', 'SFO', 'SJC', 'ORD', 'ATL', 'DFW', 'SEA', 'BOS', 'IAD', 'DCA', 'MIA', 'DEN', 'LAS', 'PHX', 'IAH', 'MCO', 'SAN', 'HNL', 'MSP', 'DTW', 'PHL', 'CLT', 'SLT', 'BWI', 'PDX']);

let S = load();
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } }
function save() { localStorage.setItem(KEY, JSON.stringify(S)); }
function log(ev) { S.timeline.push({ t: new Date().toISOString(), ev }); save(); }
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 2200); }

/* ---------- quantiles ---------- */
function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function band(values) {
  const s = [...values].sort((a, b) => a - b);
  return { p16: quantile(s, 0.16), p50: quantile(s, 0.5), p84: quantile(s, 0.84), n: s.length };
}

/* ---------- intake ---------- */
$('#intake-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const now = new Date();
  S = {
    here: f.get('here').toUpperCase(), home: f.get('home').toUpperCase(), flight: (f.get('flight') || '').toUpperCase().replace(/\s/g, ''),
    pax: +f.get('pax'), kids: !!f.get('kids'), card: f.get('card'),
    pref: { time: f.get('pref_time'), risk: f.get('pref_risk') },
    startedAt: now.toISOString(), deadline: new Date(now.getTime() + f.get('hours') * 3600e3).toISOString(),
    quotes: [], photos: [], done: {}, checks: {}, timeline: [],
  };
  log(`開場：${S.here}→${S.home}，航班 ${S.flight || '—'}，期限 ${f.get('hours')}h，${S.pax} 人`);
  render();
});

/* ---------- render ---------- */
function render() {
  if (!S) { $('#intake').classList.remove('hidden'); $('#decision').classList.add('hidden'); return; }
  $('#intake').classList.add('hidden'); $('#decision').classList.remove('hidden');
  renderSummary(); renderTracks(); renderQuotes(); renderCompare(); renderRights(); renderEvidence(); tick();
}

function airline() { const m = S.flight.match(/^([A-Z0-9]{2})/); return m && AIRLINES[m[1]] ? { code: m[1], name: AIRLINES[m[1]][0], url: AIRLINES[m[1]][1] } : null; }
function hoursLeft() { return (new Date(S.deadline) - Date.now()) / 3600e3; }
function costSlope() { // heuristic: TWD per hour of delay (hotel/transport price creep + fewer seats). Editable assumption.
  const h = new Date().getHours(); return (h >= 20 || h < 6 ? 900 : 500) * (S.kids ? 1.5 : 1);
}
function links() {
  const d = new Date(), tmr = new Date(d.getTime() + 864e5);
  const yymmdd = (x) => ymd(x).slice(2).replace(/-/g, '');
  const a = airline();
  return {
    gflights: `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${S.here} to ${S.home} on ${ymd(d)}`)}`,
    gflightsTmr: `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${S.here} to ${S.home} on ${ymd(tmr)}`)}`,
    skyscanner: `https://www.skyscanner.com.tw/transport/flights/${S.here.toLowerCase()}/${S.home.toLowerCase()}/${yymmdd(d)}/?adults=${S.pax}`,
    airline: a ? a.url : `https://www.google.com/search?q=${encodeURIComponent(S.flight + ' 航空公司 改期')}`,
    booking: `https://www.booking.com/searchresults.html?ss=${S.here}+airport&checkin=${ymd(d)}&checkout=${ymd(tmr)}&group_adults=${S.pax}&no_rooms=1&nflt=fc%3D2`,
    gmapsHotel: `https://www.google.com/maps/search/${encodeURIComponent(S.here + ' airport hotel')}`,
    transit: `https://www.google.com/maps/dir/?api=1&origin=${S.here}+airport&destination=${S.home}&travelmode=transit`,
    rome2rio: `https://www.rome2rio.com/map/${S.here}/${S.home}`,
    uber: `https://m.uber.com/ul/?action=setPickup&pickup=my_location`,
    food: `https://www.google.com/maps/search/${encodeURIComponent(S.here + ' airport restaurant')}`,
  };
}

function bestOptions() {
  const dl = new Date(S.deadline);
  const ok = S.quotes.filter((q) => q.arriveAt && new Date(q.arriveAt) <= dl);
  if (!ok.length) return null;
  const prices = band(S.quotes.map((q) => q.price));
  const cheapest = [...ok].sort((a, b) => a.price - b.price)[0];
  const earliest = [...ok].sort((a, b) => new Date(a.arriveAt) - new Date(b.arriveAt))[0];
  const pick = S.pref.time === 'fast' ? earliest : cheapest;
  return { pick, cheapest, earliest, prices };
}

function renderSummary() {
  const a = airline(); const L = links(); const b = bestOptions();
  const floorDone = S.done.rebook && S.done.hotel;
  $('#summary').innerHTML = `
    <h2>${S.here} → ${S.home} <span class="muted">${a ? a.name : ''} ${S.flight}</span></h2>
    <div class="muted">每晚 1 小時預估多花約 <b>${fmt(costSlope())}</b>（假設值：深夜/帶小孩加權）｜ 資料源：目前為手動觀測 + 官網深連結（無 API）</div>
    <h3 style="margin-top:12px">★ 保底（先做，全部可逆）</h3>
    <div class="check"><input type="checkbox" data-done="rebook" ${S.done.rebook ? 'checked' : ''}> 在原航空 App/官網免費改期到明日最早班</div>
    <div class="check"><input type="checkbox" data-done="hotel" ${S.done.hotel ? 'checked' : ''}> 訂一間<b>可免費取消</b>的機場旁旅館</div>
    <div class="check"><input type="checkbox" data-done="voucher" ${S.done.voucher ? 'checked' : ''}> 向地勤索取餐券/旅館券（拿了也可不用）</div>
    <div class="actions">
      <a class="go" target="_blank" rel="noopener" href="${L.airline}">開原航空官網改期</a>
      <a class="go" target="_blank" rel="noopener" href="${L.booking}">Booking 免費取消旅館</a>
    </div>
    <h3 style="margin-top:14px">◇ 改善（有可能今晚回到家）</h3>
    ${b ? `<div><b>${b.pick.label}</b> — <span class="big-num">${fmt(b.pick.price)}</span>
        <div class="muted range">${b.prices.n >= 3 ? `觀測區間 p16–p84：${fmt(b.prices.p16)} – ${fmt(b.prices.p84)}（n=${b.prices.n}）` : `觀測 ${b.prices.n}/3 筆，區間尚不可信`}｜ 到達 ${hm(b.pick.arriveAt)} ✔ 期限內</div>
        <div class="muted">${b.prices.n < 3 ? '再填 1–2 筆看到的價格，或直接決定（每小時成本累積中）。' : b.pick.price <= b.prices.p50 ? '價格在中位數以下，等待的期望改善小於每小時成本 → 建議現在決定。' : '價格高於中位數；若 15 分鐘內沒有更便宜的，仍建議決定（時間成本累積中）。'}</div>
        <div class="actions"><a class="go" target="_blank" rel="noopener" href="${L.gflights}">去官網/比價付款（跳轉，不經本站）</a></div>`
      : `<div class="muted">尚無期限內可到達的觀測價格。先開比價看看今天剩什麼，把看到的價格填進下方「價格觀測」。</div>
        <div class="actions"><a class="go" target="_blank" rel="noopener" href="${L.gflights}">Google Flights 今天</a><a target="_blank" rel="noopener" href="${L.skyscanner}">Skyscanner</a><a target="_blank" rel="noopener" href="${L.gflightsTmr}">明天首班</a></div>`}
    <div class="actions" style="margin-top:12px"><button id="share">分享決策卡給家人</button></div>`;
  $('#floor-state').textContent = floorDone ? '保底完成' : S.done.rebook ? '保底進行中' : '保底未完成';
  $('#floor-state').className = 'pill ' + (floorDone ? 'green' : S.done.rebook ? 'yellow' : 'red');
  $('#summary').querySelectorAll('[data-done]').forEach((c) => c.addEventListener('change', () => { S.done[c.dataset.done] = c.checked; log(`${c.checked ? '完成' : '取消'}：${c.parentNode.textContent.trim()}`); render(); }));
  $('#share').addEventListener('click', shareCard);
}

function renderTracks() {
  const L = links(); const a = airline();
  const t = (color, name, body, acts = '') => `<div class="track"><div class="dot ${color}"></div><div class="name">${name}</div><div class="body">${body}<div class="actions">${acts}</div></div></div>`;
  const link = (h, txt, go) => `<a ${go ? 'class="go"' : ''} target="_blank" rel="noopener" href="${h}">${txt}</a>`;
  $('#tracks').innerHTML = `<h3>平行工作軌</h3>` +
    t(S.done.rebook ? 'g' : 'r', '回程', S.done.rebook ? '明日班已改期；同時看今晚選項' : '先免費改期到明日最早班，再看今晚選項', link(L.airline, '原航空官網', true) + link(L.gflightsTmr, '明天首班') + link(L.gflights, '今天其他航空')) +
    t('y', '客服', `接通時只說三句：① 航班 ${S.flight || '—'} 取消，要求免費改期到最早班或他航 ② 要求提供旅館與餐食（或書面拒絕） ③ 要求<b>書面取消/延誤證明</b>（保險必備）`, link(a ? a.url : L.airline, '航空聯絡頁')) +
    t(S.done.hotel ? 'g' : 'y', '住宿', '航空提供的旅館常遠、要排隊。先自己訂一間可免費取消的，拿到航空券再取消也不虧。', link(L.booking, 'Booking 可免費取消', true) + link(L.gmapsHotel, '地圖看距離')) +
    t('g', '交通', '到旅館或改走陸路回家：交通費多數卡片保險可報，留收據。', link(L.transit, '大眾運輸到 ' + S.home) + link(L.rome2rio, '陸路所有方案') + link(L.uber, 'Uber')) +
    t('g', '餐食', (S.kids ? '帶小孩：先安頓吃飯，再處理其他。' : '') + '餐券先拿；收據留著。', link(L.food, '附近餐廳')) +
    t(S.photos.length ? 'g' : 'y', '證據', `已收 ${S.photos.length} 張；理賠 checklist 完成 ${checkDone()}`, '') +
    t('b', '保險', cardNote(), '');
}

function renderQuotes() {
  const list = $('#quote-list'); list.innerHTML = '';
  S.quotes.forEach((q, i) => list.appendChild(el(`<div class="quote"><span>${q.label}｜到 ${hm(q.arriveAt)}</span><span>${fmt(q.price)} <button data-i="${i}">✕</button></span></div>`)));
  list.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { S.quotes.splice(+b.dataset.i, 1); log('刪除觀測價格'); render(); }));
  const est = $('#estimate');
  if (S.quotes.length >= 3) {
    const b = band(S.quotes.map((q) => q.price));
    const spread = (b.p84 - b.p16) / b.p50;
    est.innerHTML = `<div style="margin-top:10px">價格 ±1σ：<b class="range">${fmt(b.p16)} / ${fmt(b.p50)} / ${fmt(b.p84)}</b> <span class="muted">(p16 / p50 / p84, n=${b.n})</span></div>
      <div class="muted">${spread < 0.5 ? '區間夠窄（<50%），不需再查，決定吧。' : '區間仍寬，再多 1–2 筆觀測會有幫助；但每小時成本約 ' + fmt(costSlope()) + '。'}</div>`;
  } else est.innerHTML = `<div class="muted" style="margin-top:8px">已 ${S.quotes.length}/3 筆</div>`;
}
$('#quote-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const [h, m] = f.get('arrive').split(':').map(Number);
  const arr = new Date(); arr.setHours(h, m, 0, 0); if (arr < new Date()) arr.setDate(arr.getDate() + 1);
  S.quotes.push({ label: f.get('label'), price: +f.get('price'), arriveAt: arr.toISOString() });
  log(`觀測價格：${f.get('label')} ${fmt(+f.get('price'))}`); e.target.reset(); render();
});

function renderCompare() {
  const reimb = S.card === 'none' ? 0 : 0.7; // assumed p50 reimbursement when card insurance applies
  const hotelSelf = 3000 * (S.kids ? 1.2 : 1), taxi = 450;
  const net = (x) => fmt(x * (1 - reimb));
  $('#compare').innerHTML = `<h3>航空提供 vs 自理（保險回補後淨成本）</h3>
    <div class="muted">自理價格為預設假設，請依你看到的實際價格判斷；回補率 ${Math.round(reimb * 100)}% 為常見 p50 假設。</div>
    <table><tr><th>項目</th><th>航空提供</th><th>自理</th><th>建議</th></tr>
    <tr><td>旅館</td><td>免費；常 30–60 分車程、需排隊領券</td><td>${fmt(hotelSelf)} → 淨 ${net(hotelSelf)}；機場旁、可免費取消</td><td class="rec">${S.card === 'none' ? '若旅館券 30 分內拿得到 → 航空' : S.kids ? '自理（小孩早睡值得）' : '自理'}</td></tr>
    <tr><td>接駁</td><td>接駁車，等候不定</td><td>計程車約 ${fmt(taxi)} → 淨 ${net(taxi)}</td><td class="rec">自理</td></tr>
    <tr><td>餐食</td><td>餐券（先拿）</td><td>—</td><td class="rec">拿券再自理</td></tr></table>`;
}

function renderRights() {
  let body;
  if (TW.has(S.here)) body = '<b>台灣出發（民航局規範，簡化）</b>：航空公司應提供餐食、必要時住宿與交通，並協助改搭最早班或退票。要求「書面延誤/取消證明」。';
  else if (EU.has(S.here)) body = '<b>歐盟/英國出發（EC 261 / UK 261，簡化）</b>：取消時可要求改搭或全額退款；等待期間餐食、住宿、交通由航空負責；非特殊情況另有 €250–600 賠償。';
  else if (US.has(S.here)) body = '<b>美國出發（DOT，簡化）</b>：取消可要求現金全額退款；食宿依各航空 Customer Service Plan（多數主要航空承諾可控因素下提供旅館/餐食）。';
  else body = '<b>其他地區</b>：依航空公司運送條款；多數會提供改期與餐食，住宿視原因。一律要求書面證明。';
  $('#rights').innerHTML = `<h3>你的權益（提示，非法律意見）</h3><div>${body}</div>`;
}

const CHECKS = [
  ['cancel_proof', '航空公司書面取消/延誤證明（附原因）'],
  ['ticket', '原機票行程單 + 登機證/訂位代號'],
  ['card_stmt', '用該卡購買機票的刷卡紀錄（保險生效條件）'],
  ['airline_offer', '航空公司已提供/拒絕食宿的證明（secondary 保險要先向航空申請）'],
  ['receipts', '旅館、交通、餐食收據（用同一張卡付）'],
  ['timeline', '時間線：預定起飛、公告延誤、取消時刻（本頁自動記錄）'],
];
function checkDone() { return `${CHECKS.filter(([k]) => S.checks[k]).length}/${CHECKS.length}`; }
function cardNote() {
  const m = { none: '無卡片保險：以航空公司賠償為主；仍保留收據可向航空索賠。', visa_sig: 'Visa 御璽/無限：常見班機延誤/取消保險，門檻多為 4–6 小時，需刷該卡買票；額度與條款以你的卡片權益手冊為準。', mc_world: 'Mastercard 世界/鈦金：常見延誤險，門檻多為 4–6 小時；需收據與航空證明；以權益手冊為準。', amex: 'AmEx：多為 secondary，先向航空/主保險申請後補差額；需書面證明與收據。', jcb: 'JCB 晶緻/極緻：含旅遊不便險，門檻與額度依卡別；以權益手冊為準。' };
  return m[S.card] + ' <span class="warn" style="display:inline-block">各卡差異大，本頁不存你的卡號。</span>';
}
function renderEvidence() {
  $('#checklist').innerHTML = CHECKS.map(([k, t]) => `<label class="check"><input type="checkbox" data-c="${k}" ${S.checks[k] ? 'checked' : ''}> ${t}</label>`).join('');
  $('#checklist').querySelectorAll('input').forEach((c) => c.addEventListener('change', () => { S.checks[c.dataset.c] = c.checked; save(); renderTracks(); }));
  $('#photos').innerHTML = S.photos.map((p) => `<img src="${p.data}" title="${p.t}">`).join('');
}
$('#photo').addEventListener('change', async (e) => {
  for (const f of e.target.files) {
    const data = await shrink(f);
    S.photos.push({ t: new Date().toISOString(), name: f.name, data });
    log(`收據/證據：${f.name}`);
  }
  try { save(); } catch { toast('本機儲存空間已滿，請先匯出理賠包'); }
  render(); toast('已存到本機');
});
function shrink(file) {
  return new Promise((res) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, 1024 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.8));
    };
    img.src = url;
  });
}

$('#export').addEventListener('click', () => {
  const b = S.quotes.length >= 3 ? band(S.quotes.map((q) => q.price)) : null;
  const html = `<!doctype html><meta charset="utf-8"><title>理賠包 ${S.flight} ${ymd(new Date())}</title>
  <body style="font-family:sans-serif;max-width:720px;margin:20px auto">
  <h1>班機取消理賠包</h1><p>航班 ${S.flight || '—'}｜${S.here} → ${S.home}｜${S.pax} 人｜產生於 ${new Date().toLocaleString('zh-Hant')}</p>
  <h2>時間線</h2><ol>${S.timeline.map((x) => `<li>${new Date(x.t).toLocaleString('zh-Hant')} — ${x.ev}</li>`).join('')}</ol>
  <h2>觀測到的替代航班價格</h2><ul>${S.quotes.map((q) => `<li>${q.label}：${fmt(q.price)}，到達 ${new Date(q.arriveAt).toLocaleString('zh-Hant')}</li>`).join('') || '<li>—</li>'}</ul>
  ${b ? `<p>價格 p16/p50/p84：${fmt(b.p16)} / ${fmt(b.p50)} / ${fmt(b.p84)}（n=${b.n}）</p>` : ''}
  <h2>證據清單</h2><ul>${CHECKS.map(([k, t]) => `<li>${S.checks[k] ? '☑' : '☐'} ${t}</li>`).join('')}</ul>
  <h2>收據 / 照片（${S.photos.length}）</h2>${S.photos.map((p) => `<figure><img src="${p.data}" style="max-width:100%"><figcaption>${new Date(p.t).toLocaleString('zh-Hant')} ${p.name}</figcaption></figure>`).join('')}
  </body>`;
  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `claim-pack-${S.flight || 'flight'}-${ymd(new Date())}.html`; a.click();
  log('匯出理賠包');
});

async function shareCard() {
  const b = bestOptions(); const h = hoursLeft();
  const text = `[EDI 決策卡] ${S.here}→${S.home} 航班 ${S.flight} 取消。剩 ${h.toFixed(1)} 小時。保底：${S.done.rebook ? '已' : '未'}改期明日班、${S.done.hotel ? '已' : '未'}訂可取消旅館。` + (b ? ` 改善選項：${b.pick.label} ${fmt(b.pick.price)}。` : '') + ` 比價：${links().gflights}`;
  if (navigator.share) { try { await navigator.share({ text }); } catch { } } else { await navigator.clipboard.writeText(text); toast('已複製到剪貼簿'); }
}

$('#reset').addEventListener('click', () => { if (confirm('清除本機所有資料？（建議先匯出理賠包）')) { localStorage.removeItem(KEY); S = null; render(); } });

function tick() {
  if (!S) return;
  const ms = new Date(S.deadline) - Date.now(); const neg = ms < 0; const a = Math.abs(ms);
  const h = Math.floor(a / 3600e3), m = Math.floor((a % 3600e3) / 60e3), s = Math.floor((a % 60e3) / 1e3);
  $('#clock').textContent = `${neg ? '逾期 ' : '剩 '}${h}h ${pad(m)}m ${pad(s)}s`;
}
setInterval(tick, 1000);
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
