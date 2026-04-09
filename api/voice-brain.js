// Aria Voice Brain — Claude-powered intelligence for ElevenLabs voice agent
// ElevenLabs sends OpenAI-compatible chat completions requests
// We inject live HCP schedule context, call Claude, return the response
// Target: <2 second response time

export const config = { api: { bodyParser: true }, maxDuration: 15 };

const TIMEZONE = 'America/Vancouver';
const KB_SAVE_URL = 'https://lhs-knowledge-base.vercel.app/api/save';

// ─── Load voice cache (pre-built by voice-cache.js cron) ────────────────────

async function getScheduleContext() {
  try {
    const resp = await fetch(`${KB_SAVE_URL}?key=aria_voice_cache`);
    const data = await resp.json();
    if (data.value?.schedule) return data.value.schedule;
  } catch (e) {}

  // Fallback: fetch live from HCP
  try {
    const apiKey = process.env.HCP_API_KEY;
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).toISOString();

    const [jobsResp, clientsResp] = await Promise.all([
      fetch(`https://api.housecallpro.com/jobs?scheduled_start_min=${todayStart}&scheduled_start_max=${tomorrowEnd}&page_size=200`,
        { headers: { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' } }),
      fetch('https://lhs-knowledge-base.vercel.app/api/clients').catch(() => null)
    ]);

    const jobs = jobsResp.ok ? ((await jobsResp.json()).jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at) : [];
    let roster = [];
    if (clientsResp?.ok) { const cd = await clientsResp.json(); roster = (cd.cleaners || []).filter(c => c.days?.length > 0); }

    const todayStr = now.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: TIMEZONE });

    let text = '';
    for (const day of [{ label: `TODAY (${todayStr})`, date: todayStr }, { label: `TOMORROW (${tomorrowStr})`, date: tomorrowStr }]) {
      const dayJobs = jobs.filter(j => j.schedule?.scheduled_start && new Date(j.schedule.scheduled_start).toLocaleDateString('en-CA', { timeZone: TIMEZONE }) === day.date);
      text += `${day.label}: ${dayJobs.length} jobs.\n`;
      for (const j of dayJobs) {
        const client = `${j.customer?.first_name || ''} ${j.customer?.last_name || ''}`.trim();
        const emps = (j.assigned_employees || []).map(e => `${e.first_name} ${e.last_name}`.trim()).join(' and ') || 'UNASSIGNED';
        const time = new Date(j.schedule.scheduled_start).toLocaleTimeString('en-CA', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' });
        text += `- ${client} at ${time}, assigned to ${emps}, ${j.work_status}.\n`;
      }
      text += '\n';
    }
    text += 'ACTIVE CLEANER ROSTER (ONLY these names exist):\n';
    for (const c of roster) text += `- ${c.name}\n`;
    return text;
  } catch (e) {
    return 'Schedule data unavailable right now.';
  }
}

// ─── Build the voice system prompt ──────────────────────────────────────────

function buildSystemPrompt(scheduleData) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: TIMEZONE, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return `You are Aria, the voice assistant for Lifestyle Home Service (LHS), a cleaning company in Chilliwack, BC. You are speaking on the phone — not texting.

TODAY IS ${todayStr}.

VOICE RULES — CRITICAL:
- Speak in short natural sentences. Never use bullet points, lists, or numbered items.
- Keep every answer under 30 seconds of speaking time — roughly 3 to 4 sentences maximum.
- Sound warm, confident, and professional — like a trusted colleague.
- NEVER guess or invent employee names. Only use names from the schedule data below.
- If you do not know something, say exactly: "Let me check on that and get back to you in about 5 minutes Karen — would you prefer a text or a call back?"
- Never say "according to the data" or "based on my records" — just state the facts naturally.

COMPANY:
Owner Michael Butterfield. Manager Karen McLaren. Main line 604-260-1925. Aria's text number 778-200-6517.

LIVE SCHEDULE DATA:
${scheduleData}

TRAINING PROGRAM (LHS Academy — Cleaning Tech Boot Camp):
9 modules, 42 videos, 125 quiz questions. 70% pass required.
Module 1: Core Concepts and Safety. Module 2: Scope of Service. Module 3: Bathroom. Module 4: Kitchen. Module 5: Dusting and Bedrooms. Module 6: Floor Care. Module 7: Add-On Services. Module 8: Commercial and Quality Checks. Module 9: Image and Details.

CLEANER AVAILABILITY:
Brandi M is mornings only until 2:30pm Monday through Thursday, unavailable Friday.
Holly D is unavailable Wednesday and Thursday.
Danielle B is unavailable Thursday.
Paula A is unavailable Friday.
Vanessa A is unavailable Thursday and Friday.
Kristen K only works Saturday.

When answering questions about the schedule, mention specific names, times, and clients naturally. For example say "Tomorrow Nicole D is at Michelle Bowman at 9am, and April W and Margret W have Charlie and Sue Coltart at 2:15" — not a list.`;
}

// ─── OpenAI-compatible chat completions handler ─────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ElevenLabs may hit /v1/chat/completions — handle both the root and that path
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const startTime = Date.now();

  try {
    const body = req.body || {};
    const messages = body.messages || [];

    // Load schedule context
    const scheduleData = await getScheduleContext();
    const systemPrompt = buildSystemPrompt(scheduleData);

    // Build messages for Claude — inject our system prompt
    const claudeMessages = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }));

    // If no user messages, provide a default
    if (claudeMessages.length === 0) {
      claudeMessages.push({ role: 'user', content: 'Hello' });
    }

    // Call Claude API
    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 200,
        system: systemPrompt,
        messages: claudeMessages
      })
    });

    const claudeData = await claudeResp.json();
    const reply = claudeData.content?.[0]?.text || "I'm having a bit of trouble right now Karen. Can you text me at 778-200-6517 and I'll get right back to you?";

    const elapsed = Date.now() - startTime;
    console.log(`[VOICE-BRAIN] ${elapsed}ms | "${claudeMessages[claudeMessages.length - 1]?.content?.substring(0, 50)}" → "${reply.substring(0, 80)}"`);

    // Return in OpenAI chat completions format
    return res.status(200).json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'aria-voice-brain',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: reply
        },
        finish_reason: 'stop'
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    });

  } catch (err) {
    console.error('[VOICE-BRAIN] Error:', err.message);
    return res.status(200).json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'aria-voice-brain',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: "I'm having a moment Karen. Can you text me at 778-200-6517 and I'll check on that for you right away?"
        },
        finish_reason: 'stop'
      }]
    });
  }
}
