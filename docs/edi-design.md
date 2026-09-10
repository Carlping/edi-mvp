# EDI — Emergency Decision Interface（類 MCP 緊急決策接口）設計

## 0. 一句話

在**時間預算**與**成本預算**內，以 **±1σ（p16 / p50 / p84）區間**而非點估計提供資料，
讓使用者在期限前選出「最壞情況仍可接受、期望值最好」的策略；並在資料價值低於等待成本時**主動停止**。
系統把每個選項**預先執行到只差最後一步**（鎖位、填表、付款預授權），人只做兩件事：**選偏好、按付款**。

---

## 1. 設計原則

| 原則 | 做法 |
|---|---|
| 期限優先 (deadline-first) | 每個請求都帶 `deadline`、`latency_budget_ms`；超時回傳「目前最佳估計 + 信心」而非錯誤 |
| 滿意解而非最佳解 (satisficing) | 只要 p84（壞情況）仍達成硬約束就可行；不追求最低價 |
| 區間而非點 | 所有數值一律 `{p16, p50, p84, n, staleness_s, source_tier}` |
| 成本分層 | Tier0 快取/規則 → Tier1 免費 API → Tier2 付費 API/人力；預算用盡即降級 |
| 先鎖底、再改善 (lock floor, then improve) | 先確保一個「可退/可取消」的保底方案，再平行找更好方案 |
| 停止規則 | 「再查一輪的期望改善」 < 「延遲一輪的成本上升」→ 停止並輸出決策卡 |
| 可解釋、可回溯 | 每張決策卡附資料來源、時間戳、假設，供事後保險理賠 |
| 做到只差一步 (prepare-to-one-tap) | 可逆/零成本動作自動做；不可逆/花錢動作預備到「待確認」狀態，人只按一次 |

---

## 2. 協定（JSON-RPC 2.0，與 MCP 同構）

### 2.1 生命週期

```
initialize  → capabilities
session/open(context, deadline, budget)   → session_id
tools/list · resources/list · prompts/list
tools/call(name, args, envelope)          → result + estimate + meta
session/preferences(ask)                  → 最多 3 題二選一，決定 λ 與過濾條件
session/decide()                          → DecisionCard（含已預備的 actions）
actions/prepare(option_id)                → 鎖位/填表/預授權，回 hold_ttl
actions/commit(action_id, approval)       → 執行付款等不可逆步驟
actions/release(action_id)                → 釋放未採用選項的 hold
session/close()
```

### 2.2 請求包裹（每次 tools/call 必帶）

```json
{
  "envelope": {
    "session_id": "s_123",
    "deadline": "2026-09-10T18:00:00+08:00",
    "latency_budget_ms": 8000,
    "cost_cap": {"currency": "TWD", "amount": 30},
    "confidence_target": {"sigma": 1, "min_n": 3},
    "tier_max": 1,
    "return_partial": true
  }
}
```

### 2.3 統一回應

```json
{
  "result": { "...tool-specific..." },
  "estimate": {
    "value": {"p16": 6200, "p50": 8400, "p84": 12800},
    "unit": "TWD",
    "n": 5,
    "confidence": 0.68,
    "staleness_s": 90
  },
  "meta": {
    "elapsed_ms": 3120,
    "cost_spent": {"amount": 4, "currency": "TWD"},
    "sources": [{"id": "gds-cache", "tier": 0}, {"id": "airline-api", "tier": 1}],
    "partial": false,
    "degraded_reason": null
  }
}
```

規則：
- `n < min_n` 或 `staleness_s` 過大 → `confidence` 下修，仍回傳（不丟錯）。
- 逾時 → `partial: true`、`degraded_reason: "latency_budget"`。
- 逾預算 → 自動降 tier、`degraded_reason: "cost_cap"`。

### 2.4 Option（選項）標準結構

```json
{
  "id": "opt_rebook_other_carrier",
  "label": "改搭 B 航空 21:40 直飛",
  "hard_constraint_ok": {"p16": true, "p50": true, "p84": false},
  "arrival_time":  {"p16": "…", "p50": "…", "p84": "…"},
  "out_of_pocket": {"p16": 3000, "p50": 5500, "p84": 9000, "unit": "TWD"},
  "reimbursable":  {"p16": 0.4, "p50": 0.7, "p84": 0.9},
  "p_success":     {"p16": 0.55, "p50": 0.7, "p84": 0.8},
  "time_to_commit_min": 10,
  "reversible": true,
  "actions": [
    {"id": "a1", "kind": "auto",    "status": "done",     "label": "App 內免費改期至明日 06:50"},
    {"id": "a2", "kind": "prepare", "status": "held",     "label": "鎖位 B 航空 21:40 ×1", "hold_ttl_s": 900},
    {"id": "a3", "kind": "prepare", "status": "held",     "label": "旅館可免費取消預訂", "hold_ttl_s": 3600},
    {"id": "a4", "kind": "gated",   "status": "awaiting_approval", "label": "付款 NT$ 8,400", "requires": ["payment"]}
  ],
  "evidence": ["…"]
}
```

### 2.5 動作分級（Action kinds）

| kind | 條件 | 系統行為 | 人需要做 |
|---|---|---|---|
| `auto` | 可逆 且 零/極低成本（改期、取消免費預訂、拍證據、排隊回撥、索取餐宿券申請） | 立即執行並回報 | 無 |
| `prepare` | 可逆 但佔用資源或有時限（鎖位 hold、旅館免費取消預訂、填好乘客資料、付款預授權 auth-only） | 執行到「待確認」，記錄 `hold_ttl`，到期前提醒或自動續 hold | 無 |
| `gated` | 不可逆 或 花錢（付款 capture、不可退機票、放棄原票權益） | 產生一鍵確認卡，附金額區間與後果 | **按一次** |

`gated` 動作只有兩種輸入：**付款確認** 與 **偏好選擇**（見 §4.4）。其他資訊全部由系統事先補齊。

安全閥：單次 `commit` 金額上限、重複點擊去重（idempotency key）、確認卡顯示「不點會怎樣」（hold 到期自動釋放，退回保底）。

---

## 3. 工具集（Tools）——航班取消情境

| 工具 | 用途 | 預設 tier / 延遲上限 |
|---|---|---|
| `clock.deadline` | 計算剩餘時間、每晚 1 小時的成本斜率 | T0 / 50ms |
| `flights.search` | 同/他航空、鄰近機場、隔天首班；回傳價格與座位區間 | T1 / 6s |
| `ground.alternatives` | 高鐵/火車/巴士/租車到達出發地的時間與費用 | T1 / 3s |
| `airline.channels` | 各聯繫管道（App、電話、櫃台、社群）預估等待時間與成功率 | T0-1 / 2s |
| `rights.entitlements` | 依航線法規（EU261、DOT、台灣民航局）航空公司應提供之食宿/賠償 | T0 / 100ms |
| `insurance.coverage` | 信用卡 secondary insurance：涵蓋項目、上限、自付額、必備文件 | T0 / 100ms |
| `lodging.nearby` | 機場周邊旅館價格/距離區間、可免費取消者 | T1 / 4s |
| `evidence.capture` | 記錄取消通知、時間戳、收據 → 理賠包 | T0 |
| `notify.watch` | 設定監看（座位釋出、價格跌破門檻）→ 推播 | T1 |

Resources（唯讀快取）：`context://booking`、`context://card_benefits`、`context://regulations/{route}`。
Prompts：`decide_under_deadline`、`explain_card_to_human`。

---

## 4. 決策引擎

### 4.1 硬約束過濾
`hard_constraint_ok.p84 == true` 者為「安全選項」；只有 p50 成立者為「賭注選項」。

### 4.2 評分（期望效用，含時間懲罰）

```
score(opt) = -E[out_of_pocket × (1 - reimbursable)]
             - λ_time × E[max(0, arrival - deadline)]
             - λ_risk × (p84_cost - p50_cost)          # 厚尾懲罰
             + λ_rev  × reversible
```
λ 由 `session/open` 的 `risk_profile` 給定（預設保守：λ_risk 高）。

### 4.3 兩軌策略
1. **Floor**：分數最高的「安全選項」，且 `reversible = true` → 立即執行（例如先訂可免費取消的隔日首班 + 可退旅館）。
2. **Improve**：在剩餘預算內平行探索「賭注選項」；只有當其 p84 也達標，或使用者明示接受風險時才替換。

### 4.4 偏好蒐集（最多 3 題，每題二選一，可跳過）

系統只在**排序會因答案翻轉**時才問；答案直接映射到 λ 或過濾條件：

| 問題 | 影響 |
|---|---|
| 「省錢」vs「早到」 | λ_time |
| 「確定到」vs「賭直飛」 | λ_risk、是否允許賭注選項替換保底 |
| 「只接受原航空/聯盟」vs「任何航空/交通」 | flights.search 過濾 |

預設值來自 `context://profile`（歷史選擇），沒有就採保守設定；不回答即用預設繼續。

### 4.5 停止規則
```
ΔV = E[score(best_next_round)] - score(current_best)
C_wait = cost_slope_per_hour × round_duration_hours
stop if ΔV < C_wait  or  budget_left < min_round_cost  or  time_left < commit_time(current_best)
```

---

## 5. 輸出：決策卡（一屏可讀）

```
⏱ 剩餘 21h 12m ｜ 每晚 1h 預估多花 NT$ 600–1,200 ｜ 已花費查詢成本 NT$ 9 / 30

偏好（可跳過）：[省錢] / [早到]      [確定到] / [賭直飛]

★ 保底 —— 已完成，不需動作
  ✔ 已免費改期：明日 06:50 原航空首班（PNR 更新）
  ✔ 已預訂機場旁旅館（免費取消至 22:00）
  ✔ 已送出餐宿券申請、已排隊客服回撥（預估 95 分）
  ✔ 已建立理賠包（取消通知截圖、時間戳、卡片保險條款）
  到達：p50 明 09:30 ｜ p84 明 11:00 ✔ 期限內
  自付：NT$ 2,800–4,900；保險預估回補 60–85%

◇ 改善 —— 已鎖位，只差付款（hold 剩 14:32）
  B 航空 21:40 直飛，乘客資料已填，付款已預授權
  票價 NT$ 8,400（6,200–12,800）｜ 到達 今晚 23:10 ｜ 可退：否
  付款後系統自動：取消旅館、釋放原改期、更新理賠包
  不付款：hold 到期自動釋放，保底維持不變

            ┌──────────────────────────────┐
            │   確認付款 NT$ 8,400（B 航空） │
            └──────────────────────────────┘

✖ 排除：高鐵轉乘（p84 到達超過期限）、電話客服（等待 p50 95 分鐘）

證據：gds-cache 90s 前、airline-api 3 筆、EU261 不適用（依民航局規範）
```

---

## 6. 情境走一遍（時間軸）

| 時間 | 動作 | 工具 |
|---|---|---|
| T+0 | `session/open`（期限 24h、預算 NT$30、保守） | — |
| T+0–1 min | 平行：`rights.entitlements`、`insurance.coverage`、`airline.channels`、`evidence.capture` | T0，<1s |
| T+1–3 min | 平行：`flights.search`（原/他航空/鄰近機場）、`lodging.nearby`、`ground.alternatives` | T1，≤6s |
| T+1–3 min | 平行：`auto` 動作（改期、排隊回撥、餐宿券申請、證據）自動完成 | actions |
| T+3 min | `session/preferences` 問 1–2 題（可跳過）→ `session/decide` → 決策卡 v1；Floor 已就位 | — |
| T+3–5 min | `actions/prepare` 對前 1–2 個改善選項鎖位、填表、預授權 | actions |
| T+5–15 min | 使用者只看確認卡；`notify.watch` 監看座位/價格；hold 到期前續或釋放 | — |
| 使用者按付款 | `actions/commit` → 付款；系統自動 `actions/release` 其他 hold、取消旅館、更新理賠包 | actions |
| 停止 | ΔV < C_wait 或已 commit → 決策卡 final，附理賠包 | — |

---

## 6A. 終端產品：分心狀態下可用（hands-busy, attention-fragmented）

使用者現況：一手拿電話排隊客服、一手安撫小孩、還要查卡片權益、想交通住宿。設計假設：**每次注意力窗口 ≤ 10 秒、單手或只能用語音、隨時被打斷**。

### 6A.1 介面原則

| 原則 | 做法 |
|---|---|
| 一眼看懂 (glanceable) | 首屏只有：剩餘時間、目前保底狀態（綠/黃/紅）、一個待確認按鈕 |
| 單手 / 語音 | 所有 `gated` 動作可用語音確認（「確認付款八千四」）並複誦金額；大按鈕、無需打字 |
| 可中斷續接 | 任何時刻放下手機，回來仍是同一張卡，變動以「自上次以來」差異提示 |
| 推播而非查看 | 只在狀態改變時通知（hold 快到期、客服快接通、座位釋出、需要付款）；其餘靜默 |
| 電話輔助 | 通話中浮動小卡：客服該問的三句話、訂位代號、法規依據；接通時震動提醒 |
| 家庭模式 | 選項一律以「全家 N 人同班同房」計算；優先鄰座、可提早入住、附兒童餐/嬰兒床標記 |
| 一頁分享 | 產生可分享連結給同行者/家人，讓別人幫忙看或幫忙付款 |

### 6A.2 平行工作軌（Tracks）

系統把所有事拆成互不阻塞的軌，每軌一行狀態，使用者只看顏色與一句話：

```
🟢 回程   明 06:50 已改期 ｜ ◇ B航 21:40 已鎖位，差付款（14:32）
🟡 客服   排隊回撥中，預估 38 分 ｜ 接通時要說：取消原因、要求 EU261/民航局賠償、要求旅館
🟢 住宿   航空旅館：45 分車程、2.1★ ｜ 自理：機場旁 3.8★ NT$3,200，保險回補後淨 NT$ 800 ← 建議
🟢 交通   到旅館：計程車 NT$ 450（可報保險） ｜ 航空巴士 22:30 末班
🟢 餐食   餐券申請已送出 ｜ 兒童餐：3 樓 B 區 21:00 前
🟢 證據   已收 6 件 ｜ 理賠包 80%，缺：旅館收據（入住後自動補）
🔵 保險   卡片 secondary：延誤 >6h 每人上限 NT$ 15,000，需先向航空申請 → 已代填申請
```

規則：每軌獨立跑自己的 auto/prepare 動作；只有跨軌相依（例如「付款買 B 航就取消旅館」）才由決策引擎統一處理。

### 6A.3 航空公司安排 vs 自理（差的方案要被看見）

航空公司提供的旅館/餐券常是**免費但品質差、距離遠、要排隊**。每個項目都並排比較，且以「**保險回補後淨成本**」為主指標：

```
項目     航空提供                  自理                       建議
旅館     免費，45 分車程，2.1★，   NT$3,200，5 分鐘，3.8★，    自理（淨 NT$800，
         櫃台排隊 p50 40 分          免費取消，保險 p50 回補 75%   省 1.5h、小孩早睡）
接駁     接駁車 p50 等 50 分       計程車 NT$450，可報保險      自理
餐食     餐券 NT$300/人            —                          先領券再自理
```

決策依據：`net_cost = out_of_pocket × (1 - reimbursable_p50)`，時間換算成本（`cost_slope_per_hour`）加進去；家庭情境時間權重加倍。

### 6A.4 證據與理賠包（背景自動，不佔注意力）

| 時點 | 自動收集 | 來源 |
|---|---|---|
| 取消當下 | 取消通知截圖/推播、原訂位、登機門延誤時間線、航空公告 | App 推播、`evidence.capture`、公開航班狀態 API |
| 與地勤/客服互動 | 通話時間戳、（合法前提下）錄音或即時語音轉文字摘要、拿到的券照片 | 通話輔助卡、相機快捷鍵 |
| 每筆消費 | 旅館/交通/餐食收據（拍照或電子郵件自動抓取）、刷同一張卡以符合保險條件 | 郵件/錢包整合 |
| 完成 | 生成理賠包：時間線 PDF、費用表（含幣別/匹配收據）、保險條款對照、航空拒賠/已賠證明 | `insurance.claim_pack` |

規則：
- 開場即讀 `context://card_benefits`，把**保險要求的證據清單**變成待收集 checklist，缺項才提醒。
- Secondary insurance 通常要求**先向航空公司/主保險申請**：系統代填航空賠償申請並記錄拒/賠結果。
- 消費一律提示「請用 XX 卡付款」以符合保單條件；付款預授權預設綁該卡。
- 理賠包可一鍵匿名分享給信用卡客服或匯出成保險公司要求的格式。

### 6A.5 新增工具

| 工具 | 用途 |
|---|---|
| `call.assist` | 回撥排隊、接通提醒、通話中話術卡、通話摘要入證據 |
| `family.constraints` | 人數/年齡/嬰兒車/特殊需求 → 過濾與加權 |
| `compare.airline_vs_self` | 航空提供 vs 自理的並排比較（淨成本 + 時間） |
| `insurance.claim_pack` | 依保單條款生成證據 checklist 與理賠包 |
| `share.card` | 產生可分享決策卡連結（可授權他人付款） |

---

## 6B. 介面載體選擇：App、語音、還是手機網站？

### 6B.1 比較

| 載體 | 到手時間（緊急當下） | 通話中可用 | 推播 | 付款/預授權 | 分享給家人 | 結論 |
|---|---|---|---|---|---|---|
| 手機網站 / PWA（連結進入） | **秒級**：點簡訊/卡片通知/QR 即開，無需安裝 | 可（切回瀏覽器） | iOS 需加到桌面才可推播 | Apple/Google Pay 可用 | 一個連結 | **主入口** |
| 通訊軟體訊息卡（LINE / WhatsApp / SMS / iMessage） | 秒級，已在手機上 | **最佳**：通話中收訊息、回「1」即可 | 原生推播 | 導回 PWA 付款 | 直接轉傳 | **第二通道 + 推播層** |
| 語音（電話 IVR / 語音助理 / 耳機） | 即時 | 衝突：手機正在講電話；耳機排隊時可用 | 不適用 | 需複誦金額，仍要視覺確認 | 差 | **輸入模式，不是獨立介面** |
| 原生 App | 分鐘級：下載、註冊、機場網路差、電量低 | 可 | 最佳 | 最佳（錢包、背景預授權） | 可 | **只給事前已裝的使用者**（卡片/旅遊平台既有 App 內功能） |

### 6B.2 建議架構：一個核心、三層外殼

```
            ┌──────────────────────────────┐
            │  EDI 核心（協定 + 決策引擎）  │
            └───────┬──────────┬────────────┘
      主入口        │          │          事前註冊者
  PWA 決策卡 ◀──────┘          └──────▶ 原生 App 模組（卡片 App / 航空 App 內嵌）
      ▲                                     ▲
      │ 連結 / 深連結                        │
  訊息通道（LINE/WhatsApp/SMS）：推播、狀態一行、回「1」確認、轉傳
      ▲
  語音：任一外殼內的輸入方式（確認付款、口述收據用途、查狀態）
```

- **入口**：航空取消簡訊、信用卡交易通知、機場 QR、家人轉傳的連結 → 開 PWA，`session/open` 由連結參數（訂位代號、卡片權益 token）預填。
- **狀態與確認**：訊息通道推送一行狀態與確認卡；`gated` 動作在訊息中回「1」或點連結回 PWA 用 Apple/Google Pay 完成。
- **語音**：PWA 與訊息通道皆支援語音輸入；系統以文字 + 語音複誦金額，兩者一致才 commit。
- **原生 App**：只做 PWA 做不到的事——背景抓收據郵件、錢包預授權、通話輔助浮窗、離線快取；以 SDK 形式嵌入信用卡或航空 App，不另做獨立 App。

### 6B.3 降級鏈（網路差、電量低）

1. PWA 正常 → 2. 只剩訊息通道（純文字狀態 + 回覆數字） → 3. 只剩 SMS → 4. 電話 IVR 讀出決策卡與確認碼。
每層都能完成「查狀態 / 確認付款 / 釋放 hold」三個核心動作。

---

## 7. 成本控制細節

- **Tier 預算**：T0 無限；T1 每輪上限 N 次呼叫；T2 需使用者確認。
- **Fan-out with timeout**：多來源平行、以 `latency_budget_ms` 截斷，聚合已回覆者計算分位數。
- **快取與去重**：相同查詢 5 分鐘內走快取（`staleness_s` 誠實標示）。
- **信心夠即停**：`n ≥ min_n` 且 `(p84-p16)/p50 < 0.5` → 不再加查。
- **降級鏈**：付費 API → 免費 API → 歷史分佈先驗（標示 `source_tier: prior`）。

---

## 8. 驗收對照

| 驗收 | 對應 |
|---|---|
| 最短時間決策 | 期限優先包裹、T0 工具 <1s、三分鐘內出第一張決策卡、停止規則 |
| ±1σ 信心 | 所有數值 p16/p50/p84 + n + staleness，硬約束以 p84 判定 |
| 最大優勢策略 | 期望效用 + 厚尾懲罰 + 兩軌（保底/改善） |
| 控制成本 | cost_cap、tier 降級、快取、信心夠即停 |
| 人只做最後一步 | 動作分級 auto/prepare/gated；保底自動完成、改善選項預備到只差付款；偏好最多 3 題二選一 |
| 分心狀態可用 | 平行工作軌、≤10 秒注意力窗口、語音/單手確認、可中斷續接、通話輔助卡 |
| 航空安排可能很差 | 航空提供 vs 自理並排比較，以保險回補後淨成本 + 時間為準 |
| 證據與理賠 | 背景自動收集、依保單生成證據 checklist、代填航空申請、一鍵理賠包 |

---

## 9. 最小實作建議

- 語言：Python/TypeScript，直接用 MCP SDK 的 server 骨架，`envelope` 放在 tool args 內即可相容既有 MCP client。
- 先做 T0 工具（規則、保險、法規、時鐘）+ 一個 T1 `flights.search` mock 回歷史分佈，即可端到端驗證決策卡。
- 動作層先用 mock 的 `actions/prepare|commit|release`（含 hold_ttl 與 idempotency key），驗證「保底全自動、改善一鍵付款」流程；真實接入順序：航空 App/NDC 改期 → 旅館免費取消預訂 → 付款預授權。
- 之後再接真實資料源，每接一個來源就補其 `tier`、`latency`、`cost` 元資料。
