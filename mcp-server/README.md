# edi-mcp-server

| 中文 | English |
|---|---|
| 把 EDI 的緊急決策邏輯包成 MCP server，用 stdio 暴露 3 個工具：`edi_open_case`（開案：連結/權益/每小時成本）、`edi_price_band`（票價 p16/p50/p84 + 停止查價判決）、`edi_floor_plan`（保底+改善行動清單）。僅 stdio，不存任何個資；所有數字皆為假設性的 heuristic，非法律/財務意見。 | An MCP server that exposes EDI's emergency-decision logic as 3 tools over stdio: `edi_open_case` (open a case: links/rights/hourly cost), `edi_price_band` (fare p16/p50/p84 + stop-search verdict), `edi_floor_plan` (floor + upside action list). Stdio only, no PII stored; all numbers are heuristic assumptions, not legal/financial advice. |
| `edi_open_case` / `edi_floor_plan` 接受 `connection`（保護轉機）：填 `{departAt, samePnr, bufferHours}` 後期限自動 = 下一段起飛 − 緩衝，`edi_floor_plan` 依「同一張票 / 分開買」回傳對應行動清單（含鄰近機場與開車/租車）；`edi_price_band` 傳 `connection:true`，有期限內選項即直接判決「現在買」。 | `edi_open_case` / `edi_floor_plan` accept `connection` (protect onward flight): pass `{departAt, samePnr, bufferHours}` and the deadline becomes departure minus buffer; `edi_floor_plan` returns a same-PNR vs separate-ticket action list (with nearby-airport and drive/rental options); pass `connection:true` to `edi_price_band` and it immediately rules "buy now" when any option arrives within the deadline. |

## Build & run / 建置與執行

```bash
cd mcp-server
npm install
npm run build     # tsc → dist/
npm run smoke     # JSON-RPC stdio smoke test → PASS
npm start         # runs the server on stdio
```

## Claude Desktop config / 設定範例

```json
{"mcpServers":{"edi":{"command":"node","args":["/ABS/PATH/edi-mvp/mcp-server/dist/index.js"]}}}
```

## Example prompt / 範例提示

> 我在 TPE，BR123 取消了，我要回 KHH，24 小時內要到，兩大一小，卡片是 Visa 御璽。幫我開個 case 並給我行動清單。
> (I'm at TPE, BR123 cancelled, need to get back to KHH within 24h, 2 adults + a kid, Visa Signature. Open a case and give me the action plan.)

> 我在 PIT，DL123 取消了，但我必須趕上明天 00:05 從 JFK 飛 HND 的 JL 航班，兩張票分開買的。幫我列保住轉機的行動。
> (I'm at PIT, DL123 cancelled, but I must catch tomorrow's 00:05 JL flight JFK→HND on a separate ticket. Give me the plan to protect the connection.)
