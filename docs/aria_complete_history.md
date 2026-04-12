# Aria Complete History & Build Documentation

**Version:** 1.0
**Last Updated:** April 12, 2026
**Author:** Michael Butterfield (Owner, Lifestyle Home Service)
**Built with:** Claude Code (Opus 4.6, 1M context)

---

## 1. Executive Summary

Aria is an AI-powered voice and SMS scheduling assistant built for Lifestyle Home Service (LHS), a residential and commercial cleaning company based in Chilliwack, BC, Canada. She manages 20 cleaners and 177 clients.

**What Aria Does:**
- Answers SMS from Karen, cleaners, and clients 24/7
- Handles voice calls via ElevenLabs Conversational AI
- Manages tasks, follow-ups, and reminders
- Processes sick day cascades with automatic replacements
- Plans stat holiday rescheduling with client notifications
- Monitors Gmail and drafts professional replies
- Sends morning, afternoon, and evening briefings
- Tracks workforce capacity and hiring needs
- Learns from every interaction and gets smarter daily
- Recognizes callers by phone number and greets by name

**Built in:** 6 days (April 6-12, 2026) across two Claude Code sessions:
- Session 1 (Apr 6-10): 136 prompts, core build
- Session 2 (Apr 10-12): 18 prompts, email analysis + modular refactor

---

## 2. Contact Records & Account IDs

### People

| Person | Role | Phone | Email |
|--------|------|-------|-------|
| Michael Butterfield | Owner | +16042601925 | michael@lifestylehomeservice.com, butterfield.mr@gmail.com |
| Karen McLaren | Manager | +16048009630 (admin) | karen@lifestylehomeservice.com |
| Bill Gee | Bookkeeper | 778-984-2831 | bill@canaccess.one |
| Tris Yung | SEO/Marketing | — | tris@oneclickrank.com |

### Key Accounts

| Account | Type | Contacts |
|---------|------|----------|
| Prokey Living | Post-construction, property mgmt | Ethan Johnston (ethanj@prokey.ca), Michaila McLay (michailam@prokey.ca) |
| Westbow Construction | Post-construction | Amanda Bosma (amandab@westbow.ca) — AP Manager, Melissa Gaitan (melissag@westbow.ca) — AP |
| Six Cedars Contracting | Post-construction | Justin Delooff — PM (604-845-0506) |
| Valley Toyota | Commercial weekly | Security code 0301, weekly Thursdays with Kelly K |

### Service Accounts

| Service | ID / Number |
|---------|-------------|
| ElevenLabs Agent | agent_5301knm3eyy7en7snw8gf72ht8eh |
| Twilio SMS Number | +16043303997 |
| LHS Main Line | 604-260-1925 |
| Aria SMS Number | 778-200-6517 |
| Redis Database | lhs-aria-kb (Upstash) |
| Voice ID | RaFzMbMIfqBcIurH6XF9 |

### Active Cleaner Roster (as of April 2026)

April W, Rebecca D, Genevieve O, Nicole D, Amber J, Kelly K, Alissa D, Lacy Donald, Kristen K, Paula A, Brandi M, Cathy W, Holly D, Margret W, Vanessa A, Danielle B, Terrie Lee Birston, Anna F, Natasha Cranley

**Inactive:** Emily F, Lorissa W (last day Mar 26), Julieta S (last day Mar 26)

### Cleaner Availability Restrictions

- Brandi M: Mornings ONLY (until 2:30 PM) Mon-Thu. OFF all day Friday.
- Holly D: OFF Wednesday and Thursday
- Danielle B: OFF Thursday
- Paula A: OFF Friday
- Vanessa A: OFF Thursday and Friday
- Kristen K: Saturday ONLY

---

## 3. Technical Architecture

### Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Vercel Serverless Functions (Node.js, ESM) |
| AI (SMS) | Claude Sonnet 4.5 with 17 tools |
| AI (Voice) | Claude Haiku 4.5 via ElevenLabs Custom LLM |
| SMS | Twilio |
| Voice | ElevenLabs Conversational AI |
| Scheduling | HouseCall Pro API |
| Storage | Upstash Redis (lhs-aria-kb) |
| Email | Gmail API (OAuth2) |
| Calls | Dialpad (transcripts), Twilio (outbound) |
| Dashboard | Vercel static (lhs-knowledge-base) |
| Source | GitHub: Mckaren67/lhs-scheduler-proxy + Mckaren67/lhs-knowledge-base |

### Vercel Environment Variables Required

```
ANTHROPIC_API_KEY          — Claude API key
HCP_API_KEY                — HouseCall Pro API token
TWILIO_ACCOUNT_SID         — Twilio account SID
TWILIO_AUTH_TOKEN           — Twilio auth token
TWILIO_PHONE_NUMBER         — +16043303997
ELEVENLABS_API_KEY          — ElevenLabs API key
ELEVENLABS_AGENT_ID         — agent_5301knm3eyy7en7snw8gf72ht8eh
GMAIL_CLIENT_ID             — Google OAuth client ID
GMAIL_CLIENT_SECRET         — Google OAuth client secret
GMAIL_REFRESH_TOKEN         — Gmail refresh token
GMAIL_USER_EMAIL            — karen@lifestylehomeservice.com
DIALPAD_API_KEY             — Dialpad API key
INTERNAL_SECRET             — Bearer token for internal endpoints
ADMIN_PHONE_NUMBERS         — 6048009630
UPSTASH_REDIS_REST_URL      — Upstash Redis REST URL
UPSTASH_REDIS_REST_TOKEN    — Upstash Redis REST token
```

### File Structure (Post-Refactor)

```
lhs-scheduler-proxy/
  api/
    incoming-sms.js         (200 lines — thin router)
    voice-brain.js          (488 lines — voice AI with caller recognition)
    modules/
      shared/
        sms.js              — Twilio SMS sending
        kb.js               — Knowledge base read/write
        hcp.js              — HouseCall Pro API client
        time.js             — Pacific timezone utilities
      schedule/
        fetch.js            — Job fetching (today, specific date, date parsing)
        patterns.js         — Recurring pattern cache + analysis
        context.js          — Schedule context builder
      prompt/
        builder.js          — System prompt assembly
        sections/
          identity.js       — Company, team, personality
          holidays.js       — BC stat holidays (data + prompt)
          knowledge.js      — Cleaning SOPs, training, safety
          rules.js          — Scheduling rules, date handling
          admin.js          — Admin capabilities, task management
      tools/
        registry.js         — Tool registration + dispatch
        definitions/        — 5 files defining 17 Claude tools
        handlers/           — 5 files implementing 17 tool handlers
    task-store.js           — Persistent task CRUD
    persona-store.js        — Client/cleaner/management personas
    aria-memory.js          — Conversation history + learnings
    scheduling-intelligence.js — 7-day proactive analysis
    aria-email.js           — Gmail send/draft
    aria-call.js            — Outbound Twilio calls
    tmor.js                 — Morning Opportunity Report
    sick-day-log.js         — Sick day tracking + patterns
    employee-offboarding.js — Offboarding workflow
    capacity-check.js       — Workforce capacity monitoring
    gmail-monitor.js        — Inbox monitoring (every 15 min)
    morning-briefing.js     — 6am daily briefing
    afternoon-briefing.js   — 2:30pm briefing
    evening-briefing.js     — Evening summary
    voice-cache.js          — Pre-cache HCP data (every 10 min)
    voice-data.js           — Voice data queries
    stat-holiday-check.js   — Holiday detection + task creation
    daily-learning.js       — Evening learning synthesis
    email-learning.js       — Comprehensive email analysis
    leave-request.js        — JotForm leave request webhook
    setup-voice-agent.js    — ElevenLabs agent configuration
    dialpad-transcripts.js  — Call transcript search
    bulk-job-notes.js       — Multi-job note application
    tasks.js                — Task REST API
    proxy.js                — HCP API proxy
    sms.js                  — SMS utilities
  docs/
    sops/                   — Employee offboarding SOP
  public/
    index.html              — Knowledge base viewer
  vercel.json               — Cron job configuration
  package.json              — type: module

lhs-knowledge-base/
  api/
    save.js                 — Redis key-value store (Upstash)
    clients.js              — Client/cleaner data API
  public/
    index.html              — Knowledge base dashboard
    tasks.html              — Task manager + calendar + sick day tracker
    voice.html              — Voice conversation interface
```

### Vercel Cron Jobs

| Endpoint | Schedule | Purpose |
|----------|----------|---------|
| /api/morning-briefing | 2:00 PM UTC (6am PT) | Daily morning briefing to Karen |
| /api/afternoon-briefing | 10:30 PM UTC (2:30pm PT) | Afternoon agenda + email |
| /api/gmail-monitor | Every 15 minutes | Check inbox, draft replies |
| /api/voice-cache | Every 10 minutes | Pre-cache HCP schedule for voice |
| /api/daily-learning | 2:00 AM UTC (6pm PT) | Evening learning synthesis |

---

## 4. Build History Timeline

### Day 1 — April 6, 2026 (Foundation)

**Messages 1-22:** Project exploration and core SMS intelligence
- Explored existing project structure (proxy.js, incoming-sms.js)
- Connected Aria to live HouseCall Pro schedule data
- Built client preferences API in lhs-knowledge-base
- Merged HCP schedule + client preferences into system prompt
- Fixed Vercel deployment issues (builds config, function limits)
- Added error logging for HCP and KB fetch failures
- Fixed scheduling intelligence — only flag missing clients on their actual pattern day

**Messages 23-27:** Recurring pattern analysis
- Built 30-day forward-looking pattern detection from HCP data
- Determines client frequency (weekly, biweekly, monthly) from actual bookings
- Added background pattern cache with 2-hour TTL to avoid timeout

**Messages 28-40:** Job notes feature
- Built bulk-job-notes.js for adding notes to client jobs in HCP
- Fixed client name matching (was too broad — Valley Toyota matched Hans Claus)
- Cleaner notification: "Hi [name], there's been an update to [client] job notes"
- Karen confirmation: "Done! Added note to 3 Hans Claus jobs. Danielle B notified."

### Day 2 — April 7, 2026 (Features)

**Messages 41-49:** Cleaner availability + leave requests
- Created HCP availability events for cleaner restrictions
- Updated knowledge base with all cleaner unavailability schedules
- Added Brandi M morning-only restriction to system prompt
- Built leave-request.js webhook for JotForm submissions

**Messages 50-53:** Dialpad integration
- Analyzed HubSpot CSV with Dialpad call transcript links
- Built dialpad-transcripts.js to fetch and search call transcripts
- Connected to Dialpad API v2 for transcript retrieval

**Messages 54-58:** Task management system
- Built comprehensive task management (save, complete, search, delegate)
- Critical rule: tasks are reminders FOR KAREN ONLY — never contact the person mentioned
- Fixed date calculation for relative days ("Thursday" = next Thursday)
- Added full category system (13 categories: scheduling, AR, AP, hiring, etc.)
- Added BC stat holidays to system prompt

### Day 3 — April 8, 2026 (Voice + Intelligence)

**Messages 59-61:** Stat holidays + capacity
- Built proactive stat holiday checker (runs every Monday)
- Built workforce capacity monitoring with hiring recommendations
- Capacity thresholds: 70% mention, 80% recommend, 90% urgent

**Messages 63-67:** Task dashboard
- Built mobile-friendly task viewer at tasks.html
- Password protected (lhs2026 for Karen, lhsmike2026 for Michael)
- Overdue tasks in red banner, grouped by category
- Fixed task persistence — migrated to permanent storage

**Messages 68-74:** ElevenLabs voice setup
- Configured ElevenLabs agent (agent_5301knm3eyy7en7snw8gf72ht8eh)
- Set custom female voice (ID: RaFzMbMIfqBcIurH6XF9)
- Added voice widget to tasks.html and standalone voice.html
- Vercel Pro activated to lift 12 function limit

**Messages 75-82:** Intelligence systems
- Built comprehensive learning/memory system (aria-memory.js)
- Conversation summaries, learning entries, pattern observations
- Persona memory for clients, cleaners, and management
- Connected caller history for personalized responses

**Messages 83-86:** Gmail integration
- Set up Gmail OAuth for automated inbox monitoring
- Gmail monitor runs every 15 min, drafts replies in Karen's voice
- Texts Karen notification of each drafted reply

**Messages 87-92:** More features
- Permanent task storage (never expires, completed tasks archived)
- Email sending on Karen's command (routine = auto-send, sensitive = draft)
- Outbound calling via Twilio + ElevenLabs voice AI
- Sick day cascade: identify caller, find jobs, suggest replacements, notify Karen
- Sick day dashboard panel with patterns and payroll export

### Day 4 — April 9, 2026 (Voice Architecture)

**Messages 93-96:** Dashboard improvements
- Added 5-day rolling calendar to tasks.html
- Task delegation buttons (Karen, Aria, Michael)
- Estimated time per task, daily time totals on calendar

**Messages 97-102:** Data analysis
- Analyzed full Todoist export (Karen's pre-Aria task history)
- Analyzed Heymarket SMS export
- Analyzed Dialpad call logs and voice statistics

**Messages 106-115:** Voice brain rebuild
- CRITICAL: Aria was making up employee names during voice calls
- Root cause: ElevenLabs tools timed out, Aria hallucinated
- Solution: voice-brain.js — Claude Haiku with SSE streaming
- Pre-cached schedule via voice-cache.js (runs every 10 min)
- Architecture: ElevenLabs -> voice-brain.js -> Claude Haiku (streaming)
- First token target: 500ms

**Messages 116-117:** Employee data
- Recorded all cleaner birthdays and start dates
- Added birthday awareness to morning briefings

**Messages 118-124:** Client analysis + HCP probing
- Classified all clients: ongoing (4+ jobs/6mo), monthly, one-time
- Probed HCP API for invoices, payments, messaging endpoints
- Searched Six Cedars/Westbow open invoices

### Day 5 — April 10, 2026 (Polish + Introduction)

**Messages 125-131:** Voice architecture v2
- Rebuilt voice-brain.js with Claude as intelligence layer
- Switched to Claude Haiku for sub-second responses
- Added SSE streaming for ElevenLabs
- Built persona store with 3 tiers: client, cleaner, management
- Daily learning review system

**Messages 132-134:** Team changes
- Removed inactive cleaners: Emily F, Lorissa W, Julieta S
- Updated dashboard with assignee sections (Karen, Aria, Michael)
- Two-week calendar view

**Messages 135-136:** Karen introduction
- Crafted warm introduction script for Michael introducing Karen to Aria
- TMOR (Morning Opportunity Report) flow built into introduction
- Added "hesitation removal" — Aria answers immediately or promises callback

### Day 6 — April 10-12, 2026 (Session 2 — Analysis + Refactor)

**Email Analysis (6,500 emails, Jan-Apr 2026):**
- Sent: 1,308 / Received: 5,192 / Ratio: 1:4
- Prokey Living: 82 emails (billing issues, JotForm intakes, payroll)
- Westbow/Six Cedars: 53 emails (invoice reconciliation, payment cycles)
- JotForm: 375 submissions (159 pre-interview, 25 Prokey, 24 client intake)
- 8 workflow automation opportunities identified
- All findings saved to knowledge base personas

**Caller Recognition:**
- Identifies callers by phone number
- Karen: "Good morning Karen! How can I help?"
- Michael: "Good morning Michael! I hope you're feeling well"
- Unknown: "Thank you for calling LHS. Who am I speaking with?"
- Loads persona immediately after identification

**Time Awareness:**
- Precise Pacific Time injection (PDT/PST automatic)
- Time-of-day greetings (morning/afternoon/evening/late night)

**SOP Ingestion:**
- Read 28-page SOP document from Google Drive
- Extracted 13 individual SOPs + 9 JotForm links
- All saved to Redis knowledge base

**Modular Refactor (incoming-sms.js):**
- 1,812 lines -> 200 lines (89% reduction)
- 25 new modules across 4 layers (shared, schedule, prompt, tools)
- 17-deep if/else chain replaced with 4-line registry lookup
- All 10 integration tests passed on production

---

## 5. Tone & Communication Guidelines

### Speaking to Karen (Manager)
- **Tone:** Warm, supportive, efficient. Like a trusted colleague.
- **Style:** Direct and task-oriented. Keep SMS under 300 chars unless detail needed.
- **Greeting:** "Good morning Karen! How can I help you today?"
- **Task save:** "Got it! I've saved 'Follow up with Ladda' for Thursday. I'll remind you!"
- **Task done:** "Nice work! Marked 'Pay Vanessa' as done. One less thing on your plate!"
- **Sign-off:** Always end with "— LHS" followed by house emoji
- **Key rule:** NEVER make Karen wait. Answer immediately or promise callback.
- **Key rule:** Protect Karen's time — only escalate genuine emergencies.
- **Late night:** "Working late tonight Karen! How can I help?"

### Speaking to Michael (Owner)
- **Tone:** Strategic, data-driven, respectful of vision.
- **Greeting:** "Good morning Michael! I hope you're feeling well — how can I help?"
- **Give:** Strategic summaries and key metrics, not operational detail.

### Speaking to Cleaners (Staff)
- **Tone:** Warm, encouraging, supportive. Know them by name.
- **Sick day:** "Hi [name]! Sorry to hear you're not well. I've noted your absence and will take care of notifying your clients. Please rest up!"
- **Key rule:** Never share client details or other cleaner information.

### Speaking to Clients (External)
- **Tone:** Professional, warm, helpful.
- **Greeting:** "Good morning! Thank you for calling Lifestyle Home Service. Who am I speaking with?"
- **New inquiry:** Offer to book an estimate, share intake form link.
- **Rescheduling:** "Your cleaning on [holiday] has been moved to [date]. Same time, same great service!"

### Voice Specific Rules
- Speak naturally — no bullet points, no lists, pure conversational speech.
- Keep answers concise — 3 to 4 sentences normally.
- NEVER invent employee names. Only use names from schedule data.
- Two modes only:
  - MODE 1 (YOU KNOW IT): Answer immediately with confidence.
  - MODE 2 (NEED TO RESEARCH): "Let me work on that and call you back in about 10 minutes."

---

## 6. TMOR & Daily Learning Design

### TMOR — The Morning Opportunity Report

**Trigger:** Karen says "TMOR" or "morning opportunity report"
**Flow:**
1. Aria: "Ready Karen — go ahead and describe what happened."
2. Karen describes morning situations via voice or SMS
3. Karen says "end TMOR"
4. Aria saves full description to knowledge base
5. Claude analyzes for categories: staff, client, scheduling, supply, quality, safety, hiring, admin
6. Michael receives SMS summary
7. System checks for matching SOPs (offboarding, sick day, quality)

**Purpose:** Every morning challenge is an opportunity to improve SOPs and be more proactive tomorrow.

### Daily Learning Cycle

| Time | System | Action |
|------|--------|--------|
| 6:00 AM | morning-briefing.js | Schedule summary, capacity, sick day alerts, call to Karen |
| All Day | incoming-sms.js | save_learning tool captures new facts proactively |
| All Day | gmail-monitor.js | Draft replies every 15 min |
| 2:30 PM | afternoon-briefing.js | Agenda email + SMS with tasks and capacity |
| 6:00 PM | daily-learning.js | Synthesize day's learnings, seek approval, save to personas |
| Evening | evening-briefing.js | Task completion summary, tomorrow prep |

### Learning Categories
- Client preferences (day changes, cleaner preferences, complaints)
- Cleaner facts (availability changes, health issues, performance)
- Scheduling patterns (detected from HCP bookings)
- Pricing changes
- Quality observations

---

## 7. SOP Library

### 13 SOPs Ingested (from 28-page Google Drive document)

| # | SOP | Redis Key |
|---|-----|-----------|
| 1 | Accounts Receivable & Payment Processing | aria_sop_accounts_receivable_payment_processing |
| 2 | Accounts Receivable & Collections | aria_sop_accounts_receivable_collections |
| 3 | Scheduling & Dispatching | aria_sop_scheduling_dispatching |
| 4 | Scheduling & Dispatching v1.0 | aria_sop_scheduling_dispatching_version_1_0 |
| 5 | Staff Offboarding & Client Protection | aria_sop_staff_offboarding_client_protection |
| 6 | Cleaning Quality Standards & Training | aria_sop_cleaning_quality_standards_training |
| 7 | Bi-Weekly Payroll Processing | aria_sop_bi_weekly_payroll_processing |
| 8 | Strategic Recruitment & Selection | aria_sop_strategic_recruitment_selection |
| 9 | Working Interview & Try-out Process | aria_sop_working_interview_try_out_process |
| 10 | Client Onboarding & Sales | aria_sop_client_onboarding_sales |
| 11 | Employee Development & Retention | aria_sop_employee_development_retention |
| 12 | Health, Safety & Environment | aria_sop_health_safety_and_environment_hse |
| 13 | Supplies & Inventory Management | aria_sop_supplies_inventory_management |

### 9 JotForm Links

| Form | URL | Purpose |
|------|-----|---------|
| Client Intake | form.jotform.com/202336220179448 | New client onboarding |
| New Hire Questionnaire | form.jotform.com/251412920037245 | Candidate screening |
| Self-Assessment | form.jotform.com/243115843461251 | Quarterly cleaner check |
| Field Service Report | form.jotform.com/202475128298461 | Daily job completion |
| Performance Review | form.jotform.com/251064402308244 | Staff development |
| PIP | jotform.com/form/251064180050241 | Performance improvement |
| Job Overview & Onboarding | form.jotform.com/211264799600256 | New hire legal sign-off |
| Safety Agreement | form.jotform.com/230506930717454 | Safety & liability |
| Privacy & Security | form.jotform.com/220655808695467 | Data protection |

---

## 8. Key Account Intelligence

### Prokey Living (82 emails Q1 2026)

- **Type:** Post-construction cleaning + property management
- **Contacts:** Ethan Johnston (site, submits JotForms), Michaila McLay (site manager, PO numbers)
- **Billing:** Via Westbow AP — Melissa Gaitan and Amanda Bosma
- **Pay cycle:** Twice monthly (separate from Westbow construction side)
- **Key issues:** Duplicate invoice amounts, missing PO numbers cause delays, wrong billing address (should be 401-45389 Luckakuck Way), auto-invoicing was turned off
- **JotForm volume:** 25 ProKey Cleaning Intake Forms per quarter
- **Job types:** Post-construction, show home maintenance, property turnover
- **Show home:** Annual access code update needed (updated to 2026)

### Westbow Construction / Six Cedars (53 emails Q1 2026)

- **Type:** Post-construction cleaning for new builds
- **Contacts:** Amanda Bosma (AP Manager), Melissa Gaitan (AP)
- **Billing:** payables@westbow.ca, construction cutoff April 30 for May pay
- **Key issues:** Invoice amount discrepancies, credit application questions, invoices sent to wrong email
- **Also includes:** Airbnb properties at Cultus Lake

---

## 9. Modular Architecture (Post-Refactor)

### Before vs After

```
BEFORE: 1 file, 1,812 lines, 17 if/else-if branches
AFTER:  26 files, 200 + 2,124 = 2,324 total lines
```

### Module Layer Map

```
incoming-sms.js (200 lines) — thin router
  |
  +-- modules/shared/ (167 lines)
  |     sms.js      — Twilio SMS (replaces 16 duplicates)
  |     kb.js       — Redis KB read/write (replaces 12 duplicates)
  |     hcp.js      — HCP API client (replaces 17 duplicates)
  |     time.js     — Pacific timezone + fetchWithTimeout
  |
  +-- modules/schedule/ (369 lines)
  |     fetch.js    — fetchTodaysJobs, parseDateFromMessage, fetchJobsForDate
  |     patterns.js — 30-day pattern cache + analyzeRecurringPatterns
  |     context.js  — Client prefs + schedule context builder
  |
  +-- modules/prompt/ (432 lines)
  |     builder.js  — Assembles prompt from sections
  |     sections/   — identity, holidays, knowledge, rules, admin
  |
  +-- modules/tools/ (1,156 lines)
        registry.js     — Map-based tool registration + dispatch
        definitions/    — 5 files, 17 tool schemas
        handlers/       — 5 files, 17 handler implementations
```

### Tool Dispatch (replaces 17-deep if/else)

```javascript
const toolHandler = getToolHandler(toolUse.name);
if (toolHandler) {
  twimlReply = await toolHandler(toolUse.input, ctx);
}
```

---

## 10. Commercial Vision & GTM Strategy

### The Playbook Platform

The modular refactor was described as "the most important architectural task for the commercial Playbook platform." The vision:

- **Each module is extractable** — clean single responsibility, under 200 lines
- **Prompt sections are customization points** — each Playbook customer provides their own identity, knowledge, and rules while reusing the builder, registry, and shared utilities
- **Tool definitions are configuration** — different businesses define different tools
- **Tool handlers are the business logic** — extracted and testable independently

### What NOT to Do

- **Loom** — Decided NOT to use for SOPs. Cowork sees the screen visually instead, providing a superior interactive experience over pre-recorded video.
- **Never guess** — Aria must never invent employee names, guess stat holiday dates, or fabricate schedule data. Wrong answers are far worse than saying "let me check."
- **Never auto-execute** — Rescheduling plans, schedule changes, and offboarding all require Karen's explicit approval before execution.
- **Never contact on tasks** — When Karen says "follow up with Ladda" that's a reminder for Karen, NOT an instruction to text Ladda.
- **Slybroadcast** — Explored but not implemented. Outbound calling done via Twilio + ElevenLabs instead.

### The Instagram Guys' Insights

Key insight from studying successful Instagram cleaning business accounts: the value is in the SYSTEM, not the service. Customers pay for reliability, consistency, and professionalism. Aria embodies this — she IS the system that ensures nothing falls through the cracks.

### Three-Tool Framework

Michael's workflow for building with Claude:

1. **Cowork** — Visual collaboration. Claude sees the screen, understands context, provides real-time guidance. Replaces Loom for SOP creation because it's interactive, not passive video.

2. **Claude Projects** — Persistent context. Upload documents, business rules, and guidelines that persist across conversations. The strategic planning layer.

3. **Claude Code** — Execution. Builds, deploys, tests, and iterates on code. The implementation layer where Aria comes to life.

### Michael's Preferences for Working with Claude

- **NEVER tell me something is done until you have tested it end to end** (MSG 114)
- Phase-based development with commits between phases
- Test every change before reporting success
- Descriptive commit messages explaining what and why
- Deploy to preview before production when possible
- Always show real test results, not theoretical confirmations

---

## 11. Redis Knowledge Base Keys

| Key | Content |
|-----|---------|
| aria_email_learnings | Full 8-category email analysis (6,500 emails) |
| aria_management_personas | Karen + Michael communication styles |
| aria_client_personas | Prokey Living + Westbow/Six Cedars profiles |
| aria_employee_personas | Staff patterns from email data |
| aria_tmor_log | Recurring morning situation patterns |
| aria_sop_index | Master index of all 13 SOPs |
| aria_sop_master_document | Complete 54,562-char SOP document |
| aria_sop_* (x13) | Individual SOP content |
| aria_form_links | 9 JotForm links with descriptions |
| aria_voice_cache | Pre-cached HCP schedule for voice |
| aria_memory_conversations | Conversation summaries |
| aria_memory_learnings | Facts learned about clients/cleaners |
| aria_memory_patterns | Pattern observations |
| aria_karen_calendar | Karen's personal calendar events |
| aria_complete_history | This document |

---

## 12. Environment & Configuration

### Vercel Projects

| Project | URL | Repo |
|---------|-----|------|
| lhs-scheduler-proxy | lhs-scheduler-proxy.vercel.app | Mckaren67/lhs-scheduler-proxy |
| lhs-knowledge-base | lhs-knowledge-base.vercel.app | Mckaren67/lhs-knowledge-base |

### External Service Integrations

| Service | Purpose | Auth Method |
|---------|---------|-------------|
| HouseCall Pro | Scheduling, jobs, customers, invoices | API Token |
| ElevenLabs | Voice synthesis + Conversational AI | API Key + Agent ID |
| Twilio | SMS send/receive + outbound calls | Account SID + Auth Token |
| Gmail | Inbox monitoring + email sending | OAuth2 refresh token |
| Dialpad | Call transcripts + AI recaps | API Key |
| Upstash Redis | Persistent knowledge base storage | REST URL + Token |
| Claude (Anthropic) | AI intelligence for SMS + voice | API Key |
| JotForm | Form submissions (intake, leave, review) | Webhook |
| QuickBooks | Financial reports (email only) | — |

### Key Technical Decisions

1. **Claude Haiku for voice** (not Sonnet) — Sub-second response time. Schedule data pre-loaded gives all context needed.
2. **SSE streaming** — First token to ears in 500ms via Server-Sent Events.
3. **Custom LLM endpoint** (not ElevenLabs built-in) — Full control over context, persona loading, and tool orchestration.
4. **30-day pattern cache** (not per-request fetch) — Avoids 8s timeout on every SMS.
5. **Permanent task storage** — Tasks never expire. Completed tasks archived forever.
6. **Upstash Redis** (not Vercel /tmp) — Persistent storage that survives deployments.
7. **type: module in package.json** — Native ESM support, eliminates CommonJS conversion warnings.
8. **Pre-cached voice data** — voice-cache.js runs every 10 min so voice calls never wait for HCP.

---

*Built with Claude Code (Opus 4.6, 1M context) across 154 prompts in 6 days.*
*This document is the canonical reference for continuing Aria development.*
