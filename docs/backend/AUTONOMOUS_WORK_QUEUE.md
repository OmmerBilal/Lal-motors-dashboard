# Autonomous work queue — final technical closure (2026-10-05, commit 780da81)

## Dismantling v2 — canonical workflow (2026-10-06, migrations 0061–0064)

This section replaces the old free-search dismantling flow. The old flow is no longer authoritative: employees no longer
search any received vehicle, owner and manager no longer capture or finish employee work, and a session is no longer
started without an assignment.

Role key: the database role is `dismantling` (product name "Dismantling Employee"). It is used everywhere below.

Canonical flow:
1. Manager (owner, engineer_admin, manager) marks a received, open, not-dismantled vehicle READY FOR DISMANTLING
   (`mark_vehicle_ready`). Nothing is automatic after Receiving. Undo is allowed only before an assignment exists (`undo_vehicle_ready`).
2. Manager assigns the ready vehicle to ONE active `dismantling` employee (`assign_dismantling_vehicle`). Status ASSIGNED.
   One open assignment per vehicle (partial unique index). Reassign is allowed only while ASSIGNED and no session exists
   (`reassign_dismantling_assignment`). Cancel before start returns the vehicle to Ready (`cancel_dismantling_assignment`).
3. The assigned employee sees only their own assignments (`list_my_dismantling_assignments`, `find_my_dismantling_assignment`,
   `get_my_dismantling_workspace`). Search for another employee's vehicle returns "This vehicle is not assigned to you." with no details.
4. Start (`start_dismantling_assignment`, idempotent): ASSIGNED to IN_PROGRESS and one active session linked to the assignment.
   `start_dismantling_session` remains as a compatibility entry that only starts the caller's own assignment.
5. Vehicle evidence: media owner `dismantling_session`, role `vehicle_evidence`, at least one ready photo before Finish.
6. Part capture (employee only): Part Name and Part Details are required (`begin_dismantled_part`, 4 arguments). Then a photo
   (media owner `part`, role `capture`), then "Save Part & Next" (`save_dismantled_part`), which requires the name, details and a
   ready photo. The employee may correct their own capture while IN_PROGRESS (`update_part_capture`) and may abandon an
   unphotographed capture (`abandon_dismantled_part`, which keeps the 0017 not-sellable behaviour).
7. Optional issue (`flag_dismantling_issue`): the list includes the v2 types and the earlier ones.
8. Finish (`finish_dismantling_session`): needs evidence and no unsaved captures. Transactional: session completed, assignment
   COMPLETED, vehicle Dismantled, history and audit written. Retry returns the same result.
9. Manager vehicle-centric record (`get_dismantling_vehicle_record`): assignment, employee, assigned by and time, start and
   finish, parts captured, issues, and "Parts dismantled by <employee>" from that session. Review actions reuse the existing
   RPCs: Approve, Edit & Approve (final part name, category, part number, condition), Keep Later, Mark Duplicate, Reject, and
   Analyze Part (manager and owner only; the employee gets a `forbidden` answer from the AI route).
10. Approval keeps the same `parts` row (lineage: vehicle, assignment, session, employee, capture name and details, photos, history).
    The employee's capture text stays in `capture_name` / `capture_details`. Final catalog fields are not overwritten by capture.

Access rules (server-side):
- `dismantling_sessions`: review roles and the session's own employee can read. No client write policy.
- `vehicles` and `vehicle_events`: a dismantling-only user cannot read or write directly (RLS).
- `media_assets` insert for `dismantling_session` and for a captured `part` is allowed only to the session's employee while the
  session is active. Review roles keep read access. `can_access_media` for `part` includes the session's employee.
- Employee RPCs require role `dismantling`. Owner, manager and engineer_admin are refused for capture, start, finish and issue.

Migrations:
- 0061 readiness columns on vehicles, `dismantling_assignments`, `dismantling_assignment_history`, `dismantling_sessions.assignment_id`,
  `parts.capture_name / capture_details / capture_saved_at`, backfill of 109 legacy sessions (linked by `legacy_session_id`, actor kept), and the assignment RPCs.
- 0062 access policies and read RPCs (list, workload, record, employee lists, workspace).
- 0063 `can_access_media` for dismantling evidence and part photos.
- 0064 regression corrections: abandon (0017 behaviour restored), start vehicle-status checks restored, issue list union.

Tests (DEV, real accounts):
- rpc-dismantling-assignments: 75/75 (readiness, assignment rules, reassignment, employee visibility, start/resume, capture, media ownership, save, finish, review lineage, races, RLS).
- rpc-dismantling 46/46, rpc-processing 57/57, rpc-parts 57/57 (baselines moved to the assignment model; expectation changes are labelled in the files).
- rls-matrix 114/114 (dismantling vehicles removed from the allow list).
- ux-dismantling-flow: browser QA, owner Mark Ready and Assign, employee Start, evidence, two parts, reload resume, issue, Finish, owner record and Keep Later; widths 390, 430, 768 (employee) and 1440 and 390 (owner).

Not built in this round:
- Quick Part Capture mode (a faster single-screen mode). Full capture covers every required field.
- Warehouse, SKU and pricing edits remain with Parts Inventory, as required.
- Analyze Part requires a working OpenAI key. The route refuses the employee correctly.


Status (see LAL_MOTORS_AUTONOMOUS_IMPLEMENTATION_MASTER.txt):
- 01, 02, 03, 04, 05, 06, 07 — IMPLEMENTATION COMPLETE — MANUAL QA PENDING
- 08, 09 — DONE
- 10–15 — IMPLEMENTATION COMPLETE — MANUAL QA PENDING
- 16 — IMPLEMENTATION COMPLETE — MANUAL QA PENDING; OPENAI LIVE CONNECTION NEEDS KEY/ACCOUNT CHECK

Business decisions (not blockers):
1. Customer number format (new customers may be NULL; operational screens use the real name or company).
2. Confirm the Scrap management role set: owner, engineer_admin, manager.
3. Confirm whether an additional Analyze Part image (Take Photo / Choose from Device) is wanted. Today the stored captured photo is the only input.

Operational:
4. OpenAI: supply a valid key or account, then rerun ai-live-smoke and ai-stream-smoke.
5. Manual business QA for every module, as deferred by request.
6. DEV data housekeeping: TEST and TMRG fixtures, and one clean-day daily_close row for 2026-01-01, are recorded in IMPLEMENTATION_PROGRESS.md.

Not pushed. Push only after an explicit instruction in chat.

## Manual QA fix round — 2026-10-05 (local commit 69aca7d)

- Session: tab return no longer remounts the app (`session.tsx`); the proxy fails closed on an access-check error instead of signing out (`proxy.ts`).
- Receive Vehicle deep link from Auction into Receiving, with the same vehicle preselected by id (`vehicle_get`).
- Migration 0059: `receive_vehicle` refuses dismantled vehicles.
- Same-batch duplicate and conflict detection (0056–0058) with server-side commit protection.
- ReviewView render-phase warning fixed.
- Tests: intake batch 12/12, vehicle authority 36/36, vehicle merge 15/15, Receiving flow 8/8, receive guard 6/6, QA round 35/35 (0 React errors in final runs).
- Owner-credential helper added (`dev-credentials.mjs`). route-gate and rpc-vehicles are waiting for `DEV_TEST_OWNER_PASSWORD` in the local `.env.local`.
- Build pending: a running `next dev` process blocks the build output.
- No module status has changed. All modules remain as listed above.
