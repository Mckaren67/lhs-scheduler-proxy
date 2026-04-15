# Aria Strategic Plan — Lifestyle Home Service

## 13. Task System Build Plan

### Phase 1 — Core System — COMPLETE
Status: COMPLETED April 13 2026 — all 10 tests pass
Goal: Get Karen off her paper notebook immediately

Features to build:
- 8 task categories with auto-classification
- Auto-assignment Karen, Aria, Michael
- Time estimation per task
- Delegation buttons — tap to reassign on dashboard
- Overdue task alerts via SMS
- Task creation via SMS to Aria
- Recurring tasks — daily weekly monthly
- End of day summary with Aria time saved
- Aria logs everything she does as completed tasks
- Mobile optimized dashboard
- Search and filter on dashboard

### Phase 2 — Intelligence Layer — Build After Phase 1 Stable
Status: NOT STARTED
Features:
- Task templates — new client, offboarding, complaint
- Client and cleaner linked tasks
- Task notes via SMS and voice
- Snooze and reschedule with SMS reminder
- Weekly Monday morning report
- Task ROI calculator — dollar value of Aria work
- Aria proactive task suggestions
- HCP auto task creation on events

### Phase 3 — Commercial Features — Build Month 2
Status: NOT STARTED
Features:
- White label ready for Playbook platform
- Multi-business support
- Advanced analytics and reporting

### How To Resume Any Session
Say: "Where are we on the project?"
Claude will read this document and give full status update.

## 14. Current Build Status — Update This After Every Session

### Completed and Live
- SMS brain — incoming-sms.js modular refactor ✅
- SMS date specific schedule queries ✅
- SMS schedule vs tasks intent detection ✅
- Voice line — ElevenLabs native Twilio integration ✅
- Dashboard — tasks.html loading correctly ✅
- Upstash Redis permanent storage ✅
- 177 clients and 20 cleaners in knowledge base ✅
- 28 page SOP library ingested ✅
- Caller recognition — Karen and Michael ✅
- Employee offboarding SOP ✅
- Daily learning SMS at 7pm ✅
- Evening summary ✅
- TMOR system ✅
- Time awareness — Pacific time with daylight saving ✅
- Persona memory — all cleaners and clients ✅

- Task system Phase 1 — complete, all features live ✅
  - 8-category auto-classification ✅
  - 3-person assignment (Karen/Aria/Michael) ✅
  - Time estimation per task ✅
  - Delegation buttons on dashboard ✅
  - Task creation via SMS ✅
  - Task reassignment via SMS ✅
  - Recurring tasks (daily/weekly/monthly) ✅
  - Aria self-logging with time saved ✅
  - Aria Impact panel on dashboard ✅
  - Mobile responsive dashboard ✅
  - 12 real LHS tasks seeded ✅

- Claude as 4th task assignee ✅
- SMS conversation context memory (5 min TTL) ✅
- Calendar day click — 30% detail panel ✅
- Live Pacific time clock in dashboard ✅
- Session starter page (start-session.html) ✅
- Operations manual (guide.html — 12 sections) ✅
- Equipment emergency SOP + Sunday check cron ✅
- ElevenLabs support ticket documented ✅

- Dialpad call learning integration ✅
  - Hourly cron fetches Dialpad AI recaps
  - Claude extracts learnings per call
  - Auto-creates tasks from action items
  - Dedup tracking prevents reprocessing
  - 7 calls processed, 26 learnings, 11 tasks created

- Payroll status tracking system ✅
- Wednesday 9am payroll reminder SMS cron ✅
- 7pm evening summary — complete rewrite April 14 ✅
  - 4 contributors (Karen/Michael approx, Aria/Claude saved)
  - AI value = only Aria + Claude at $25/hr
  - No HCP job counts — task focused only
  - Fixed undefined tasks bug
  - STILL PENDING + KAREN'S PRIORITIES TOMORROW
- PAYROLL SMS keyword handler ✅
- Task cleanup and dedup audit ✅
- Jenna Braich dispute consolidated ✅

- HCP write operations module ✅
  - reassignJob, rescheduleJob, addJobNote, createCustomer
  - Employee ID mapping with cache
  - getJobsForCleaner, findAvailableCleaners
  - All 6 operations tested against live HCP API
- Fuzzy name matching for clients and cleaners ✅

- Payroll April 7-13 COMPLETED April 15 2026 ✅
- 4 industry research documents analyzed ✅
- 18 action items (A-R) framework designed ✅
- Team Lead framework designed ✅
- LHS Reliability Program designed ✅
- Karen interview findings documented ✅
- Karen meeting agenda prepared ✅

### In Progress Right Now
- HCP webhook receiver (I) — highest priority
- Sick day protocol wired into HCP writes (M)
- Karen meeting prep — Thu/Fri/Sat this week

### Next Build Session Priorities
1. HCP webhook receiver /api/hcp-webhook
2. Job completed automation (J)
3. Job canceled automation (K)
4. Invoice payment failed automation (L)
5. Client notes session prep for Karen meeting (N)

### Action Items F-H — Starting Next Week
F. Designate 2 Residential Daytime Team Leads
G. Schedule Freeze — Employee Facing (Two-Tier)
H. Lockout Fee Policy

### Pending Decisions
- Team Lead candidates — Karen and Michael to decide
- Team Lead pay premium amount
- HCP plan level — Basic Essentials or MAX?
- HCP CSR AI $140/month trial — yes or no?
- 1Password Business — now or closer to sale?
- Port 604-260-1925 — yes or no?
