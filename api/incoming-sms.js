export const config = { api: { bodyParser: true }, maxDuration: 60 };

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
  console.log(`[ARIA] Context built — HCP today: ${hcpResult.jobs.length}, KB clients: ${clientData.clients.length}, patterns cached: ${patterns ? 'yes' : 'no'}`);

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

TODAY'S LIVE SCHEDULE & CLIENT INTELLIGENCE:
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
You can add notes to client jobs in HouseCall Pro. When asked to add a note to a client's jobs, use the add_job_note tool. If the client name is unclear, ask for clarification first.` : '');

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

      // Karen's TwiML reply — never contains JSON
      twimlReply = textBlock?.text?.trim() || `On it! Adding "${note}" to ${client} jobs. I'll text you the confirmation shortly. — LHS 🏠`;

      // Dispatch to bulk-job-notes worker and AWAIT it before returning
      // (Vercel kills the function after res.send, so fire-and-forget doesn't work)
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://lhs-scheduler-proxy.vercel.app';

      try {
        console.log(`[BULK-NOTES] Dispatching and awaiting worker...`);
        const workerResp = await fetchWithTimeout(`${baseUrl}/api/bulk-job-notes`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_SECRET}`
          },
          body: JSON.stringify({
            clientName: client,
            noteContent: note,
            dateRangeStart: new Date().toISOString(),
            dateRangeEnd: new Date(Date.now() + (range_days || 90) * 86400000).toISOString(),
            adminPhone: from,
            timestamp: new Date().toISOString()
          })
        }, 25000); // 25s timeout — worker does notes + SMS
        const workerResult = await workerResp.json();
        console.log(`[BULK-NOTES] Worker result:`, JSON.stringify(workerResult));

        // Update twimlReply with actual results if worker succeeded
        if (workerResult.noted > 0) {
          let msg = `Done! Added note to ${workerResult.noted} ${client} job${workerResult.noted !== 1 ? 's' : ''}.`;
          if (workerResult.notified?.length > 0) {
            msg += ` ${workerResult.notified.join(' and ')} ${workerResult.notified.length === 1 ? 'has' : 'have'} been notified.`;
          }
          msg += ' — LHS 🏠';
          twimlReply = msg;
        }
      } catch (err) {
        console.error('[BULK-NOTES] Worker call failed:', err.message);
        // Keep the original twimlReply — Karen still gets acknowledgment
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

  } catch (err) {
    console.error('Aria error:', err);
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Hi! Thanks for your message. I'll get back to you shortly. For urgent matters please call 604-260-1925. — LHS 🏠</Message>
</Response>`);
  }
}
