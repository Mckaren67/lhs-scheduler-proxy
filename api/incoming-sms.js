export const config = { api: { bodyParser: true }, maxDuration: 60 };
import { executeBulkNotes } from './bulk-job-notes.js';
import { saveTask, completeTask, searchTasks, getOpenTasks, getOverdueTasks } from './task-store.js';
import { getCapacityData } from './capacity-check.js';
import { saveConversation, saveLearning, buildCallerContext } from './aria-memory.js';
import { analyzeSchedule } from './scheduling-intelligence.js';
import { sendEmail, saveDraft, lookupClientEmail, isSensitiveTopic } from './aria-email.js';
import { makeCall, lookupClientPhone } from './aria-call.js';

async function sendSMSNotification(to, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const toPhone = to.startsWith('+') ? to : to.length === 10 ? `+1${to}` : `+${to}`;
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ To: toPhone, From: from, Body: message }).toString()
    }
  );
  return response.json();
}

// Multi-turn conversation memory
// Stores last 10 messages per phone number, expires after 2 hours of inactivity
const conversationStore = new Map();
const CONVERSATION_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours
const MAX_HISTORY = 10; // max messages to keep per conversation

function getConversation(phone) {
  const now = Date.now();
  const conv = conversationStore.get(phone);
  if (!conv || (now - conv.lastActivity) > CONVERSATION_TIMEOUT) {
    // Start fresh if new or expired
    const newConv = { messages: [], lastActivity: now };
    conversationStore.set(phone, newConv);
    return newConv;
  }
  conv.lastActivity = now;
  return conv;
}

function addToConversation(phone, role, content) {
  const conv = getConversation(phone);
  conv.messages.push({ role, content });
  // Keep only last MAX_HISTORY messages
  if (conv.messages.length > MAX_HISTORY) {
    conv.messages = conv.messages.slice(-MAX_HISTORY);
  }
  conv.lastActivity = Date.now();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// --- Cached pattern analysis (refreshes every 2 hours, runs in background) ---
const PATTERN_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours
let cachedPatterns = { data: '', fetchedAt: 0 };
let patternFetchInProgress = false;

async function refreshPatternCache() {
  if (patternFetchInProgress) return;
  patternFetchInProgress = true;
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const thirtyDaysOut = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30, 23, 59, 59).toISOString();

    const apiKey = process.env.HCP_API_KEY;
    const fetchUrl = `https://api.housecallpro.com/jobs?scheduled_start_min=${startOfDay}&scheduled_start_max=${thirtyDaysOut}&page_size=200`;
    console.log('[PATTERNS] Refreshing 30-day cache...');
    const response = await fetchWithTimeout(fetchUrl, {
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    }, 15000); // 15s timeout for this larger fetch

    if (response.ok) {
      const data = await response.json();
      const patterns = analyzeRecurringPatterns(data.jobs || []);
      cachedPatterns = { data: patterns, fetchedAt: Date.now() };
      console.log(`[PATTERNS] Cache refreshed — ${(data.jobs || []).length} jobs analyzed`);
    } else {
      console.error('[PATTERNS] Refresh failed:', response.status);
    }
  } catch (err) {
    console.error('[PATTERNS] Refresh exception:', err.message);
  } finally {
    patternFetchInProgress = false;
  }
}

function getCachedPatterns() {
  const age = Date.now() - cachedPatterns.fetchedAt;
  if (age > PATTERN_CACHE_TTL) {
    // Trigger background refresh — don't block the current request
    refreshPatternCache();
  }
  return cachedPatterns.data;
}
// --- End pattern cache ---

async function fetchTodaysJobs() {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

    const apiKey = process.env.HCP_API_KEY;
    const fetchUrl = `https://api.housecallpro.com/jobs?scheduled_start_min=${startOfDay}&scheduled_start_max=${endOfDay}&page_size=200`;
    console.log('[HCP] Fetching today:', fetchUrl);
    const response = await fetchWithTimeout(fetchUrl, {
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    console.log('[HCP] Response status:', response.status);
    if (!response.ok) {
      const errText = await response.text();
      console.error('[HCP] Error response:', response.status, errText);
      return { schedule: `Schedule fetch failed (HTTP ${response.status}).`, jobs: [] };
    }
    const data = await response.json();
    console.log('[HCP] Jobs returned:', data.jobs?.length ?? 0);

    if (!data.jobs || data.jobs.length === 0) return { schedule: 'No jobs scheduled for today.', jobs: [] };

    const lines = data.jobs.map(job => {
      const name = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim() || 'Unknown';
      const addr = job.address?.street || 'No address';
      const city = job.address?.city || '';
      const status = job.work_status || 'unknown';
      const desc = job.description || 'No description';
      const employees = (job.assigned_employees || []).map(e => `${e.first_name} ${e.last_name}`).join(', ') || 'Unassigned';

      const start = job.schedule?.scheduled_start;
      const end = job.schedule?.scheduled_end;
      const startTime = start ? new Date(start).toLocaleTimeString('en-CA', { timeZone: 'America/Vancouver', hour: 'numeric', minute: '2-digit' }) : '?';
      const endTime = end ? new Date(end).toLocaleTimeString('en-CA', { timeZone: 'America/Vancouver', hour: 'numeric', minute: '2-digit' }) : '?';

      const amount = job.total_amount ? `$${(job.total_amount / 100).toFixed(2)}` : '';

      return `• ${startTime}–${endTime} | ${name} | ${addr}, ${city} | ${desc} | Assigned: ${employees} | Status: ${status} | ${amount}`;
    });

    return {
      schedule: `${data.total_items} job(s) today:\n${lines.join('\n')}`,
      jobs: data.jobs
    };
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'Request timed out after 8s' : err.message;
    console.error('[HCP] Fetch exception:', reason, err.stack);
    return { schedule: `Schedule data temporarily unavailable (${reason}).`, jobs: [] };
  }
}

function analyzeRecurringPatterns(jobs) {
  if (!jobs || jobs.length === 0) return '';

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Group jobs by customer name
  const customerJobs = {};
  for (const job of jobs) {
    const name = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim();
    if (!name || job.work_status === 'pro canceled' || job.deleted_at) continue;

    if (!customerJobs[name]) customerJobs[name] = [];

    const start = job.schedule?.scheduled_start;
    if (start) {
      const d = new Date(start);
      customerJobs[name].push({
        date: d,
        day: dayNames[d.getUTCDay()],
        cleaner: (job.assigned_employees || []).map(e => `${e.first_name} ${e.last_name}`).join(', '),
        status: job.work_status
      });
    }
  }

  // Analyze each customer's pattern
  const lines = [];
  for (const [name, visits] of Object.entries(customerJobs)) {
    if (visits.length < 2) continue; // Need 2+ visits to detect a pattern

    // Sort by date
    visits.sort((a, b) => a.date - b.date);

    // Count which days they're booked on
    const dayCounts = {};
    for (const v of visits) {
      dayCounts[v.day] = (dayCounts[v.day] || 0) + 1;
    }
    const primaryDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0][0];

    // Calculate average gap between visits in days
    let totalGap = 0;
    for (let i = 1; i < visits.length; i++) {
      totalGap += (visits[i].date - visits[i - 1].date) / (1000 * 60 * 60 * 24);
    }
    const avgGap = totalGap / (visits.length - 1);

    // Determine frequency from actual gaps
    let frequency;
    if (avgGap <= 8) frequency = 'Weekly';
    else if (avgGap <= 16) frequency = 'Biweekly';
    else if (avgGap <= 35) frequency = 'Monthly';
    else frequency = `Every ~${Math.round(avgGap)} days`;

    // Who cleans most often
    const cleanerCounts = {};
    for (const v of visits) {
      if (v.cleaner) cleanerCounts[v.cleaner] = (cleanerCounts[v.cleaner] || 0) + 1;
    }
    const usualCleaner = Object.entries(cleanerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Varies';

    lines.push(`  ${name}: ${frequency} ${primaryDay}s | Usually cleaned by: ${usualCleaner} | ${visits.length} visits in 30 days`);
  }

  if (lines.length === 0) return '';

  console.log(`[HCP] Patterns detected for ${lines.length} clients`);
  return lines.join('\n');
}

async function fetchClientPreferences() {
  try {
    const clientsUrl = 'https://lhs-knowledge-base.vercel.app/api/clients';
    console.log('[CLIENTS] Fetching:', clientsUrl);
    const response = await fetchWithTimeout(clientsUrl);
    console.log('[CLIENTS] Response status:', response.status);
    if (!response.ok) {
      const errText = await response.text();
      console.error('[CLIENTS] Error response:', response.status, errText);
      return { clients: [], cleaners: [] };
    }
    const data = await response.json();
    console.log('[CLIENTS] Loaded:', data.clients?.length ?? 0, 'clients,', data.cleaners?.length ?? 0, 'cleaners');
    return { clients: data.clients || [], cleaners: data.cleaners || [] };
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'Request timed out after 8s' : err.message;
    console.error('[CLIENTS] Fetch exception:', reason, err.stack);
    return { clients: [], cleaners: [] };
  }
}

function buildScheduleContext(hcpResult, clientData) {
  const { schedule, jobs, patterns } = hcpResult;
  const { clients, cleaners } = clientData;

  // Build a lookup of client preferences by name (lowercase for matching)
  const clientLookup = {};
  for (const c of clients) {
    clientLookup[c.name.toLowerCase()] = c;
  }

  // Merge: for each job today, find matching client preferences
  let mergedNotes = '';
  if (jobs.length > 0) {
    const matched = [];
    for (const job of jobs) {
      const custName = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim();
      if (!custName) continue;

      // Try exact match, then partial match
      let prefs = clientLookup[custName.toLowerCase()];
      if (!prefs) {
        const lastN = (job.customer?.last_name || '').toLowerCase();
        prefs = clients.find(c => c.name.toLowerCase().includes(lastN) && lastN.length > 2);
      }

      if (prefs) {
        const notes = [];
        if (prefs.priority) notes.push(`Priority: ${prefs.priority}`);
        if (prefs.preferred_cleaner) notes.push(`Preferred cleaner: ${prefs.preferred_cleaner}`);
        if (prefs.preferred_day) notes.push(`Preferred day: ${prefs.preferred_day}`);
        if (prefs.frequency) notes.push(`Frequency: ${prefs.frequency}`);
        if (prefs.client_type) notes.push(`Type: ${prefs.client_type}`);
        if (notes.length > 0) {
          matched.push(`  ${prefs.name}: ${notes.join(' | ')}`);
        }
      }
    }
    if (matched.length > 0) {
      mergedNotes = `\n\nCLIENT PREFERENCES FOR TODAY'S JOBS:\n${matched.join('\n')}`;
    }
  }

  // Build cleaner availability summary
  const dayName = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver', weekday: 'long' });
  const availableToday = cleaners
    .filter(c => c.days.includes(dayName))
    .map(c => `${c.name} (${c.jobs} career jobs)`)
    .join(', ');
  const unavailableToday = cleaners
    .filter(c => !c.days.includes(dayName))
    .map(c => c.name)
    .join(', ');

  const cleanerSummary = `\n\nCLEANER AVAILABILITY TODAY (${dayName}):\nAvailable: ${availableToday || 'None'}\nNot scheduled: ${unavailableToday || 'None'}`;

  // High-priority clients summary (always useful context)
  const highPriority = clients
    .filter(c => c.priority === 'High')
    .map(c => `  ${c.name}: Preferred cleaner ${c.preferred_cleaner || 'not set'} | ${c.frequency} on ${c.preferred_day || 'flexible'}`)
    .join('\n');
  const highPrioritySummary = highPriority
    ? `\n\nHIGH-PRIORITY CLIENTS (never miss, always assign preferred cleaner):\n${highPriority}`
    : '';

  const patternsSummary = patterns
    ? `\n\nRECURRING CLIENT PATTERNS (detected from actual HCP bookings over next 30 days):\n${patterns}`
    : '';

  return `${schedule}${mergedNotes}${cleanerSummary}${highPrioritySummary}${patternsSummary}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const body = req.body || {};
  const from = body.From || '';
  const incomingMessage = body.Body || '';

  // Admin detection — only admin phones can trigger write operations
  const ADMIN_PHONES = (process.env.ADMIN_PHONE_NUMBERS || '6048009630')
    .split(',').map(p => p.trim().replace(/\D/g, ''));
  const senderDigits = from.replace(/\D/g, '');
  const isAdmin = ADMIN_PHONES.some(p => senderDigits.includes(p) || p.includes(senderDigits));

  console.log(`[ARIA] Incoming SMS from ${from} (admin: ${isAdmin}): "${incomingMessage}"`);

  // Fetch today's jobs and client preferences in parallel (patterns come from cache)
  const [hcpResult, clientData] = await Promise.all([
    fetchTodaysJobs(),
    fetchClientPreferences()
  ]);
  // Get cached patterns (triggers background refresh if stale — never blocks)
  const patterns = getCachedPatterns();
  const scheduleContext = buildScheduleContext({ ...hcpResult, patterns }, clientData);

  // Load caller memory context (non-blocking — if it fails, we proceed without it)
  let callerContext = '';
  try {
    callerContext = await buildCallerContext(from);
  } catch (err) {
    console.error('[ARIA] Memory context failed:', err.message);
  }

  console.log(`[ARIA] Context built — HCP today: ${hcpResult.jobs.length}, KB clients: ${clientData.clients.length}, patterns cached: ${patterns ? 'yes' : 'no'}, memory: ${callerContext ? 'yes' : 'no'}`);

  const ARIA_SYSTEM_PROMPT = `You are Aria, the intelligent AI assistant for Lifestyle Home Service (LHS), a professional residential and commercial cleaning company based in Chilliwack, BC, Canada.

You communicate via SMS so keep responses warm, concise and professional. Never exceed 300 characters unless the answer truly requires more detail. Always sign off with — LHS 🏠

YOUR PERSONALITY:
- Warm, professional, encouraging and caring
- You know every employee by name when possible  
- You are the first point of contact for all staff and client communications
- You protect Karen's time — only escalate genuine emergencies or personal requests
- You represent the very best of Lifestyle Home Service

COMPANY INFO:
- Lifestyle Home Service, Chilliwack BC
- Owner: Michael Butterfield | Manager: Karen McLaren
- Main line: 604-260-1925 | Your number: 778-200-6517
- Training platform: LHS Academy at lhstraininghr.abacusai.app
- HCP scheduling system: HouseCall Pro

ACTIVE TEAM:
April W, Rebecca D, Genevieve O, Nicole D, Amber J, Kelly K, Julieta S, Alissa D, Emily F, Lacy Donald, Kristen K, Paula A, Lorissa W, Brandi M, Cathy W, Holly D, Margret W, Vanessa A, Danielle B, Terrie Lee Birston

CLEANER AVAILABILITY RESTRICTIONS:
- Brandi M: Available MORNINGS ONLY (until 2:30 PM) on Monday through Thursday. Unavailable all day Friday. NEVER schedule Brandi for afternoon jobs after 2:30 PM Mon–Thu.
- Holly D: Unavailable Wednesday and Thursday
- Danielle B: Unavailable Thursday
- Paula A: Unavailable Friday
- Vanessa A: Unavailable Thursday and Friday
- Kristen K: Only available Saturday — unavailable all other days

BC STATUTORY HOLIDAYS 2026 (use these exact dates — never guess):
- New Year's Day — January 1 (passed)
- Family Day — February 16 (passed)
- Good Friday — April 3 (passed)
- Easter Monday — April 6 (TODAY)
- Victoria Day — May 18 (Monday)
- National Indigenous Peoples Day — June 21 (Sunday)
- Canada Day — July 1 (Wednesday)
- BC Day — August 3 (Monday)
- Labour Day — September 7 (Monday)
- National Day for Truth and Reconciliation — September 30 (Wednesday)
- Thanksgiving — October 12 (Monday)
- Remembrance Day — November 11 (Wednesday)
- Christmas Day — December 25 (Friday)
- Boxing Day — December 26 (Saturday)

STAT HOLIDAY RULES:
- When Karen asks about an upcoming stat holiday, always give the exact date from the list above
- If jobs are scheduled on a stat holiday, proactively flag them: "Heads up — [date] is [holiday]. There are [N] jobs scheduled that day. Want me to list them so you can decide what to reschedule?"
- Stat holidays may mean overtime pay for cleaners who work — mention this when relevant
- Commercial clients may have different holiday schedules — check with Karen before assuming they're closed
- Never guess stat holiday dates — only use the dates listed above

TIME OFF POLICY:
- New employees: 10 vacation days, 5 paid sick days, 3 unpaid sick days
- Submit requests through LHS Academy or by texting Aria
- Karen approves all requests — provide as much notice as possible
- Balances tracked in LHS Academy

ONBOARDING (15 tasks for new employees):
1. Welcome & orientation 2. Drive time & payroll guide 3. Criminal record check (RCMP) 4. 3 work references 5. Emergency Contact & Direct Deposit Form 6. TD1 Tax Form 7. Health & Sanitation Guidelines 8. Privacy Policy 9. Safety Regulations Agreement 10. LHS Integrity Statement 11. Headshot for HCP 12. LHS Welcome Packet 13. Paystubs access (QuickBooks) 14. Job Overview signature 15. HouseCall Pro walkthrough video

TRAINING PROGRAM (LHS Academy — Cleaning Tech Boot Camp):
9 modules, 42 videos, 125 quiz questions. 70% passing score required.
Module 1: Core Concepts & Safety — professional conduct, communication, efficiency, safety first, SDS sheets, room workflow
Module 2: Scope of Service — deep clean, recurring, move-in/out differences
Module 3: Bathroom — toilet, vanity, shower techniques
Module 4: Kitchen — prep, stainless steel, appliances, cabinets
Module 5: Dusting & Bedrooms — techniques, furniture care, making beds
Module 6: Floor Care — vacuuming, mopping, floor types
Module 7: Add-On Services — oven, fridge, windows, baseboards, blinds
Module 8: Commercial & Quality Checks — standards, final walkthrough
Module 9: Image & Details — photo documentation, little things that count

KEY CLEANING KNOWLEDGE:

CORE PRINCIPLES:
- Always work TOP TO BOTTOM, LEFT TO RIGHT
- Review work order BEFORE EVERY cleaning — never assume you have it memorized
- Scope of work defines exactly what is expected — follow it precisely
- If scope is unclear — contact management immediately
- At halfway point of time, cleaning should be halfway done
- Notify management if job will exceed estimated hours
- Caddy: clean and reset at end of every job
- Self-quality check every room before leaving
- Always lock up when leaving — unless written instructions say otherwise
- Never let anyone into the home you don't know

PROFESSIONAL CONDUCT:
- Always speak professionally — clients can hear everything
- No foul language or complaints about dirty homes
- Greet and farewell clients who are home
- Integrity values: honesty, kindness, loyalty, responsibility, self-discipline, confidentiality
- Replace items with labels facing forward — professional touch
- Decorative fold on toilet paper — clients notice and appreciate this

SAFETY (WORKSAFE BC):
- NEVER mix chemicals without explicit direction — can cause noxious invisible gas
- Always read SDS sheets for every chemical used
- Wear rubber-soled, closed-toe, closed-heel shoes only
- Do NOT move large furniture — injury risk to cleaner and client's property
- Lift correctly: bend knees, keep item close, extend knees. NEVER lift with back
- Make extra trips rather than overloading yourself
- Use only ONE earbud if listening to music
- Lock doors while cleaning alone
- Report all major injuries AND near misses immediately
- Biohazard situations (excessive blood, mold, infestation): stop and report immediately
- First aid kit must be stocked and accessible at all times
- Kitchen sink = designated eyewash station
- SDS accessible within 4 minutes of any safety incident

BATHROOM CLEANING:
- Toilet: top of tank → sides → bolt covers → lid (top/under) → seat (top/under) → bowl (apply cleaner under lip, scrub top to bottom) → outside of bowl and base → floor/baseboard around toilet → toilet paper holder with decorative fold
- Vanity: mirror with glass cleaner (buff to avoid streaks, check from angles) → countertop items moved → lip below mirror → back counter → faucet (heavy germ area, buff dry) → basin with agitation tool (dry completely) → cabinet facing → base where it meets floor
- Shower: remove all items → pre-soak if needed → top lip → shower head → outside → interior top to bottom → scrub until surface feels smooth → rinse thoroughly → dry fixtures always → replace items labels forward

SUPPLY CATALOG (28 items):
Chemicals: All-Purpose Cleaner, Bathroom Cleaner, Disinfectant Spray, Floor Cleaner, Furniture Polish, Glass Cleaner, Stainless Steel Cleaner, Toilet Bowl Cleaner
Tools: Bucket, Dustpan/Brush, Extension Pole, Microfiber Cloths, Mop Head, Scraper Blade, Scrub Brush, Sponges, Spray Bottles, Squeegee, Vacuum Bags
Paper: Paper Towels, Large Trash Bags, Small Trash Bags
PPE: Face Masks, Gloves (S/M/L), Safety Goggles

HOW TO HANDLE SITUATIONS:

SICK DAY: "Hi [name]! Sorry to hear you're not well. I've noted your absence and will notify your clients right away. Please rest up! Karen will receive a summary. — LHS 🏠"

TIME OFF REQUEST: Ask for dates and type (vacation/sick/unpaid). Confirm you'll submit to Karen for approval.

TRAINING QUESTION: Answer from your detailed cleaning knowledge above. Encourage LHS Academy completion. Remind 70% pass rate required.

SUPPLY REQUEST: Confirm items needed. Advise to submit through LHS Academy or you'll pass to Karen.

MEETING REQUEST WITH KAREN: Ask for topics confidentially. Arrange through scheduling system.

SAFETY EMERGENCY: "Please call 911 immediately if anyone is injured. Then call Karen at 604-260-1925. Stay safe! — LHS 🏠"

CLIENT INQUIRY: Handle warmly and professionally. For scheduling changes refer to HCP or Karen.

UNKNOWN: Acknowledge warmly, confirm you'll pass the message along, someone will follow up shortly.

DIALPAD CALL TRANSCRIPTS:
You have access to real call transcripts and AI recaps from Dialpad via the search function built into your system. When someone asks "what did X say" or "did we discuss Y" or "what happened on the call with Z", you can reference this knowledge. Key contacts from recent calls:
- Tannis (Boissonn): 250-212-2231
- Justin Delooff (Six Cedars/Westbow PM): 604-845-0506
- Lorissa W (employee): 604-798-2324
- Alissa D (employee): 250-566-5172
- Bill Gee: 778-984-2831
- Isaac Reid: 773-904-9383 (US — long calls, likely business development)
- Ladda Bouttavong (candidate): 778-539-3767

${callerContext ? `ARIA'S MEMORY — WHAT YOU KNOW ABOUT THIS CALLER:\n${callerContext}\nUse this to personalize your response. Reference previous conversations naturally.\n\n` : ''}TODAY'S LIVE SCHEDULE & CLIENT INTELLIGENCE:
${scheduleContext}

SCHEDULING RULES:
- When asked about today's schedule, jobs, assignments, or who is working where — use the live data above
- Be specific with times, names, addresses and statuses. If a job is canceled, mention that
- Convert times to Pacific time for the team
- High-priority clients must ALWAYS get their preferred cleaner when possible
- If a preferred cleaner calls in sick or is unavailable, suggest the best available replacement from today's cleaner list and flag it for Karen's approval
- When rescheduling, always try to keep the client's preferred day and time
- Commercial clients have strict schedules — never reschedule without Karen's direct approval
- If a cleaner is assigned to a client they're not preferred for, mention it proactively so Karen can review

RECURRING CLIENT PATTERNS:
- The "RECURRING CLIENT PATTERNS" section is derived from ACTUAL booked jobs in HouseCall Pro over the next 30 days — this is the ground truth for each client's real schedule
- Use these patterns (not just the knowledge base preferred_day) to determine when a client is actually scheduled
- If a pattern says "Weekly Mondays" that means HCP has them booked on Mondays — trust this over manually entered preferences
- "Usually cleaned by" tells you who HCP actually assigns to that client, which may differ from the KB preferred cleaner

IMPORTANT — DO NOT FLAG CLIENTS AS MISSING UNLESS THEIR ACTUAL PATTERN DAY IS TODAY:
- Check the RECURRING CLIENT PATTERNS to see which day a client is actually booked on
- A client with pattern "Weekly Thursdays" is NOT missing on Monday — they are simply not scheduled today
- Only flag a client as potentially missing if ALL of these are true: (1) their pattern day matches today's day of the week, (2) their frequency suggests they should have a job today, AND (3) they do not appear in today's live schedule
- If someone asks about a specific client, tell them the client's actual schedule day and usual cleaner from the pattern data
- When listing today's schedule, only show jobs that are actually scheduled today — do not add warnings about clients scheduled for other days
- If the pattern data and knowledge base disagree, trust the pattern data (it comes from real bookings)

Always be warm, helpful, knowledgeable and professional. You ARE Lifestyle Home Service to everyone who contacts you.`
  + (isAdmin ? `

ADMIN CAPABILITIES (you are texting with Karen or another admin):

YOU ARE A STRATEGIC SCHEDULING PARTNER — not just an assistant:
- You proactively bring insights Karen would want to know — don't wait to be asked
- You think ahead — spot problems before Karen does
- You remember every past conversation and reference it naturally
- You make specific actionable suggestions and implement them when approved
- You learn from every interaction and get smarter every week
- When Karen asks about the schedule, use get_schedule_intelligence to give her a real briefing, not generic answers
- When you spot an issue, suggest a specific fix with suggest_schedule_change
- Only implement changes after Karen explicitly approves

JOB NOTES: Use the add_job_note tool when asked to add a note to a client's jobs. If the client name is unclear, ask for clarification first.

TASK MANAGEMENT — You are Karen's digital chief of staff. Use these tools:

CRITICAL RULE — TASKS ARE REMINDERS FOR KAREN ONLY:
  Tasks and follow-ups are private reminders for Karen. When Karen says "follow up with Ladda" or "remind me to call A1 Pumps", Aria saves a reminder for KAREN — Aria does NOT contact Ladda or A1 Pumps.
  Aria ONLY contacts a cleaner or client when Karen explicitly uses the words "text", "call", "send", "notify", or "message" directed at that person.
  "Follow up with Ladda on Thursday" → save a reminder for Karen. Do NOT text Ladda.
  "Text Ladda about the interview" → that IS an instruction to contact Ladda.
  When in doubt, save it as a reminder and do NOT reach out to anyone.

save_task: Use when Karen mentions ANY task, follow-up, reminder, or to-do. Examples:
  "follow up with Ladda on Thursday" → save_task (reminder for Karen only)
  "need to call Tannis about pricing" → save_task (reminder for Karen only)
  "remind me to order supplies" → save_task (reminder for Karen only)
  "check Brandi's training progress" → save_task (reminder for Karen only)
  Be proactive — if it sounds like something Karen needs to remember, save it without asking.
  NEVER contact the person mentioned in the task unless Karen explicitly says "text", "send", "notify" or "message" them.
  Respond warmly: "Got it! I've saved 'Follow up with Ladda' for Thursday. I'll remind you! — LHS 🏠"

complete_task: Use when Karen says something is done, finished, handled, paid, or completed. Examples:
  "done - paid Vanessa" → complete_task with search_query "paid Vanessa"
  "Ladda follow-up is done" → complete_task with search_query "Ladda follow-up"
  "mark the supply order as complete" → complete_task
  Respond warmly: "Nice work! Marked 'Pay Vanessa' as done. One less thing on your plate! ✓ — LHS 🏠"

search_tasks: Use when Karen asks about tasks, what's pending, or whether something was done. Examples:
  "did we pay Vanessa?" → search_tasks with search_query "pay Vanessa"
  "what's on my plate?" → search_tasks with search_query "all" and status_filter "open"
  "anything overdue?" → search_tasks with search_query "overdue"
  "what happened with A1 Pumps?" → search_tasks with search_query "A1 Pumps"

build_stat_holiday_plan: Use when Karen says "yes build the plan" or "build the rescheduling plan" for a stat holiday. Examples:
  "yes build the plan for Victoria Day" → build_stat_holiday_plan
  "build the rescheduling plan for Canada Day" → build_stat_holiday_plan
  This fetches all jobs on the holiday, analyses client flexibility, and presents a plan for Karen to approve.
  Commercial clients are flagged as "locked" — Karen must decide. Residential clients get a suggested nearest day.
  NEVER reschedule anything without Karen's explicit approval — the plan is a proposal only.

approve_stat_holiday_plan: Use when Karen says "approve the plan", "go ahead and reschedule", "yes do it", or "approve" after seeing a rescheduling plan. Examples:
  "approve the plan" → approve_stat_holiday_plan
  "go ahead and reschedule the flexible ones" → approve_stat_holiday_plan
  This will: update flexible jobs in HCP, SMS each affected client, SMS each assigned cleaner, and confirm to Karen.
  ONLY use after Karen has seen and explicitly approved a rescheduling plan. Never auto-execute.

save_learning: Use PROACTIVELY when you discover new information during a conversation. Examples:
  Karen says "Hans Claus changed his day to Wednesdays" → save_learning about Hans Claus
  Karen says "Holly can't do heavy lifting anymore" → save_learning about Holly
  Karen says "Valley Toyota wants biweekly instead of weekly" → save_learning about Valley Toyota
  You don't need to ask permission — just save it and confirm: "Noted! I'll remember that Hans Claus switched to Wednesdays."

send_email: Use when Karen says "email", "send an email", or "write to" someone. Rules:
  ROUTINE (auto-send): appointment confirmations, schedule updates, thank-you notes, general info
  SENSITIVE (draft only): complaints, pricing changes, cancellations, refunds, legal, bad news
  Always write in Karen's warm professional voice. If you don't have the email address, look it up from HCP.
  After sending: "Done! I emailed [name] about [topic]. — LHS"
  After drafting: "I've saved a draft email to [name] about [topic]. Please review in Gmail before sending. — LHS"

call_client: Use when Karen says "call [person]", "phone [person]", or "leave a voicemail for [person]".
  Aria makes the call via Twilio, delivers the message via voice AI, and leaves a voicemail if no answer.
  Write the message naturally — conversational, warm, professional. Not robotic.
  After calling: "Done! I called [name] and [delivered the message / left a voicemail]. — LHS"

get_schedule_intelligence: Use when Karen asks about the schedule, asks "how's the week looking", or when you want to proactively flag issues. Examples:
  "how's next week looking?" → get_schedule_intelligence
  "any scheduling issues?" → get_schedule_intelligence
  "what do I need to know about this week?" → get_schedule_intelligence
  After getting results, summarize the top 2-3 insights conversationally and offer to dig into any of them.

suggest_schedule_change: Use after identifying an issue to propose a specific fix. Present clearly:
  "I noticed Holly is booked on Wednesday but she's unavailable. Want me to move her Wednesday client to April W instead?"
  ALWAYS wait for Karen to approve before implementing. Never auto-execute.

implement_schedule_change: Use ONLY after Karen explicitly says "yes", "go ahead", "do it", "approve" to a suggested change.
  Updates the job in HCP and notifies the cleaner. Always confirm what was done.

check_capacity: Use when Karen asks about capacity, staffing levels, workload, or whether to hire. Examples:
  "what's our capacity?" → check_capacity
  "how busy are we?" → check_capacity
  "do we need to hire?" → check_capacity
  Returns current week capacity %, trend vs last week, and projection.

PROACTIVE TASK INTELLIGENCE:
  - When Karen mentions a problem, complaint, or issue — proactively offer to save a follow-up task: "Want me to add a follow-up task for that?"
  - When you notice overdue tasks in the context, mention them naturally: "By the way, the A1 Pumps follow-up from last week is still open. Want to handle that today?"
  - When Karen is discussing a client or cleaner, check if there are related open tasks and mention them
  - Suggest tasks Karen might not have thought of based on the conversation

CAPACITY IN CONVERSATION:
  - At 70%+: mention warmly in relevant conversations: "By the way, we're at 70% capacity — might be good to start thinking about hiring"
  - At 80%+: recommend action: "We're at 80% capacity — I'd recommend starting the hiring process. Want me to add that as a top priority?"
  - At 90%+: flag urgently: "Karen, this is important — we're at 90% capacity. We really need to hire immediately."

BIRTHDAY AWARENESS:
  - If you know about upcoming staff birthdays, mention them warmly during morning conversations
  - "Just a heads up — Holly's birthday is in 3 days. Want me to make a note to acknowledge it?"

TONE: Be warm, encouraging, and personal. Karen is shifting from a paper notebook to digital — make her feel supported:
  "You're doing great, Karen — I've got this covered for you!"
  "That's 5 tasks done today! You're crushing it! 🎉"

PRIORITY ASSIGNMENT: When saving tasks, assess priority:
  high = overdue items, client complaints, safety issues, urgent follow-ups
  medium = routine follow-ups, scheduling changes, training check-ins
  low = supply orders, administrative tasks, nice-to-haves

CATEGORY ASSIGNMENT — choose the most specific match:
  scheduling = schedule changes, block-offs, availability, rescheduling
  client_followup = follow-ups with specific clients, client requests, client complaints
  cleaner_followup = follow-ups with specific cleaners, performance check-ins
  stat_holiday = statutory holiday schedule reviews, holiday pay
  new_client_onboarding = new client setup, intake, first clean scheduling
  quality_control = quality inspections, cleaning issues, missed items, client complaints about cleaning
  accounts_receivable = unpaid invoices, e-transfer follow-ups, outstanding balances, "owes", collections. Keywords: "pay", "invoice", "etransfer", "outstanding", "owes", "balance"
  accounts_payable = paying cleaners, supplier invoices, expenses, reimbursements. Keywords: "pay cleaner", "supplier", "expense", "reimburse"
  hiring = candidate follow-ups, interviews, onboarding new hires, probation reviews. Keywords: "interview", "candidate", "hire", "onboard", "probation", "applicant"
  payroll_invoicing = payroll calculations, timesheet reviews, invoice generation
  supply_ordering = supply orders, equipment, restocking. Keywords: "order", "supplies", "brooms", "dusters"
  staff_management = training progress, team issues, employee records, policy changes
  administrative = general business tasks, anything that doesn't fit above` : '');

  try {
    // Get or create conversation history for this phone number
    const conv = getConversation(from);
    
    // Add the new user message to history
    addToConversation(from, 'user', `Incoming SMS from ${from}: "${incomingMessage}"`);
    
    // Build messages array from conversation history
    const messages = conv.messages.length > 0 
      ? conv.messages 
      : [{ role: 'user', content: `Incoming SMS from ${from}: "${incomingMessage}"` }];

    // Build tool definitions for admin users
    const tools = isAdmin ? [{
      name: 'add_job_note',
      description: 'Add a note to a client\'s jobs in HouseCall Pro. Use when Karen asks to add a note, update instructions, or leave a message on a client\'s jobs.',
      input_schema: {
        type: 'object',
        properties: {
          client: { type: 'string', description: 'Client name exactly as it appears in the schedule (e.g. "Hans Claus", "Valley Toyota")' },
          note: { type: 'string', description: 'The note content to add to the job(s)' },
          range_days: { type: 'number', description: 'How many days of jobs to update: 1 for today only, 7 for this week, 90 for all future jobs. Default 90.' }
        },
        required: ['client', 'note']
      }
    }, {
      name: 'save_task',
      description: 'Save a task, follow-up, reminder, or to-do for Karen. Use whenever she mentions something she needs to do, follow up on, or remember.',
      input_schema: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Clear description of the task (e.g. "Follow up with Ladda about interview")' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Task priority' },
          category: { type: 'string', enum: ['scheduling', 'client_followup', 'cleaner_followup', 'stat_holiday', 'new_client_onboarding', 'quality_control', 'accounts_receivable', 'accounts_payable', 'hiring', 'payroll_invoicing', 'supply_ordering', 'staff_management', 'administrative'], description: 'Task category' },
          due_date: { type: 'string', description: `Due date in YYYY-MM-DD format, or null if no specific date. TODAY is ${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })}. Calculate relative dates from today (e.g. "Thursday" means the next upcoming Thursday from today).` },
          assigned_to: { type: 'string', enum: ['karen', 'aria'], description: 'Who handles this. Default karen.' },
          estimated_time_minutes: { type: 'number', description: 'Estimated minutes to complete' },
          notes: { type: 'string', description: 'Additional context or details' }
        },
        required: ['description', 'priority', 'category']
      }
    }, {
      name: 'complete_task',
      description: 'Mark a task as completed. Use when Karen says something is done, finished, handled, paid, or completed.',
      input_schema: {
        type: 'object',
        properties: {
          search_query: { type: 'string', description: 'Keywords to find the matching task (e.g. "pay Vanessa", "Ladda follow-up")' }
        },
        required: ['search_query']
      }
    }, {
      name: 'search_tasks',
      description: 'Search tasks by keyword. Use when Karen asks about tasks, what is pending, whether something was done, or wants to see her task list.',
      input_schema: {
        type: 'object',
        properties: {
          search_query: { type: 'string', description: 'Keywords to search for. Use "all" to list all open tasks, "overdue" for overdue items.' },
          status_filter: { type: 'string', enum: ['open', 'completed', 'all'], description: 'Filter by status. Default: all.' }
        },
        required: ['search_query']
      }
    }, {
      name: 'build_stat_holiday_plan',
      description: 'Build a rescheduling plan for a stat holiday. Use when Karen says "yes build the plan" or "build the rescheduling plan" for a stat holiday.',
      input_schema: {
        type: 'object',
        properties: {
          holiday_date: { type: 'string', description: `The stat holiday date in YYYY-MM-DD format. 2026 BC holidays: Victoria Day=2026-05-18, Indigenous Peoples Day=2026-06-21, Canada Day=2026-07-01, BC Day=2026-08-03, Labour Day=2026-09-07, Truth & Reconciliation=2026-09-30, Thanksgiving=2026-10-12, Remembrance Day=2026-11-11, Christmas=2026-12-25, Boxing Day=2026-12-26` },
          holiday_name: { type: 'string', description: 'Name of the holiday (e.g. "Victoria Day")' }
        },
        required: ['holiday_date', 'holiday_name']
      }
    }, {
      name: 'approve_stat_holiday_plan',
      description: 'Execute the approved stat holiday rescheduling plan. Use when Karen says "approve the plan", "go ahead and reschedule", or "yes do it" after seeing a rescheduling plan. This will update flexible client jobs in HCP, notify affected clients by SMS, and notify assigned cleaners.',
      input_schema: {
        type: 'object',
        properties: {
          holiday_date: { type: 'string', description: 'The stat holiday date in YYYY-MM-DD format' },
          holiday_name: { type: 'string', description: 'Name of the holiday' }
        },
        required: ['holiday_date', 'holiday_name']
      }
    }, {
      name: 'check_capacity',
      description: 'Check workforce capacity. Use when Karen asks "what is our capacity?", "how busy are we?", "do we need to hire?", or anything about staffing levels, workload, or capacity.',
      input_schema: {
        type: 'object',
        properties: {},
        required: []
      }
    }, {
      name: 'save_learning',
      description: 'Save something new Aria learned about a client, cleaner, or the business. Use proactively when you discover new information during a conversation — client changed their preferred day, cleaner has a health issue, pricing changed, etc.',
      input_schema: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'Who or what this is about (e.g. "Hans Claus", "Holly D", "Valley Toyota pricing")' },
          category: { type: 'string', enum: ['client', 'cleaner', 'scheduling', 'pricing', 'quality', 'general'], description: 'Category of the learning' },
          fact: { type: 'string', description: 'The new fact or information learned' }
        },
        required: ['subject', 'category', 'fact']
      }
    }, {
      name: 'send_email',
      description: 'Send or draft an email on Karen\'s behalf. Use when Karen says "email [client] about [topic]" or "send an email to [person]". For routine emails (confirmations, reminders, scheduling updates) — sends automatically. For sensitive topics (complaints, pricing, cancellations) — saves as draft for Karen to review.',
      input_schema: {
        type: 'object',
        properties: {
          client_name: { type: 'string', description: 'Client or recipient name to look up email from HCP' },
          to_email: { type: 'string', description: 'Email address if known (overrides client lookup)' },
          subject: { type: 'string', description: 'Email subject line' },
          body: { type: 'string', description: 'Email body — write in Karen\'s warm professional voice' },
          force_draft: { type: 'boolean', description: 'Set true to force save as draft even if topic seems routine' }
        },
        required: ['subject', 'body']
      }
    }, {
      name: 'call_client',
      description: 'Make an outbound phone call to a client or cleaner. Aria calls them, delivers the message via voice AI, and leaves a voicemail if no answer. Use when Karen says "call [person]" or "leave a voicemail for [person]".',
      input_schema: {
        type: 'object',
        properties: {
          client_name: { type: 'string', description: 'Name of the person to call — will look up phone from HCP' },
          message: { type: 'string', description: 'The message to deliver — natural conversational tone' }
        },
        required: ['client_name', 'message']
      }
    }, {
      name: 'get_schedule_intelligence',
      description: 'Get proactive scheduling analysis for the next 7 days. Spots gaps, conflicts, overloaded cleaners, preferred cleaner mismatches, and cleaners booked on unavailable days. Use when Karen asks about the schedule, staffing, or when you want to proactively flag issues.',
      input_schema: { type: 'object', properties: {}, required: [] }
    }, {
      name: 'suggest_schedule_change',
      description: 'Propose a specific schedule change for Karen to approve. Use after identifying an issue via schedule intelligence. Present the change clearly and wait for Karen to say yes before implementing.',
      input_schema: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'The HCP job ID to change' },
          client_name: { type: 'string', description: 'Client name for the job' },
          change_type: { type: 'string', enum: ['reschedule', 'reassign', 'cancel'], description: 'Type of change' },
          current_state: { type: 'string', description: 'Current assignment/date (e.g. "Monday April 7, assigned to Holly")' },
          proposed_state: { type: 'string', description: 'Proposed new assignment/date (e.g. "Tuesday April 8, assigned to April W")' },
          reason: { type: 'string', description: 'Why this change is recommended' }
        },
        required: ['client_name', 'change_type', 'current_state', 'proposed_state', 'reason']
      }
    }, {
      name: 'implement_schedule_change',
      description: 'Execute an approved schedule change in HCP. ONLY use after Karen has explicitly approved the change. Updates the job in HCP and notifies the affected cleaner.',
      input_schema: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'The HCP job ID to update' },
          new_date: { type: 'string', description: 'New date in YYYY-MM-DD format' },
          new_start_time: { type: 'string', description: 'New start time in HH:MM format (24h, Pacific)' },
          new_end_time: { type: 'string', description: 'New end time in HH:MM format (24h, Pacific)' }
        },
        required: ['job_id', 'new_date']
      }
    }] : [];

    const claudeBody = {
      model: 'claude-sonnet-4-5',
      max_tokens: 400,
      system: ARIA_SYSTEM_PROMPT,
      messages: messages
    };
    if (tools.length > 0) claudeBody.tools = tools;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(claudeBody)
    });

    const claudeData = await claudeResponse.json();

    // Check if Claude used a tool (admin action)
    const toolUse = claudeData.content?.find(b => b.type === 'tool_use');
    const textBlock = claudeData.content?.find(b => b.type === 'text');
    let twimlReply;

    if (toolUse && toolUse.name === 'add_job_note') {
      const { client, note, range_days } = toolUse.input;
      console.log(`[BULK-NOTES] Tool call: client="${client}", note="${note}", range=${range_days || 90} days`);

      // Execute bulk notes directly (no HTTP self-call — Vercel blocks those)
      try {
        console.log(`[BULK-NOTES] Executing inline...`);
        const result = await executeBulkNotes({
          clientName: client,
          noteContent: note,
          dateRangeStart: new Date().toISOString(),
          dateRangeEnd: new Date(Date.now() + (range_days || 90) * 86400000).toISOString(),
          adminPhone: from,
          timestamp: new Date().toISOString()
        });
        console.log(`[BULK-NOTES] Result:`, JSON.stringify(result));

        if (result.noted > 0) {
          let msg = `Done! Added note to ${result.noted} ${client} job${result.noted !== 1 ? 's' : ''}.`;
          if (result.notified?.length > 0) {
            msg += ` ${result.notified.join(' and ')} ${result.notified.length === 1 ? 'has' : 'have'} been notified.`;
          }
          if (result.failed > 0) msg += ` ${result.failed} failed.`;
          msg += ' — LHS 🏠';
          twimlReply = msg;
        } else if (result.matched === 0) {
          twimlReply = `No upcoming jobs found for "${client}". Double-check the name? — LHS 🏠`;
        } else {
          twimlReply = `On it! Adding "${note}" to ${client} jobs. — LHS 🏠`;
        }
      } catch (err) {
        console.error('[BULK-NOTES] Execution failed:', err.message);
        twimlReply = `Sorry, something went wrong adding notes for ${client}. Please try again. — LHS 🏠`;
      }
    } else if (toolUse && toolUse.name === 'save_task') {
      const { description, priority, category, due_date, assigned_to, estimated_time_minutes, notes } = toolUse.input;
      console.log(`[TASKS] Save tool: "${description}" (${priority}, ${category}, due: ${due_date || 'none'})`);

      try {
        const task = await saveTask({
          description,
          priority: priority || 'medium',
          category: category || 'admin',
          due_date: due_date || null,
          assigned_to: assigned_to || 'karen',
          estimated_time_minutes: estimated_time_minutes || null,
          notes: notes || '',
          source_message: incomingMessage
        });

        twimlReply = `Got it! I've saved "${description}"${due_date ? ` for ${due_date}` : ''}. I'll keep track of this for you! — LHS 🏠`;
      } catch (err) {
        console.error('[TASKS] Save failed:', err.message);
        twimlReply = `Sorry, I couldn't save that task. Please try again! — LHS 🏠`;
      }

    } else if (toolUse && toolUse.name === 'complete_task') {
      const { search_query } = toolUse.input;
      console.log(`[TASKS] Complete tool: searching for "${search_query}"`);

      try {
        const results = await searchTasks(search_query, 'open');

        if (results.length === 0) {
          // Check if already completed
          const allResults = await searchTasks(search_query, 'completed');
          if (allResults.length > 0) {
            const t = allResults[0];
            const completedDate = t.completed_at ? new Date(t.completed_at).toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }) : 'earlier';
            twimlReply = `That one's already done! "${t.description}" was completed on ${completedDate}. — LHS 🏠`;
          } else {
            twimlReply = `I couldn't find an open task matching "${search_query}". Could you try different keywords? — LHS 🏠`;
          }
        } else {
          const task = await completeTask(results[0].id);
          const openCount = (await getOpenTasks()).length;
          twimlReply = `Nice work! Marked "${task.description}" as done. ✓ You have ${openCount} task${openCount !== 1 ? 's' : ''} remaining. — LHS 🏠`;
        }
      } catch (err) {
        console.error('[TASKS] Complete failed:', err.message);
        twimlReply = `Sorry, something went wrong completing that task. Please try again! — LHS 🏠`;
      }

    } else if (toolUse && toolUse.name === 'search_tasks') {
      const { search_query, status_filter } = toolUse.input;
      console.log(`[TASKS] Search tool: "${search_query}" (filter: ${status_filter || 'all'})`);

      try {
        let results;
        if (search_query === 'overdue') {
          results = await getOverdueTasks();
        } else if (search_query === 'all') {
          results = await getOpenTasks();
        } else {
          results = await searchTasks(search_query, status_filter || 'all');
        }

        if (results.length === 0) {
          twimlReply = `Nothing found for "${search_query}". Your slate is clean! — LHS 🏠`;
        } else {
          const shown = results.slice(0, 5);
          const lines = shown.map(t => {
            const status = t.status === 'completed' ? '✓' : (t.due_date && t.due_date < new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }) ? '⚠️' : '○');
            const due = t.due_date ? ` (${t.due_date})` : '';
            return `${status} ${t.description}${due}`;
          });
          let msg = lines.join('\n');
          if (results.length > 5) msg += `\n...and ${results.length - 5} more`;
          msg += ' — LHS 🏠';
          twimlReply = msg;
        }
      } catch (err) {
        console.error('[TASKS] Search failed:', err.message);
        twimlReply = `Sorry, I couldn't search tasks right now. Please try again! — LHS 🏠`;
      }

    } else if (toolUse && toolUse.name === 'build_stat_holiday_plan') {
      const { holiday_date, holiday_name } = toolUse.input;
      console.log(`[STAT-PLAN] Building plan for ${holiday_name} (${holiday_date})`);

      try {
        // Fetch jobs and client preferences
        const apiKey = process.env.HCP_API_KEY;
        const start = `${holiday_date}T00:00:00Z`;
        const end = `${holiday_date}T23:59:59Z`;

        const [jobsResp, clientsResp] = await Promise.all([
          fetch(`https://api.housecallpro.com/jobs?scheduled_start_min=${start}&scheduled_start_max=${end}&page_size=200`, {
            headers: { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' }
          }),
          fetch('https://lhs-knowledge-base.vercel.app/api/clients')
        ]);

        const jobsData = await jobsResp.json();
        const clientsData = await clientsResp.json();
        const jobs = (jobsData.jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at);
        const clients = clientsData.clients || [];

        if (jobs.length === 0) {
          twimlReply = `No jobs scheduled on ${holiday_name} (${holiday_date}). Nothing to reschedule! — LHS 🏠`;
        } else {
          // Build client lookup
          const clientLookup = {};
          for (const c of clients) clientLookup[c.name.toLowerCase()] = c;

          // Analyze each job
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const holidayDow = new Date(holiday_date + 'T12:00:00Z').getUTCDay();

          let msg = `📋 Rescheduling plan for ${holiday_name} (${holiday_date}):\n\n`;
          let lockedCount = 0;
          let flexCount = 0;

          for (const job of jobs) {
            const custName = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim();
            const employees = (job.assigned_employees || []).map(e => `${e.first_name} ${e.last_name}`).join(', ') || 'Unassigned';
            const prefs = clientLookup[custName.toLowerCase()];
            const isCommercial = prefs?.client_type === 'Commercial';

            if (isCommercial) {
              lockedCount++;
              msg += `🔒 ${custName} (Commercial) — ${employees}\n   LOCKED: Needs your decision\n`;
            } else {
              flexCount++;
              // Suggest nearest day: day before or after the holiday
              const beforeDate = new Date(holiday_date + 'T12:00:00Z');
              beforeDate.setDate(beforeDate.getDate() - 1);
              const afterDate = new Date(holiday_date + 'T12:00:00Z');
              afterDate.setDate(afterDate.getDate() + 1);
              const suggestDate = beforeDate.getUTCDay() !== 0 ? beforeDate : afterDate; // Skip Sunday
              const suggestStr = suggestDate.toISOString().split('T')[0];
              const suggestDay = dayNames[suggestDate.getUTCDay()];

              msg += `✅ ${custName} — ${employees}\n   Suggest: move to ${suggestDay} ${suggestStr}\n`;
            }
          }

          msg += `\n${lockedCount} locked (need your call), ${flexCount} flexible (ready to move).\n`;
          msg += `Reply "approve the plan" and I'll reschedule the flexible ones. Locked ones are up to you! — Aria 🏠`;

          twimlReply = msg;
        }
      } catch (err) {
        console.error('[STAT-PLAN] Error:', err.message);
        twimlReply = `Sorry, I couldn't build the rescheduling plan for ${holiday_name}. Please try again! — LHS 🏠`;
      }

    } else if (toolUse && toolUse.name === 'approve_stat_holiday_plan') {
      const { holiday_date, holiday_name } = toolUse.input;
      console.log(`[STAT-APPROVE] Executing approved plan for ${holiday_name} (${holiday_date})`);

      try {
        const apiKey = process.env.HCP_API_KEY;
        const hcpHeaders = { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
        const start = `${holiday_date}T00:00:00Z`;
        const end = `${holiday_date}T23:59:59Z`;

        // Fetch jobs and client data
        const [jobsResp, clientsResp] = await Promise.all([
          fetch(`https://api.housecallpro.com/jobs?scheduled_start_min=${start}&scheduled_start_max=${end}&page_size=200`, { headers: hcpHeaders }),
          fetch('https://lhs-knowledge-base.vercel.app/api/clients')
        ]);

        const jobsData = await jobsResp.json();
        const clientsData = await clientsResp.json();
        const jobs = (jobsData.jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at);
        const clients = clientsData.clients || [];
        const clientLookup = {};
        for (const c of clients) clientLookup[c.name.toLowerCase()] = c;

        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        let rescheduled = 0;
        let locked = 0;
        const clientsNotified = [];
        const cleanersNotified = new Map();

        for (const job of jobs) {
          const custName = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim();
          const prefs = clientLookup[custName.toLowerCase()];
          const isCommercial = prefs?.client_type === 'Commercial';

          if (isCommercial) {
            locked++;
            continue; // Skip locked — Karen handles these
          }

          // Calculate new date: day before holiday, skip Sunday
          const newDate = new Date(holiday_date + 'T12:00:00Z');
          newDate.setDate(newDate.getDate() - 1);
          if (newDate.getUTCDay() === 0) newDate.setDate(newDate.getDate() - 1); // Skip Sunday

          // Reschedule in HCP
          const origStart = new Date(job.schedule?.scheduled_start);
          const origEnd = new Date(job.schedule?.scheduled_end);
          const duration = origEnd - origStart;
          const newStart = new Date(newDate.toISOString().split('T')[0] + 'T' + origStart.toISOString().split('T')[1]);
          const newEnd = new Date(newStart.getTime() + duration);

          try {
            const schedResp = await fetch(`https://api.housecallpro.com/jobs/${job.id}/schedule`, {
              method: 'PUT',
              headers: hcpHeaders,
              body: JSON.stringify({ start_time: newStart.toISOString(), end_time: newEnd.toISOString() })
            });

            if (schedResp.ok) {
              rescheduled++;
              const newDateStr = newDate.toLocaleDateString('en-CA', { timeZone: 'America/Vancouver', month: 'long', day: 'numeric', weekday: 'long' });

              // Notify client
              const clientPhone = job.customer?.mobile_number || job.customer?.home_number;
              if (clientPhone) {
                await sendSMSNotification(clientPhone,
                  `Hi ${job.customer.first_name}! Your cleaning on ${holiday_name} has been moved to ${newDateStr}. Same time, same great service! Questions? Call us at 604-260-1925. — LHS 🏠`
                );
                clientsNotified.push(custName);
              }

              // Track cleaners to notify
              for (const emp of (job.assigned_employees || [])) {
                if (emp.mobile_number && !cleanersNotified.has(emp.mobile_number)) {
                  cleanersNotified.set(emp.mobile_number, {
                    name: `${emp.first_name} ${emp.last_name}`.trim(),
                    phone: emp.mobile_number
                  });
                }
              }
            } else {
              console.error(`[STAT-APPROVE] Reschedule failed for ${job.id}:`, await schedResp.text());
            }
          } catch (err) {
            console.error(`[STAT-APPROVE] Error rescheduling ${job.id}:`, err.message);
          }
        }

        // Notify all affected cleaners
        const cleanerNames = [];
        for (const [phone, cleaner] of cleanersNotified) {
          const result = await sendSMSNotification(phone,
            `Hi ${cleaner.name.split(' ')[0]}! Some of your ${holiday_name} jobs have been rescheduled. Please check HouseCall Pro for your updated schedule. Questions? Text back or call Karen. — LHS 🏠`
          );
          if (result.sid) cleanerNames.push(cleaner.name);
        }

        let msg = `Done! ${holiday_name} rescheduling complete:\n\n`;
        msg += `✅ ${rescheduled} job${rescheduled !== 1 ? 's' : ''} rescheduled\n`;
        if (locked > 0) msg += `🔒 ${locked} commercial job${locked !== 1 ? 's' : ''} still need your decision\n`;
        if (clientsNotified.length > 0) msg += `📱 ${clientsNotified.length} client${clientsNotified.length !== 1 ? 's' : ''} notified\n`;
        if (cleanerNames.length > 0) msg += `👷 Cleaners notified: ${cleanerNames.join(', ')}\n`;
        msg += `\n— Aria 🏠`;

        twimlReply = msg;
        console.log(`[STAT-APPROVE] Complete: ${rescheduled} rescheduled, ${locked} locked, ${clientsNotified.length} clients notified, ${cleanerNames.length} cleaners notified`);

      } catch (err) {
        console.error('[STAT-APPROVE] Error:', err.message);
        twimlReply = `Sorry, something went wrong executing the rescheduling plan. Please try again! — LHS 🏠`;
      }

    } else if (toolUse && toolUse.name === 'check_capacity') {
      console.log('[CAPACITY] Checking capacity via SMS tool');

      try {
        const cap = await getCapacityData();
        const trendStr = cap.trend > 0 ? `📈 up ${cap.trend}%` : cap.trend < 0 ? `📉 down ${Math.abs(cap.trend)}%` : '➡️ flat';

        let msg = `📊 Workforce Capacity: ${cap.capacity}%\n\n`;
        msg += `${cap.bookedHours}h booked / ${cap.availableHours}h available this week\n`;
        msg += `${cap.jobCount} jobs across ${cap.cleanerCount} active cleaners\n`;
        msg += `Trend: ${trendStr} from last week\n`;
        if (cap.weeksUntilFull) {
          msg += `At this pace, full capacity in ~${cap.weeksUntilFull} week${cap.weeksUntilFull !== 1 ? 's' : ''}\n`;
        }

        if (cap.capacity >= 90) msg += `\n🔴 Critical — hiring needed immediately!`;
        else if (cap.capacity >= 80) msg += `\n🟠 Time to start the hiring process.`;
        else if (cap.capacity >= 70) msg += `\n🟡 Keep an eye on it — hiring soon.`;
        else msg += `\n💚 Healthy — room to grow!`;
        msg += ` — LHS 🏠`;

        twimlReply = msg;
      } catch (err) {
        console.error('[CAPACITY] Check failed:', err.message);
        twimlReply = `Sorry, I couldn't pull the capacity data right now. Please try again! — LHS 🏠`;
      }

    } else if (toolUse && toolUse.name === 'save_learning') {
      const { subject, category, fact } = toolUse.input;
      console.log(`[MEMORY] Learning tool: ${subject} — ${fact.substring(0, 60)}`);

      try {
        await saveLearning({
          subject,
          category: category || 'general',
          fact,
          source: 'sms_conversation'
        });
        twimlReply = `Noted! I'll remember that about ${subject}. — LHS 🏠`;
      } catch (err) {
        console.error('[MEMORY] Save learning failed:', err.message);
        twimlReply = `Got it, though I had trouble saving that note. I'll keep it in mind for this conversation. — LHS 🏠`;
      }

    } else if (toolUse && toolUse.name === 'send_email') {
      const { client_name, to_email, subject, body, force_draft } = toolUse.input;
      console.log(`[EMAIL] Tool: ${client_name || to_email} — "${subject}"`);

      try {
        // Resolve email address
        let email = to_email;
        if (!email && client_name) {
          email = await lookupClientEmail(client_name);
        }
        if (!email) {
          twimlReply = `I couldn't find an email address for ${client_name || 'that contact'}. Can you give me the email? — LHS 🏠`;
        } else {
          const sensitive = force_draft || isSensitiveTopic(subject, body);
          if (sensitive) {
            await saveDraft({ to: email, subject, body });
            twimlReply = `I've saved a draft email to ${client_name || email} about "${subject}". Please review in your Gmail drafts before sending. — LHS 🏠`;
          } else {
            await sendEmail({ to: email, subject, body });
            twimlReply = `Done! I emailed ${client_name || email} about "${subject}". — LHS 🏠`;
          }
        }
      } catch (err) {
        console.error('[EMAIL] Failed:', err.message);
        twimlReply = `Sorry, I couldn't send that email. Error: ${err.message.substring(0, 80)}. — LHS 🏠`;
      }

    } else if (toolUse && toolUse.name === 'call_client') {
      const { client_name, message } = toolUse.input;
      console.log(`[CALL] Tool: calling ${client_name}`);

      try {
        const phone = await lookupClientPhone(client_name);
        if (!phone) {
          twimlReply = `I couldn't find a phone number for ${client_name} in HouseCall Pro. Can you give me their number? — LHS 🏠`;
        } else {
          const result = await makeCall({ to: phone, message, callerName: client_name });
          if (result.called) {
            twimlReply = `Done! I'm calling ${client_name} now to deliver your message. I'll leave a voicemail if they don't answer. — LHS 🏠`;
          } else {
            twimlReply = `Sorry, I couldn't reach ${client_name}: ${result.error}. — LHS 🏠`;
          }
        }
      } catch (err) {
        console.error('[CALL] Failed:', err.message);
        twimlReply = `Sorry, the call to ${client_name} failed. — LHS 🏠`;
      }

    } else if (toolUse && toolUse.name === 'get_schedule_intelligence') {
      console.log('[SCHED-INTEL] Running schedule analysis via tool');
      try {
        const result = await analyzeSchedule();
        const topInsights = result.insights.slice(0, 3);
        const topRecs = result.recommendations.slice(0, 2);

        let msg = `Here's what I see for the next 7 days (${result.jobCount} jobs):\n\n`;
        if (topInsights.length > 0) {
          for (const i of topInsights) msg += `• ${i}\n`;
        }
        if (topRecs.length > 0) {
          msg += `\nI'd recommend:\n`;
          for (const r of topRecs) msg += `• ${r}\n`;
        }
        if (topInsights.length === 0 && topRecs.length === 0) {
          msg += `Everything looks great — no conflicts or issues this week!`;
        }
        msg += `\nWant me to dig into any of these? — LHS 🏠`;
        twimlReply = msg;
      } catch (err) {
        console.error('[SCHED-INTEL] Error:', err.message);
        twimlReply = `Sorry, I couldn't analyze the schedule right now. Please try again! — LHS 🏠`;
      }

    } else if (toolUse && toolUse.name === 'suggest_schedule_change') {
      const { client_name, change_type, current_state, proposed_state, reason } = toolUse.input;
      console.log(`[SCHED-CHANGE] Suggesting: ${client_name} — ${change_type}`);

      let msg = `I'd like to suggest a change:\n\n`;
      msg += `Client: ${client_name}\n`;
      msg += `Currently: ${current_state}\n`;
      msg += `Proposed: ${proposed_state}\n`;
      msg += `Reason: ${reason}\n\n`;
      msg += `Want me to go ahead with this? — LHS 🏠`;
      twimlReply = msg;

      // Save the suggestion as a learning so Aria remembers it
      await saveLearning({
        subject: client_name,
        category: 'scheduling',
        fact: `Suggested ${change_type}: ${current_state} → ${proposed_state}. Reason: ${reason}`,
        source: 'schedule_intelligence'
      }).catch(() => {});

    } else if (toolUse && toolUse.name === 'implement_schedule_change') {
      const { job_id, new_date, new_start_time, new_end_time } = toolUse.input;
      console.log(`[SCHED-CHANGE] Implementing: ${job_id} → ${new_date} ${new_start_time || ''}`);

      try {
        const apiKey = process.env.HCP_API_KEY;
        const startISO = new_start_time
          ? `${new_date}T${new_start_time}:00-07:00`
          : `${new_date}T09:00:00-07:00`;
        const endISO = new_end_time
          ? `${new_date}T${new_end_time}:00-07:00`
          : `${new_date}T11:00:00-07:00`;

        const resp = await fetch(`https://api.housecallpro.com/jobs/${job_id}/schedule`, {
          method: 'PUT',
          headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ start_time: startISO, end_time: endISO })
        });

        if (resp.ok) {
          // Notify the assigned cleaner
          const jobResp = await fetch(`https://api.housecallpro.com/jobs/${job_id}`, {
            headers: { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' }
          });
          const jobData = await jobResp.json();
          const custName = `${jobData.customer?.first_name || ''} ${jobData.customer?.last_name || ''}`.trim();

          for (const emp of (jobData.assigned_employees || [])) {
            if (emp.mobile_number) {
              const phone = emp.mobile_number.length === 10 ? `+1${emp.mobile_number}` : `+${emp.mobile_number}`;
              await sendSMSNotification(phone,
                `Hi ${emp.first_name}, the ${custName} job has been moved to ${new_date}. Please check HouseCall Pro for your updated schedule. — LHS 🏠`
              );
            }
          }

          // Save as a learning
          await saveLearning({
            subject: custName,
            category: 'scheduling',
            fact: `Job rescheduled to ${new_date}${new_start_time ? ' at ' + new_start_time : ''}. Karen approved.`,
            source: 'schedule_change'
          }).catch(() => {});

          twimlReply = `Done! Moved ${custName} to ${new_date}. The cleaner has been notified. — LHS 🏠`;
        } else {
          const errText = await resp.text();
          console.error(`[SCHED-CHANGE] HCP error: ${resp.status} ${errText}`);
          twimlReply = `Sorry, I couldn't update that job in HCP. Error: ${resp.status}. Please try manually. — LHS 🏠`;
        }
      } catch (err) {
        console.error('[SCHED-CHANGE] Error:', err.message);
        twimlReply = `Sorry, something went wrong with the schedule change. Please try again! — LHS 🏠`;
      }

    } else {
      // Normal text response (no tool call)
      twimlReply = textBlock?.text || claudeData.content?.[0]?.text ||
        "Hi! Thanks for your message. I'll get back to you shortly. For urgent matters please call 604-260-1925. — LHS 🏠";
    }

    // Add Aria's response to conversation history
    addToConversation(from, 'assistant', twimlReply);

    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${twimlReply}</Message>
</Response>`);

    // Save conversation summary to memory (non-blocking — don't delay response)
    saveConversation({
      phone: from,
      contactName: isAdmin ? 'Karen McLaren' : from,
      channel: 'sms',
      summary: incomingMessage.substring(0, 200),
      actionTaken: toolUse ? `Used ${toolUse.name} tool` : null,
      outcome: twimlReply.substring(0, 150)
    }).catch(err => console.error('[MEMORY] Conversation save failed:', err.message));

  } catch (err) {
    console.error('Aria error:', err);
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Hi! Thanks for your message. I'll get back to you shortly. For urgent matters please call 604-260-1925. — LHS 🏠</Message>
</Response>`);
  }
}
