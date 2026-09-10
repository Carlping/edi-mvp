# EDI — 緊急決策卡 / Emergency Decision Interface (MVP)

**Live:** https://carlping.github.io/edi-mvp/

| 中文 | English |
|---|---|
| 班機在登機門被取消、票價飆升、客服排隊、地勤在發旅館券——你一邊打電話、一邊安頓小孩、一邊想怎麼回家。EDI 把「搜尋結果」變成「可以馬上做的決定」。 | Your flight is cancelled at the gate, fares are spiking, the call-centre queue is long, ground staff are handing out vouchers — and you are on the phone, minding kids, and figuring out how to get home. EDI turns search results into decisions you can act on right now. |

## 這個 MVP 做什麼 / What this MVP does

| 中文 | English |
|---|---|
| **30 秒開場**：所在機場、要回的機場、航班號、幾小時內必須到達、人數、有無小孩、卡別、偏好（省錢/早到、確定到/賭直飛）。 | **30-second intake**: current airport, destination, flight number, deadline in hours, party size, kids, card tier, preferences (cheaper vs earlier, certain vs gamble). |
| **一張決策卡**：剩餘時間倒數、每小時等待成本、★保底（全部可逆：改期、可免費取消旅館、拿餐券）、◇改善（今晚回家的候選）。 | **One decision card**: countdown, hourly cost of waiting, ★ Floor (all reversible: rebook, free-cancel hotel, meal voucher), ◇ Upside (candidates to get home tonight). |
| **±1σ 價格區間**：把你在官網/比價看到的價格填進來（≥3 筆），算 p16 / p50 / p84，並告訴你「區間夠窄，決定吧」或「再查一下」。 | **±1σ price band**: enter fares you see on airline/OTA sites (≥3), get p16 / p50 / p84 and a stop rule: "band is narrow, decide" vs "look once more". |
| **七條平行工作軌**：回程、客服（三句話術）、住宿、交通、餐食、證據、保險——每條一行狀態 + 一鍵跳轉。 | **Seven parallel tracks**: return flight, call-centre (3-line script), lodging, transport, food, evidence, insurance — one status line each, one-tap deep links. |
| **航空提供 vs 自理**：以信用卡保險回補後的淨成本比較。 | **Airline-provided vs self-arranged**: compared on net cost after card-insurance reimbursement. |
| **證據與理賠包**：6 項 checklist、拍照/上傳收據、自動時間線，一鍵匯出單一 HTML 理賠包。 | **Evidence & claim pack**: 6-item checklist, receipt photos, auto timeline, one-tap export to a single HTML claim pack. |
| **付款一律跳轉官網**（航空公司、Booking、Google Flights、Skyscanner、Google Maps、Rome2Rio、Uber），本站不經手金流。 | **All payments redirect to official sites** (airline, Booking, Google Flights, Skyscanner, Google Maps, Rome2Rio, Uber); this site never touches money. |

## 隱私與成本 / Privacy & cost

| 中文 | English |
|---|---|
| 無登入、無後端、無 API key。所有資料（含收據照片）只存在你手機的 `localStorage`，「清除所有資料」即刪除。 | No login, no backend, no API keys. Everything (including receipt photos) lives in your phone's `localStorage`; "Clear all data" wipes it. |
| 純靜態檔案，GitHub Pages 免費託管。 | Pure static files, hosted free on GitHub Pages. |

## 限制 / Limitations

| 中文 | English |
|---|---|
| 票價不是 API 即時資料，是你手動觀測後填入。接 Amadeus 等航班 API 為下一步。 | Fares are not live API data; you enter what you observe. Plugging in a flight API (e.g. Amadeus) is the next step. |
| 旅客權益與信用卡保險為簡化提示，非法律意見；以航空公司文件與卡片權益手冊為準。 | Passenger-rights and card-insurance text is simplified guidance, not legal advice; check airline documents and your card benefits guide. |

## 本機執行 / Run locally

```bash
python3 -m http.server 8787   # then open http://localhost:8787/
```

## 檔案 / Files

- `index.html` — 頁面結構 / page structure
- `app.js` — 全部邏輯（狀態、分位數、深連結、匯出）/ all logic (state, quantiles, deep links, export)
- `app.css` — 手機優先深色樣式 / mobile-first dark theme
- `manifest.json`, `sw.js`, `icon.svg` — PWA（可加到主畫面、離線快取）/ PWA (add-to-home-screen, offline cache)

設計文件（協定、動作分級、介面載體選擇）見 `docs/edi-design.md`。 / Design doc (protocol, action tiers, interface choice): `docs/edi-design.md`.
