# LHS Aria — Full Session Summary April 15 2026

## What Was Accomplished — April 14-15 2026

### Code Built
- HCP write operations — all 6 confirmed live:
  reassignJob, rescheduleJob, addJobNote,
  createCustomer, getJobsForCleaner,
  findAvailableCleaners
  API format discoveries documented permanently

- Evening summary rewritten — 4 contributors:
  Karen and Michael: approx X min
  Aria and Claude: saved X hours
  Dollar value from AI time only at $25/hr

- Payroll SMS system — all keywords working:
  PAYROLL, Payroll confirmed, Payroll submitted,
  Payroll processed — all tested and live
  Tuesday 9am reminder cron confirmed
  PAYROLL APRIL 7-13 COMPLETED April 15 2026

- Fuzzy name matching — 7 tests passing:
  Partial names, first name only,
  client vs cleaner lists separated correctly

- Task cleanup — Michael down from 21 to 12
- Jenna Braich tasks consolidated
- Dialpad auto-reply turned off by Michael
- Attendance incentive program designed

### Research Reviewed
Four major industry documents analyzed:
1. Residential Cleaning Internal Operations
   and Chain of Command SOPs
2. High Performance Field Operations SOPs
3. Best Practice Field Ops and HCP Deep Analysis
4. Residential Cleaning Field Ops and HCP API
   and Webhooks Deep Dive

## Key Findings From Research

### What LHS Already Does Right
HCP checklists — in use
GPS time tracking — in use
Automated SMS notifications — in use
Customer portal — in use
Map view scheduling — in use

### Root Cause Finding
LHS runs on Karen's memory and judgment.
She is the single point of contact for all 17
cleaners and 177 clients.
This is the bottleneck — not the technology.

### Critical HCP Webhook Discovery
HCP webhooks on MAX plan cover every event:
job.completed, job.canceled, job.on_my_way,
invoice.payment.failed, invoice.paid, lead.created
Enables Aria to be genuinely proactive —
HCP pushes events to Aria in real time
instead of Aria polling HCP repeatedly.

## 18 Action Items — Complete Status

### A through E — Already Done
A — HCP Checklists — already in use
B — GPS Time Tracking — already in use
C — Automated SMS Notifications — already in use
D — Customer Portal — already in use
E — Map View Scheduling — already in use

### F through H — Starting Early Next Week
F — Designate 2 Residential Daytime Team Leads
    Carefully select candidates with Karen
    Team Lead decides coverage — Aria executes
    Team Leads do NOT contact clients directly
    Team Leads do NOT make HCP changes directly
    Team Leads do NOT handle scheduling while driving
    Pay premium: TBD per hour above standard rate

G — Schedule Freeze — Employee Facing
    Incentivize day-before notification
    Two-tier system:
    Tier 1: Day before by 5pm — no bonus impact
    Tier 2: Morning of — quarterly bonus paused
    Morning emergencies still handled via Team Lead

H — Lockout Fee Policy
    Charge full clean cost for lockouts
    Communicate clearly in client policy
    Aria handles all client communication for lockouts

### I through L — Build With Webhooks — Next Session
I — HCP Webhook Receiver
    /api/hcp-webhook endpoint in lhs-scheduler-proxy
    Verify Api-Signature header for security
    Route events to correct handlers

J — Job Completed Automation
    Client completion text automatic
    Review request automatic
    Actual time logged for payroll

K — Job Canceled Automation
    Karen texted immediately
    Late cancellation fee flagged if applicable

L — Invoice Payment Failed Automation
    Urgent AR task for Michael
    Michael texted immediately

### M through O — Aria SMS and HCP Write
M — Sick Day Coverage In HCP
    Team Lead decides who covers
    Aria reassigns jobs in HCP
    Aria texts affected clients
    Karen gets one summary text

N — Client Notes In HCP
    Thursday or Friday or Saturday session with Karen
    Entry instructions, pets, preferences
    Start with top 30 most frequent clients

O — Replacement Cleaner Job Brief
    Aria texts replacement automatically
    Full job brief from client notes
    Eliminates mid-job calls to Karen

### P — KPI Tracking
P — Three Core KPIs from webhook data
    Cancellation rate via job.canceled webhooks
    Replacement rate via sick day protocol events
    Complaint rate via client communications
    Weekly Monday morning report to Michael

### Q and R — Evaluate
Q — HCP CSR AI at $140 CAD per month
    Handles new inbound calls and booking natively
    Complementary to Aria — not competing
    Trial for one month recommended

R — HCP Plan Verification
    Confirm LHS is on MAX plan
    Webhooks and full API require MAX plan

## Team Lead Framework

### Role Design
2 residential daytime Team Leads
Continue doing own cleaning jobs
First point of contact for morning problems
Decision maker — Aria is the executor

### Morning Emergency Protocol

SICK DAY FLOW:
Cleaner texts Aria sick →
Aria texts Team Lead with job list →
Team Lead replies with coverage decision →
Aria texts replacement cleaner for confirmation →
Aria reassigns jobs in HCP →
Aria texts affected clients →
Karen receives one summary text
Karen never touches HCP

LOCKOUT FLOW:
Cleaner texts Aria locked out →
Aria checks client notes for entry info →
If entry info found: Aria texts cleaner solution →
If not found: Aria texts Team Lead for decision →
Team Lead approves Aria contacting client →
Aria texts client →
Karen notified but not interrupted

### Team Lead Job Description Key Points
Review schedule by 7:30am daily
Receive sick day and emergency notifications first
Text Aria with coverage decisions
Do NOT call clients directly
Do NOT make HCP changes directly
Do NOT handle scheduling while driving
Pay premium: TBD per hour above standard rate

### Client Communication Rules
Running late → Aria handles automatically
Replacement found → Aria handles automatically
Lockout with entry info → Aria handles automatically
Lockout no entry info → Aria after Team Lead approval
Damage during job → Karen contacts client
Quality complaint → Karen contacts client

## The LHS Reliability Program

### Quarterly Perfect Attendance Bonus
$75 CAD at end of each quarter
Zero unplanned same-morning callouts to qualify
Day-before notifications do NOT count against
Genuine emergencies reviewed case by case by Karen
Aria tracks automatically and reports quarterly

### Monthly Recognition
Aria sends monthly recognition text to full team
Names all cleaners with perfect attendance
Automatic — free — motivating

### Priority Scheduling
Top reliability cleaners get first pick of
preferred clients and preferred days
Reviewed every 6 months
Clearly communicated to all cleaners

### Two-Tier Notification System
Tier 1 — Day before by 5pm:
Planned absence — no quarterly bonus impact
Gives LHS 12-14 hours to arrange coverage
Tier 2 — Morning of:
Unplanned absence — quarterly bonus paused
BC legal note: always frame as rewarding
reliability — never penalizing sick days

### Career Pathway
Team Lead roles filled from highest reliability
$1-2 per hour premium clearly communicated
Team Lead = career step within LHS

### What Aria Does Automatically
Tracks attendance from HCP time data
Logs each absence as Tier 1 or Tier 2
Sends monthly recognition texts to team
Generates quarterly attendance report
Calculates bonus eligibility automatically
Notifies Karen at third unplanned absence in quarter

## Karen Interview Findings — April 15 2026

### The Real Daily Problem
Karen spends entire mornings in reactive fire-fighting
Primary issues occurring every morning:
Cleaner sick days — 1-2 times per week
Lockouts — 1-2 times per week
Replacement cleaners calling for job instructions
Equipment failures — vacuum broken or forgotten
Client cancellations and last-minute reschedules
Photo documentation chaos — Dialpad photos failing

### Cleaner Availability Constraints
Brandi M: not Fridays
Rebecca D: not Tuesdays
Kristen K: Saturdays only
Cathy W: weekdays only
Others: various constraints
All constraints live in Karen's head — not in a system

### Karen's Perfect Day
Schedule set ahead of time
No sick calls — no lockouts — no equipment failures
No cleaners calling throughout jobs for instructions
No last-minute cancellations
Everything flows as scheduled

### Five Priority Features From Interview
1. Sick day coverage — saves 60-90 min per incident
2. Replacement cleaner job brief — saves 20-30 min
3. Schedule freeze enforcement
4. KPI tracking — measures Aria's actual impact
5. Quality checklist logging via SMS

## Payroll Status
Period: April 7-13 2026
Status: COMPLETED April 15 2026
Next period: April 14-20 2026
Next reminder: Tuesday April 21 2026 at 9am Pacific
Payroll calculator: aistudio.google.com/app/apps/82328746

## Karen Meeting Agenda
Date: Thursday April 16 OR Friday April 17
      OR Saturday April 18 — TBD on Karen availability

Agenda items:
1. Karen interview findings in detail
2. Policy framework review:
   — Team Lead design and job description
   — LHS Reliability Program design
   — Schedule freeze — employee facing
   — Lockout fee policy
   — Replacement cleaner protocol
3. KPI framework — three core metrics
4. Review 18 recommendation items A through R
5. Confirm HCP plan level — Basic Essentials or MAX
6. Decide on HCP CSR AI trial yes or no
7. Team Lead candidate selection with Karen

## Outstanding Items

### Waiting On External
ElevenLabs technical team — voice Twilio fix
Bill Gee — tax details update Friday April 17
Karen meeting — Thursday Friday or Saturday

### Pending Decisions
Team Lead candidates — Karen and Michael to decide
Team Lead pay premium amount
HCP plan level confirmation
HCP CSR AI trial decision
1Password Business — now or closer to sale

### Next Build Session Priorities
1. HCP webhook receiver — highest priority
2. Sick day protocol wired into HCP write operations
3. Job completed automation
4. Job canceled automation
5. Client notes session prep for Karen meeting

## Session Statistics
Michael working since before 3am April 14
Two full days of building and strategic planning
Code features built: 20 plus
Tests passing: all confirmed
Industry documents reviewed: 4
Recommendations generated: 18
Strategic insights captured: full framework
