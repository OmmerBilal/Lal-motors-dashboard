# Autonomous work queue (crash recovery only)

Resume from the first unchecked item. Verify each claimed item against the repo and the live DEV
database before trusting it. Details live in IMPLEMENTATION_PROGRESS.md.

- [x] Database foundation (0001)
- [x] Auth / RBAC + route gate (0002, proxy)
- [x] Storage / media (0003, media API, variants)
- [x] Proxy latency fix (getClaims + 15 s access cache)
- [x] Payment + stock RPCs (0004, 0005) — 63/63
- [x] Vehicle RPCs (0006): match_or_create, close, assign_carrier, update_transport_status, receive_vehicle — 55/55
- [~] Vehicle real-data integration: list, search, filters, KPIs, pagination, close, reopen, intake review (duplicate check via find_vehicle_match, commit via match_or_create_vehicle) are DB-backed. STILL MOCK: vehicle detail, completion queue, corrections, and the provider state read by Dispatch, Dismantling and Owner dashboard. Migrations 0007-0011. Tests: read-vehicles 23/23, rpc-vehicles 59/59.
- [x] Central Dispatch on real data: counts (0012), carrier directory (dispatch-only writes), per-vehicle batch assign (0014), transport status, problem, local post. External API NOT CONNECTED. Tests dispatch.mjs 24/24.
- [x] Vehicle Receiving on real data: typed lookup (Not Found / Already Received / Ready), 4 arrival photos via shared MediaCapture, receive_vehicle RPC. Scan and OCR NOT connected (typed entry only). Problem reporting NOT connected. Browser/mobile QA NOT run.
- [x] Shared MediaCapture component (src/components/media/media-capture.tsx) + client upload (src/lib/media/client-upload.ts)
- [ ] Dismantling RPCs (start/finish/flag)
- [ ] Dismantling Employee App on real data (+ shared media component)
- [ ] Part review RPCs (approve / edit-approve / reject / duplicate)
- [ ] Dismantling Processing on real data
- [ ] Parts Inventory on real data
- [ ] Customers on real data
- [ ] Quotes / Sales on real data (uses 0004 RPCs)
- [ ] Payments UI on real data (uses 0004 RPCs)
- [ ] Scrap RPCs + driver app + manager
- [ ] Container RPCs + loader app
- [ ] Export RPCs (immutability tests)
- [ ] Owner dashboard real data
- [ ] Manager dashboards real data
- [ ] Admin AI (explicit, server-side, human-approved)
- [ ] E2E workflows
- [ ] Mobile QA 390/430/768 and desktop 1366/1440
- [ ] Security regression (attack matrix)
- [ ] Performance regression
- [ ] Final report

External, NOT CONNECTED: Central Dispatch API, eBay, Shopify, Meta, TikTok, OpenAI (no key used).
