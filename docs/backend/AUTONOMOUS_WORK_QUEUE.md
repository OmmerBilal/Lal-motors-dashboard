# Autonomous work queue — after closure (2026-10-05)

Done in this phase (see IMPLEMENTATION_PROGRESS.md for commits and counts):
- Modules 01, 02, 03 implementation complete — manual QA pending.
- Modules 15, 16 implementation complete — manual QA pending (16: OpenAI key check needed).
- Modules 10–14 implementation complete — manual QA pending (unchanged this phase).
- Modules 08, 09 done.

Open, in priority order:
1. Module 04: run a full dismantling session start-to-finish in a browser (DEV fixture vehicle).
2. Module 05: connect "Analyze Part" (manager/admin only) through the Module 16 explicit path; add a browser test for review actions once a pending review item exists in DEV.
3. Module 06: browser upload test for a part photo (camera and device); part detail sections; a real Out of Stock row assertion.
4. Module 07: browser create (with duplicate warning), edit and detail flows.
5. Business decisions (not blockers): scrap office role for auction; customer number format; whether receiving requires photos beyond the four arrival slots.
6. OpenAI: provide a valid key/account, then rerun ai-live-smoke and ai-stream-smoke.
7. Manual QA for Modules 01–03, 10–16 (deferred by request).
