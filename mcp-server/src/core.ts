/* Pure logic ported from ../app.js — no DOM, no localStorage. */

export const AIRLINES: Record<string, [string, string]> = {
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
  QF: ['澳洲航空', 'https://www.qantas.com'], TW: ['德威航空', 'https://www.twayair.com'],
};

export const TW = new Set(['TPE', 'TSA', 'KHH', 'RMQ', 'TNN', 'HUN', 'TTT', 'KNH', 'MZG', 'CYI', 'PIF', 'MFK', 'LZN', 'GNI', 'WOT', 'CMJ']);
export const EU = new Set(['CDG', 'ORY', 'AMS', 'FRA', 'MUC', 'DUS', 'HAM', 'BER', 'FCO', 'MXP', 'LIN', 'MAD', 'BCN', 'VIE', 'ZRH', 'GVA', 'CPH', 'ARN', 'OSL', 'HEL', 'BRU', 'DUB', 'LIS', 'WAW', 'PRG', 'BUD', 'ATH', 'NCE', 'LYS', 'LHR', 'LGW', 'STN', 'LTN', 'MAN', 'EDI']);
export const US = new Set(['JFK', 'EWR', 'LGA', 'LAX', 'SFO', 'SJC', 'ORD', 'ATL', 'DFW', 'SEA', 'BOS', 'IAD', 'DCA', 'MIA', 'DEN', 'LAS', 'PHX', 'IAH', 'MCO', 'SAN', 'HNL', 'MSP', 'DTW', 'PHL', 'CLT', 'SLT', 'BWI', 'PDX']);

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/* ---------- quantiles ---------- */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function band(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  return { p16: quantile(s, 0.16), p50: quantile(s, 0.5), p84: quantile(s, 0.84), n: s.length };
}

/* ---------- airline ---------- */
export function airlineFor(flight: string | undefined | null) {
  if (!flight) return null;
  const m = flight.toUpperCase().replace(/\s/g, '').match(/^([A-Z0-9]{2})/);
  return m && AIRLINES[m[1]] ? { code: m[1], name: AIRLINES[m[1]][0], url: AIRLINES[m[1]][1] } : null;
}

/* heuristic: TWD per hour of delay (hotel/transport price creep + fewer seats). Assumption. */
export function costSlopeTwdPerHour(kids: boolean, now: Date = new Date()): number {
  const h = now.getHours();
  return (h >= 20 || h < 6 ? 900 : 500) * (kids ? 1.5 : 1);
}

export interface LinkCtx {
  here: string;
  home: string;
  pax: number;
  flight?: string;
  now?: Date;
}

export function deepLinks({ here, home, pax, flight, now = new Date() }: LinkCtx) {
  const d = now, tmr = new Date(d.getTime() + 864e5);
  const yymmdd = (x: Date) => ymd(x).slice(2).replace(/-/g, '');
  const a = airlineFor(flight);
  return {
    gflights: `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${here} to ${home} on ${ymd(d)}`)}`,
    gflightsTmr: `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${here} to ${home} on ${ymd(tmr)}`)}`,
    skyscanner: `https://www.skyscanner.com.tw/transport/flights/${here.toLowerCase()}/${home.toLowerCase()}/${yymmdd(d)}/?adults=${pax}`,
    airline: a ? a.url : `https://www.google.com/search?q=${encodeURIComponent((flight || '') + ' 航空公司 改期')}`,
    booking: `https://www.booking.com/searchresults.html?ss=${here}+airport&checkin=${ymd(d)}&checkout=${ymd(tmr)}&group_adults=${pax}&no_rooms=1&nflt=fc%3D2`,
    gmapsHotel: `https://www.google.com/maps/search/${encodeURIComponent(here + ' airport hotel')}`,
    transit: `https://www.google.com/maps/dir/?api=1&origin=${here}+airport&destination=${home}&travelmode=transit`,
    rome2rio: `https://www.rome2rio.com/map/${here}/${home}`,
    uber: `https://m.uber.com/ul/?action=setPickup&pickup=my_location`,
    food: `https://www.google.com/maps/search/${encodeURIComponent(here + ' airport restaurant')}`,
  };
}

/* Plain-text versions of the four bodies in app.js renderRights(). */
export function rightsHint(here: string): string {
  if (TW.has(here)) return '台灣出發（民航局規範，簡化）：航空公司應提供餐食、必要時住宿與交通，並協助改搭最早班或退票。要求「書面延誤/取消證明」。';
  if (EU.has(here)) return '歐盟/英國出發（EC 261 / UK 261，簡化）：取消時可要求改搭或全額退款；等待期間餐食、住宿、交通由航空負責；非特殊情況另有 €250–600 賠償。';
  if (US.has(here)) return '美國出發（DOT，簡化）：取消可要求現金全額退款；食宿依各航空 Customer Service Plan（多數主要航空承諾可控因素下提供旅館/餐食）。';
  return '其他地區：依航空公司運送條款；多數會提供改期與餐食，住宿視原因。一律要求書面證明。';
}

export const EVIDENCE_CHECKS: ReadonlyArray<readonly [string, string]> = [
  ['cancel_proof', '航空公司書面取消/延誤證明（附原因）'],
  ['ticket', '原機票行程單 + 登機證/訂位代號'],
  ['card_stmt', '用該卡購買機票的刷卡紀錄（保險生效條件）'],
  ['airline_offer', '航空公司已提供/拒絕食宿的證明（secondary 保險要先向航空申請）'],
  ['receipts', '旅館、交通、餐食收據（用同一張卡付）'],
  ['timeline', '時間線：預定起飛、公告延誤、取消時刻（本頁自動記錄）'],
];

export type CardTier = 'none' | 'visa_sig' | 'mc_world' | 'amex' | 'jcb';

export function cardNote(card: CardTier): string {
  const m: Record<CardTier, string> = {
    none: '無卡片保險：以航空公司賠償為主；仍保留收據可向航空索賠。',
    visa_sig: 'Visa 御璽/無限：常見班機延誤/取消保險，門檻多為 4–6 小時，需刷該卡買票；額度與條款以你的卡片權益手冊為準。',
    mc_world: 'Mastercard 世界/鈦金：常見延誤險，門檻多為 4–6 小時；需收據與航空證明；以權益手冊為準。',
    amex: 'AmEx：多為 secondary，先向航空/主保險申請後補差額；需書面證明與收據。',
    jcb: 'JCB 晶緻/極緻：含旅遊不便險，門檻與額度依卡別；以權益手冊為準。',
  };
  return m[card] + ' 各卡差異大，本頁不存你的卡號。';
}
