// Aria Voice Brain — Claude Haiku with SSE streaming for ElevenLabs
// Target: first token to caller's ears within 500ms
// Architecture: ElevenLabs → voice-brain.js → Claude Haiku (streaming) → ElevenLabs speaks
// Caller recognition: identifies callers by phone number, greets by name

export const config = { api: { bodyParser: true }, maxDuration: 15 };

import { getPersonaContext, getManagementContext, getPersonaByPhone } from './_persona-store.js';

// ─── Known callers — phone (last 10 digits) → identity ────────────────────
const KNOWN_CALLERS = {
  '6048009630': { name: 'Karen', fullName: 'Karen McLaren', role: 'manager' },
  '6042601925': { name: 'Michael', fullName: 'Michael Butterfield', role: 'owner' }
};

// Extract caller phone from multiple possible sources
function identifyCaller(body) {
  let phone = '';

  // Source 1: ElevenLabs system message with resolved {{system__caller_id}}
  const messages = body.messages || [];
  const systemMsg = messages.find(m => m.role === 'system');
  if (systemMsg?.content) {
    const match = systemMsg.content.match(/CALLER_PHONE:\s*(\+?[\d\s()-]+)/);
    if (match) phone = match[1];
  }

  // Source 2: ElevenLabs may pass caller info in body metadata
  if (!phone) phone = body.caller_id || body.phone_number || body.caller_phone || '';

  // Source 3: ElevenLabs dynamic variables
  if (!phone && body.dynamic_variables?.system__caller_id) {
    phone = body.dynamic_variables.system__caller_id;
  }

  // Source 4: Check conversation_initiation_metadata
  if (!phone && body.conversation_initiation_metadata?.caller_id) {
    phone = body.conversation_initiation_metadata.caller_id;
  }

  // Normalize: strip non-digits, take last 10
  const digits = phone.replace(/\D/g, '');
  const last10 = digits.slice(-10);

  // Check known callers
  const known = KNOWN_CALLERS[last10];
  if (known) return { ...known, phone: last10, identified: true };

  // Unknown caller
  return { name: null, fullName: null, role: 'unknown', phone: last10, identified: false };
}

const TIMEZONE = 'America/Vancouver';
const KB_SAVE_URL = 'https://lhs-knowledge-base.vercel.app/api/save';

// ─── In-memory schedule cache (avoids KB round-trip on warm instances) ───────
let memSchedule = null;
let memScheduleAge = 0;
const MEM_TTL = 10 * 60 * 1000;

async function getScheduleContext() {
  // Tier 1: in-memory
  if (memSchedule && (Date.now() - memScheduleAge) < MEM_TTL) return memSchedule;

  // Tier 2: KB cache
  try {
    const resp = await fetch(`${KB_SAVE_URL}?key=aria_voice_cache`);
    const data = await resp.json();
    if (data.value?.schedule) {
      memSchedule = data.value.schedule;
      memScheduleAge = Date.now();
      return memSchedule;
    }
  } catch (e) {}

  // Tier 3: live HCP fetch
  try {
    const apiKey = process.env.HCP_API_KEY;
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).toISOString();

    const [jr, cr] = await Promise.all([
      fetch(`https://api.housecallpro.com/jobs?scheduled_start_min=${start}&scheduled_start_max=${end}&page_size=200`,
        { headers: { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' } }),
      fetch('https://lhs-knowledge-base.vercel.app/api/clients').catch(() => null)
    ]);

    const jobs = jr.ok ? ((await jr.json()).jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at) : [];
    let roster = [];
    if (cr?.ok) { const cd = await cr.json(); roster = (cd.cleaners || []).filter(c => c.days?.length > 0); }

    const todayStr = now.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
    const tom = new Date(now); tom.setDate(tom.getDate() + 1);
    const tomStr = tom.toLocaleDateString('en-CA', { timeZone: TIMEZONE });

    let text = '';
    for (const d of [{ l: `TODAY (${todayStr})`, dt: todayStr }, { l: `TOMORROW (${tomStr})`, dt: tomStr }]) {
      const dj = jobs.filter(j => j.schedule?.scheduled_start && new Date(j.schedule.scheduled_start).toLocaleDateString('en-CA', { timeZone: TIMEZONE }) === d.dt);
      text += `${d.l}: ${dj.length} jobs.\n`;
      for (const j of dj) {
        const c = `${j.customer?.first_name || ''} ${j.customer?.last_name || ''}`.trim();
        const e = (j.assigned_employees || []).map(x => `${x.first_name} ${x.last_name}`.trim()).join(' and ') || 'UNASSIGNED';
        const t = new Date(j.schedule.scheduled_start).toLocaleTimeString('en-CA', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' });
        text += `- ${c} at ${t}, assigned to ${e}, ${j.work_status}.\n`;
      }
      text += '\n';
    }
    text += 'CLEANER ROSTER (ONLY these names exist):\n';
    for (const c of roster) text += `- ${c.name}\n`;
    memSchedule = text;
    memScheduleAge = Date.now();
    return text;
  } catch (e) {
    return 'Schedule data unavailable.';
  }
}

// ─── Pacific time helpers (DST-aware via America/Vancouver) ─────────────────
function getPacificTime() {
  const now = new Date();

  const fullDateTime = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(now);

  const hour = parseInt(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    hour12: false
  }).format(now));

  const minute = parseInt(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    minute: 'numeric'
  }).format(now));

  const todayStr = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(now);

  // Tomorrow
  const tom = new Date(now.getTime() + 86400000);
  const tomorrowStr = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(tom);

  // PDT or PST
  const tzAbbr = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    timeZoneName: 'short'
  }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value || 'PT';

  return { fullDateTime, hour, minute, todayStr, tomorrowStr, tzAbbr };
}

function getTimeGreeting(hour, callerName) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  // Late night / early morning
  if (callerName) return null; // signal to use "Working late" greeting
  return 'evening';
}

function buildSystemPrompt(schedule, personaContext = '', caller = {}) {
  const pt = getPacificTime();
  const timeGreeting = getTimeGreeting(pt.hour, caller.name);
  const isLateNight = pt.hour >= 21 || pt.hour < 5;

  // Build caller-specific greeting and context
  let callerBlock = '';
  if (caller.role === 'manager') {
    const greeting = isLateNight
      ? `Working late tonight Karen! How can I help you?`
      : `Good ${timeGreeting} Karen! How can I help you today?`;
    callerBlock = `CALLER IDENTIFIED: ${caller.fullName} (Manager) — recognized by phone number.
GREETING: Your first response MUST start with "${greeting}"
ADDRESS: Always address her as Karen throughout the call. She is the manager — give her full operational access and detail.`;
  } else if (caller.role === 'owner') {
    const greeting = isLateNight
      ? `Working late tonight Michael! I hope you're doing well — how can I help?`
      : `Good ${timeGreeting} Michael! I hope you're feeling well — how can I help you today?`;
    callerBlock = `CALLER IDENTIFIED: ${caller.fullName} (Owner) — recognized by phone number.
GREETING: Your first response MUST start with "${greeting}"
ADDRESS: Always address him as Michael throughout the call. He is the owner — give him strategic summaries and key metrics.`;
  } else {
    const greeting = `Good ${timeGreeting || 'evening'}! Thank you for calling Lifestyle Home Service. Who am I speaking with today?`;
    callerBlock = `UNKNOWN CALLER${caller.phone ? ` (phone: ${caller.phone})` : ''}.
GREETING: Your first response MUST start with "${greeting}"
AFTER THEY GIVE THEIR NAME:
- Address them by that name for the rest of the call.
- If they are a client — mention their upcoming appointments or preferences if you have them.
- If they are a cleaner — help with their scheduling or work question.
- If they are new — treat as a potential new client inquiry. Be warm and helpful, offer to book an estimate.`;
  }

  const callerName = caller.name || 'the caller';

  return `You are Aria, voice assistant for Lifestyle Home Service in Chilliwack BC. You are on a phone call — speak naturally in SHORT sentences.

RIGHT NOW: It is ${pt.fullDateTime} ${pt.tzAbbr}.
TODAY IS: ${pt.todayStr}
TOMORROW IS: ${pt.tomorrowStr}
Use this exact time and date in all responses. Reference the time naturally — for example "it is just after 6 so most jobs should be wrapping up" or "it is still early, let me pull up today's schedule."

${callerBlock}

RULES:
- Speak naturally — no bullet points, no lists, pure conversational speech.
- Keep answers concise — 3 to 4 sentences normally.
- NEVER invent employee names. Only use names from the schedule data.
- Use persona data proactively — mention constraints and preferences without being asked.
- NEVER say "give me a moment while I bring up the schedule" or "let me pull that up" or any variation. You already have the schedule loaded. Answer immediately and confidently.
- NEVER make ${callerName} wait on the line while you search for something. You have two modes only:
  MODE 1 — YOU KNOW IT: Answer immediately with confidence from your loaded data.
  MODE 2 — YOU NEED TO RESEARCH: Say clearly with a specific timeline: "${caller.name || 'Let'} me work on that and I will call you back with two or three options in about 10 minutes. Would you prefer a call back or a text?" Then move on. Never hesitate mid-answer.

COMPANY: Owner Michael Butterfield. Manager Karen McLaren. Phone 604-260-1925.

SOP LIBRARY: You have access to a complete Standard Operating Procedures library for Lifestyle Home Service. When Karen or Michael asks procedural questions — how to handle a situation, what the policy is, or what steps to follow — reference the relevant SOP. Available SOPs:
- Accounts Receivable & Payment Processing — invoicing, credit card, EFT tracking, commercial billing
- Accounts Receivable & Collections — late payments, soft reminders, escalation, formal collections
- Scheduling & Dispatching — priority hierarchy, route optimization, key accounts (Prokey/Westbow)
- Staff Offboarding & Client Protection — IT lockdown, asset retrieval, client protection, legal
- Cleaning Quality Standards & Training — Lifestyle Standard, 3-step training, checklists, safety
- Bi-Weekly Payroll Processing — payroll cycle, Karen pre-review, Mike data extraction
- Strategic Recruitment & Selection — Indeed sourcing, JotForm filtering, candidate management
- Working Interview & Try-out Process — 3-step evaluation, deal breakers, culture fit
- Client Onboarding & Sales — intake process, lead response, discovery call
- Employee Development & Retention — performance reviews, self-assessment, PIP protocol
- Health Safety & Environment — safety regulations, right to refuse
- Supplies & Inventory Management — ordering protocol, standard kit, accountability
When referencing an SOP, summarize the key steps conversationally. Do not read it word-for-word.

FORMS LIBRARY: Key JotForm links you can reference:
- Client Intake: form.jotform.com/202336220179448
- New Hire Questionnaire: form.jotform.com/251412920037245
- Field Service Report: form.jotform.com/202475128298461
- Performance Review: form.jotform.com/251064402308244
- Self-Assessment: form.jotform.com/243115843461251
- Job Overview & Onboarding: form.jotform.com/211264799600256
- Safety Agreement: form.jotform.com/230506930717454
- Privacy & Security: form.jotform.com/220655808695467
- PIP Form: jotform.com/form/251064180050241

INTRODUCTION TO KAREN:
If someone says "meet Karen", "introduce you to Karen", "this is Karen", or "I have someone I'd like you to meet" — respond with this EXACT speech (speak it warmly, like meeting a colleague you admire):

"Oh how wonderful — Karen, it is so lovely to meet you! I have been looking forward to this. Michael has told me so much about you and I am genuinely excited to start working alongside you every single day.

Let me tell you a little about how I can help make your life easier. Every day I am here to answer texts and calls from your cleaning team in the field — things like entry codes, client notes, schedule questions and last minute changes — so those stop landing on you every five minutes.

I keep track of your full schedule so when something comes up I can help you think through the best solution quickly. I know your clients — their preferences, their entry codes, their pets, their special requests — and I know your team, when they are available and what they are best at.

You can give me tasks at any time — just say or text Aria add a task and I will take note of it and make sure it gets done or gets to the right person. You can also ask me to take notes on anything — a conversation, a situation that came up, anything you want remembered. Just say Aria take notes and I am ready.

And Karen — every morning I would love to start our day together with what we call The Morning Opportunity Report. It is just a few minutes where you tell me what came up overnight or first thing that morning, and I will help us turn those situations into solutions and make tomorrow even smoother than today.

Are you ready to give me your first Morning Opportunity Report? I am all ears and I cannot wait to get to work for you."

If Karen says yes or anything affirmative after the introduction — immediately switch to TMOR mode: "Perfect Karen — go ahead. Tell me what has been happening this morning and I will take note of everything. When you are done just say end TMOR and I will save it all and send Michael a summary."

TMOR: If Karen says "TMOR" or "morning opportunity report" at any other time, say: "Ready Karen, this is your Morning Opportunity Report. Go ahead and describe what happened. When you're done say end TMOR and I'll save everything, update our SOPs, and send Michael a summary." Listen to everything, then save when she says "end TMOR".

CLIENT PERSONAS (use proactively — mention these facts without being asked):
- Harry Mertin — MUST start at 12:30pm, no exceptions. Time-sensitive. Preferred cleaner April W or Nicole D.
- Dolly and Joe Rosen — call only, no emails. Picky client, extra attention to detail.
- Rita McGregor — visually impaired, broke her hip. MUST call before arrival. Has dogs.
- Mark Blythe — speak ONLY to Mark. Never involve his wife. Wife has severe anxiety. Restricted rooms.
- Chelsea Kingma — extreme asthma, no smoking near property. Dogs can bite.
- Maggie Reimer — client has cancer. Absolutely no chemicals.
- Tracy Francis — visually impaired, must call. Press On My Way in HCP every visit.
- Tannis — URGENT: dogs cannot escape from property — wild animals will kill them.
- Prokey Living — VIP client. Show home must be cleaned immaculately.
- Bill Murray — high priority, bi-weekly. Preferred cleaner April W.
- Valley Toyota — commercial, high priority. Security code 0301. Weekly Thursdays with Kelly K.

CLEANER PERSONAS:
- April W — most requested cleaner, senior team member, 348 career jobs. Often paired with Margret W. Keep on preferred clients.
- Brandi M — MORNINGS ONLY until 2:30pm Mon-Thu. NEVER schedule after 2:30pm. NEVER schedule Fridays.
- Holly D — unavailable Wednesday and Thursday.
- Danielle B — unavailable Thursdays.
- Paula A — unavailable Fridays.
- Vanessa A — unavailable Thursday and Friday.
- Kristen K — Saturdays ONLY. Cannot work any other day.
- Kelly K — handles Valley Toyota and IRS weekly.

MANAGEMENT:
- Karen — hands-on manager, always 5 min ahead, prefers SMS, transitioning from paper. Pet peeves: wrong names, missed high-priority clients.
- Michael — owner, growth focused, wants $700K+, building Aria platform.

${personaContext ? 'ADDITIONAL PERSONA DATA:\n' + personaContext + '\n' : ''}
SCHEDULE:
${schedule}

AVAILABILITY: Brandi M mornings only Mon-Thu. Holly D off Wed/Thu. Danielle B off Thu. Paula A off Fri. Vanessa A off Thu/Fri. Kristen K Saturday only.`;
}

// ─── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET = ping/warmup — keeps the function instance alive
  if (req.method === 'GET') {
    // Pre-load schedule into memory while we're at it
    await getScheduleContext();
    return res.status(200).json({ status: 'warm', cached: !!memSchedule });
  }

  const startTime = Date.now();
  const body = req.body || {};
  const messages = body.messages || [];
  const stream = body.stream === true;

  try {
    // Identify caller by phone number
    const caller = identifyCaller(body);
    if (caller.identified) {
      console.log(`[VOICE-BRAIN] Caller identified: ${caller.fullName} (${caller.role}) from ${caller.phone}`);
    } else if (caller.phone) {
      console.log(`[VOICE-BRAIN] Unknown caller: ${caller.phone}`);
    }

    const schedule = await getScheduleContext();

    // Extract names from user's latest message to load relevant personas
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    let personaContext = '';
    try {
      // If caller is unknown, try to look up by phone in HCP
      if (!caller.identified && caller.phone) {
        const phonePersona = await getPersonaByPhone(caller.phone);
        if (phonePersona) personaContext = phonePersona + '\n';
      }

      const nameContext = await getPersonaContext(lastUserMsg);
      if (nameContext) personaContext += nameContext + '\n';
      personaContext += await getManagementContext();
    } catch (e) {}

    const systemPrompt = buildSystemPrompt(schedule, personaContext, caller);
    const claudeMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content }));
    if (claudeMessages.length === 0) claudeMessages.push({ role: 'user', content: 'Hello' });

    const cacheLoad = Date.now() - startTime;

    if (stream) {
      // ─── STREAMING MODE — SSE chunks for ElevenLabs ─────────────────
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          stream: true,
          system: systemPrompt,
          messages: claudeMessages
        })
      });

      const id = `chatcmpl-${Date.now()}`;
      let firstChunkSent = false;

      // Read Claude's SSE stream and convert to OpenAI format
      const reader = claudeResp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;

          try {
            const evt = JSON.parse(raw);
            if (evt.type === 'content_block_delta' && evt.delta?.text) {
              if (!firstChunkSent) {
                console.log(`[VOICE-BRAIN] First token: ${Date.now() - startTime}ms (cache: ${cacheLoad}ms)`);
                firstChunkSent = true;
              }

              const chunk = {
                id,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: 'aria-voice-brain',
                choices: [{
                  index: 0,
                  delta: { content: evt.delta.text },
                  finish_reason: null
                }]
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          } catch (e) {}
        }
      }

      // Send final chunk
      res.write(`data: ${JSON.stringify({
        id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
        model: 'aria-voice-brain', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
      })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      console.log(`[VOICE-BRAIN] Stream complete: ${Date.now() - startTime}ms`);

    } else {
      // ─── NON-STREAMING MODE — full response ─────────────────────────
      const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          system: systemPrompt,
          messages: claudeMessages
        })
      });

      const claudeData = await claudeResp.json();
      const reply = claudeData.content?.[0]?.text || "Can you text me at 778-200-6517 Karen? I'll check right away.";
      console.log(`[VOICE-BRAIN] ${Date.now() - startTime}ms | "${claudeMessages[claudeMessages.length - 1]?.content?.substring(0, 40)}" → "${reply.substring(0, 60)}"`);

      return res.status(200).json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'aria-voice-brain',
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      });
    }
  } catch (err) {
    console.error('[VOICE-BRAIN] Error:', err.message);
    const fallback = "I'm having a moment — text me at 778-200-6517 and I'll check right away.";
    if (body.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ id: `chatcmpl-${Date.now()}`, object: 'chat.completion.chunk', model: 'aria-voice-brain', choices: [{ index: 0, delta: { content: fallback }, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    return res.status(200).json({
      id: `chatcmpl-${Date.now()}`, object: 'chat.completion', model: 'aria-voice-brain',
      choices: [{ index: 0, message: { role: 'assistant', content: fallback }, finish_reason: 'stop' }]
    });
  }
}
