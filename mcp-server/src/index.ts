import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  airlineFor, altAirports, band, cardNote, costSlopeTwdPerHour, deepLinks,
  EVIDENCE_CHECKS, rightsHint, type CardTier,
} from './core.js';

const CARD_TIERS = ['none', 'visa_sig', 'mc_world', 'amex', 'jcb'] as const;

function meta() {
  return {
    generatedAt: new Date().toISOString(),
    freshness: 'static-heuristic',
    disclaimer: '提示，非法律/財務意見；不儲存個資',
  };
}

function result<T extends Record<string, unknown>>(r: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(r) }],
    structuredContent: r,
  };
}

const server = new McpServer({ name: 'edi', version: '0.1.0' });

const iata = () => z.string().length(3).transform((s) => s.toUpperCase());
const prefTime = () => z.enum(['fast', 'cheap']).default('cheap');
const card = () => z.enum(CARD_TIERS).default('none');
const connection = z.object({
  flight: z.string().optional(),
  departAt: z.string().describe('下一段起飛時間 ISO 8601'),
  samePnr: z.boolean().default(true),
  bufferHours: z.union([z.literal(2), z.literal(3)]).default(3),
}).optional().describe('保護轉機：若填，期限 = 下一段起飛 − 緩衝');

const CONN_VERDICT = '期限內能到就直接買，不要等更便宜的——下一段票的價值遠大於這段的價差。';

/* ---------- tool 1: edi_open_case ---------- */
server.registerTool(
  'edi_open_case',
  {
    description: '開始一個班機取消/延誤的緊急決策 case：回傳保底行動所需的連結、權益提示與每小時等待成本。',
    inputSchema: {
      here: iata().describe('目前所在機場 IATA（如 TPE）'),
      home: iata().describe('要回的機場 IATA（如 KHH）'),
      flight: z.string().optional().describe('航班號（如 BR123）'),
      deadlineHours: z.number().min(1).max(72).default(24).describe('幾小時內必須到達'),
      pax: z.number().int().min(1).max(9).default(1),
      kids: z.boolean().default(false),
      card: card().describe('信用卡別（旅遊不便險提示用）'),
      prefTime: prefTime().describe('偏好：cheap 省錢 / fast 早到'),
      connection,
    },
  },
  async ({ here, home, flight, deadlineHours, pax, kids, card: c, prefTime: pref, connection: conn }) => {
    const now = new Date();
    const f = flight ? flight.toUpperCase().replace(/\s/g, '') : undefined;
    const deadline = conn
      ? new Date(new Date(conn.departAt).getTime() - conn.bufferHours * 3600e3).toISOString()
      : new Date(now.getTime() + deadlineHours * 3600e3).toISOString();
    return result({
      caseId: randomUUID(),
      mode: conn ? 'connection' : 'return',
      here, home, flight: f,
      airline: airlineFor(f),
      pax, kids, card: c, prefTime: pref,
      connection: conn ? { ...conn, deadline, altAirports: altAirports(home) } : undefined,
      startedAt: now.toISOString(),
      deadline,
      costSlopeTwdPerHour: costSlopeTwdPerHour(kids, now),
      links: deepLinks({ here, home, pax, flight: f, now }),
      rights: rightsHint(here),
      cardNote: cardNote(c as CardTier),
      meta: meta(),
    });
  },
);

/* ---------- tool 2: edi_price_band ---------- */
server.registerTool(
  'edi_price_band',
  {
    description: '把觀測到的替代航班價格（≥3 筆才有可信區間）算成 p16/p50/p84 並給停止查價的判決。',
    inputSchema: {
      quotes: z.array(z.object({
        label: z.string(),
        price: z.number().positive(),
        arriveAt: z.string().describe('預計到達時間 ISO 8601'),
      })).min(1),
      deadline: z.string().describe('必須到達的期限 ISO 8601'),
      prefTime: prefTime(),
      kids: z.boolean().default(false),
      connection: z.boolean().default(false).describe('保護轉機模式：期限內能到就直接買'),
    },
  },
  async ({ quotes, deadline, prefTime: pref, kids, connection: connMode }) => {
    const now = new Date();
    const dl = new Date(deadline);
    const b = band(quotes.map((q) => q.price));
    const reliable = b.n >= 3;
    const spreadPct = reliable ? Math.round(((b.p84 - b.p16) / b.p50) * 100) : null;
    const eligible = quotes.filter((q) => q.arriveAt && new Date(q.arriveAt) <= dl);
    const pick = eligible.length
      ? (pref === 'fast'
        ? [...eligible].sort((a, z2) => +new Date(a.arriveAt) - +new Date(z2.arriveAt))[0]
        : [...eligible].sort((a, z2) => a.price - z2.price)[0])
      : null;

    const slope = costSlopeTwdPerHour(kids, now);
    const parts: string[] = [];
    let decision: 'decide_now' | 'observe_more' | 'no_eligible';
    if (connMode && pick) {
      decision = 'decide_now';
      parts.push(CONN_VERDICT);
    } else if (!pick) {
      decision = 'no_eligible';
      parts.push('尚無期限內可到達的觀測價格。先開比價看今天剩什麼。');
    } else if (!reliable) {
      decision = 'observe_more';
      parts.push('再填 1–2 筆看到的價格，或直接決定（每小時成本累積中）。');
    } else {
      decision = 'decide_now';
      parts.push(pick.price <= b.p50
        ? '價格在中位數以下，等待的期望改善小於每小時成本 → 建議現在決定。'
        : '價格高於中位數；若 15 分鐘內沒有更便宜的，仍建議決定（時間成本累積中）。');
    }
    if (reliable && !(connMode && pick)) {
      const spread = (b.p84 - b.p16) / b.p50;
      parts.push(spread < 0.5
        ? `區間夠窄（±${Math.round(spread * 50)}%，n=${b.n}），不需再查，決定吧。`
        : `區間仍寬（n=${b.n}），再多 1–2 筆觀測會有幫助；但每小時成本約 NT$ ${Math.round(slope).toLocaleString('zh-Hant')}。`);
    } else if (!reliable) {
      parts.push(`已 ${b.n}/3 筆，滿 3 筆才有可信區間。`);
    }

    const r = (x: number) => Math.round(x);
    return result({
      band: reliable
        ? { p16: r(b.p16), p50: r(b.p50), p84: r(b.p84), n: b.n }
        : { p16: null, p50: null, p84: null, n: b.n },
      reliable,
      spreadPct,
      eligible,
      pick,
      verdict: parts.join(' '),
      decision,
      costSlopeTwdPerHour: slope,
      meta: meta(),
    });
  },
);

/* ---------- tool 3: edi_floor_plan ---------- */
server.registerTool(
  'edi_floor_plan',
  {
    description: '回傳保底（全可逆）+ 改善（跳轉官網付款、需本人確認）的行動清單、權益提示與證據 checklist。',
    inputSchema: {
      here: iata(),
      home: iata(),
      flight: z.string().optional(),
      pax: z.number().int().min(1).max(9).default(1),
      kids: z.boolean().default(false),
      card: card(),
      connection,
    },
  },
  async ({ here, home, flight, pax, kids, card: c, connection: conn }) => {
    const now = new Date();
    const f = flight ? flight.toUpperCase().replace(/\s/g, '') : undefined;
    const links = deepLinks({ here, home, pax, flight: f, now });
    const a = airlineFor(f);
    const alts = altAirports(home);
    const altUrls = links.gflightsAlt.map((x) => x.url);
    const actions = conn
      ? (conn.samePnr
        ? [
          {
            id: 'call_airline', tier: 'auto',
            title: '打原航空客服保住下一段',
            why: `開場一句：「我要保住 ${conn.flight || '下一段'} 這段，請把 ${f || '原航班'} 改到任何能趕上的班，含他航與 ${alts.join('/') || '鄰近機場'}」`,
            link: a ? a.url : links.airline,
            reversible: true,
          },
          {
            id: 'rebook_any', tier: 'prepare',
            title: '改到期限前能到的航班',
            why: 'App 改期若不給他航，走客服。',
            link: a ? a.url : links.airline,
            altLinks: altUrls,
            reversible: true,
          },
          {
            id: 'hold_tomorrow_onward', tier: 'prepare',
            title: '保底：把下一段改到明天同艙等先 hold',
            why: '請航空同時把下一段改到明天同艙等先 hold。',
            reversible: true,
          },
          {
            id: 'buy_improvement', tier: 'gated',
            title: '去官網付款 — 需本人確認',
            why: '付款不可逆且跳轉官網；期限內能到就直接買。',
            link: links.gflights,
            reversible: false,
          },
        ]
        : [
          {
            id: 'hold_tomorrow_onward', tier: 'prepare',
            title: '保底：把下一段改到明天先 hold',
            why: `先打下一段航空，把 ${conn.flight || '下一段'} 改到明天 hold（頭等/商務多可低費改期）。`,
            reversible: true,
          },
          {
            id: 'buy_any_carrier', tier: 'gated',
            title: '買今天任何航空期限前能到的票',
            why: `買今天任何航空到 ${home}/${alts.join('/') || '鄰近機場'} 的票，期限前到就買。`,
            link: links.gflights,
            altLinks: altUrls,
            reversible: false,
          },
          {
            id: 'drive', tier: 'prepare',
            title: '查開車/租車',
            why: '開車若能在期限前到是最確定的方案。',
            link: links.drive,
            altLinks: [links.rental],
            reversible: true,
          },
          {
            id: 'refund_original', tier: 'auto',
            title: '向原航空要求退款',
            why: '向原航空要求退款 + 書面取消證明。',
            link: a ? a.url : links.airline,
            reversible: true,
          },
        ])
      : [
        {
          id: 'rebook_free', tier: 'prepare',
          title: '在原航空 App/官網免費改期到明日最早班',
          why: '先把「一定回得去」的底保住；改期免費且可再改。',
          link: a ? a.url : links.airline,
          reversible: true,
        },
        {
          id: 'hotel_free_cancel', tier: 'prepare',
          title: '訂一間可免費取消的機場旁旅館',
          why: '航空提供的旅館常遠、要排隊；先自訂可取消的，拿到航空券再取消也不虧。',
          link: links.booking,
          reversible: true,
        },
        {
          id: 'voucher', tier: 'auto',
          title: '向地勤索取餐券/旅館券（拿了也可不用）',
          why: '零成本；同時記得要求書面取消/延誤證明（保險必備）。',
          reversible: true,
        },
        {
          id: 'quote_scan', tier: 'auto',
          title: '掃今晚其他航班價格',
          why: '把看到的價格丟進 edi_price_band，滿 3 筆才有可信區間。',
          link: links.gflights,
          altLinks: [links.skyscanner, links.gflightsTmr],
          reversible: true,
        },
        {
          id: 'buy_improvement', tier: 'gated',
          title: '去官網付款 — 需本人確認',
          why: '付款不可逆且跳轉官網；確認 edi_price_band 判決後再下手。',
          link: links.gflights,
          reversible: false,
        },
      ];
    return result({
      mode: conn ? 'connection' : 'return',
      actions,
      ...(conn ? {
        phoneScript: conn.samePnr
          ? [
            `① 我要保住下一段 ${conn.flight || ''}`.trim(),
            `② 把 ${f || '原航班'} 改到任何能趕上的班，含他航/鄰近機場`,
            '③ 不行就改替代路線或明天同艙等，並要求書面證明',
          ]
          : [
            `① 先打下一段航空，把 ${conn.flight || '下一段'} 改到明天 hold`,
            '② 再打原航空要求退款 + 書面取消證明',
          ],
        verdictRule: CONN_VERDICT,
      } : {}),
      rights: rightsHint(here),
      evidence: EVIDENCE_CHECKS.map(([id, text]) => ({ id, text })),
      cardNote: cardNote(c as CardTier),
      links,
      meta: meta(),
    });
  },
);

await server.connect(new StdioServerTransport());
