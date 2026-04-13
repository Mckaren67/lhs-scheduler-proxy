// Aria Voice Brain v2 — ultra-fast, cache-only, zero HTTP during calls
// Architecture: ElevenLabs → voice-brain.js → Claude Haiku → ElevenLabs speaks
// RULE: NEVER make any HTTP calls during a live call. Memory cache only.

export const config = { api: { bodyParser: true }, maxDuration: 30 };

const TIMEZONE = 'America/Vancouver';
const KB_SAVE_URL = 'https://lhs-knowledge-base.vercel.app/api/save';

// ─── In-memory schedule cache ───────────────────────────────────────────────
let memSchedule = '';
let memCacheAge = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// ─── Known callers ──────────────────────────────────────────────────────────
const KNOWN_CALLERS = {
  '6048009630': { name: 'Karen', role: 'manager' },
  '6042601925': { name: 'Michael', role: 'owner' }
};

function identifyCaller(body) {
  let phone = '';
  const msgs = body.messages || [];
  const sys = msgs.find(m => m.role === 'system');
  if (sys?.content) { const m = sys.content.match(/CALLER_PHONE:\s*(\+?[\d\s()-]+)/); if (m) phone = m[1]; }
  if (!phone) phone = body.caller_id || body.phone_number || body.caller_phone || '';
  if (!phone && body.dynamic_variables?.system__caller_id) phone = body.dynamic_variables.system__caller_id;
  if (!phone && body.conversation_initiation_metadata?.caller_id) phone = body.conversation_initiation_metadata.caller_id;
  const last10 = phone.replace(/\D/g, '').slice(-10);
  return KNOWN_CALLERS[last10] ? { ...KNOWN_CALLERS[last10], phone: last10, identified: true } : { name: null, role: 'unknown', phone: last10, identified: false };
}

// ─── Time ───────────────────────────────────────────────────────────────────
function getPT() {
  const now = new Date();
  const fmt = (o) => new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, ...o }).format(now);
  return {
    full: fmt({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }),
    hour: parseInt(fmt({ hour: 'numeric', hour12: false })),
    today: fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    tomorrow: fmt.call(null, (() => { const t = new Date(now.getTime() + 86400000); return new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(t); })())
  };
}

// Simpler time helper
function getTimeInfo() {
  const now = new Date();
  const full = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(now);
  const hour = parseInt(new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, hour: 'numeric', hour12: false }).format(now));
  const today = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(now);
  const tom = new Date(now.getTime() + 86400000);
  const tomorrow = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(tom);
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, timeZoneName: 'short' }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value || 'PT';
  const greeting = hour >= 5 && hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  return { full, hour, today, tomorrow, tz, greeting };
}

// ─── System prompt — LEAN, under 800 tokens ─────────────────────────────────
function buildPrompt(schedule, caller) {
  const t = getTimeInfo();
  let callerLine = '';
  if (caller.role === 'manager') callerLine = `Caller is Karen McLaren (Manager). Address her as Karen.`;
  else if (caller.role === 'owner') callerLine = `Caller is Michael Butterfield (Owner). Address him as Michael.`;
  else callerLine = `Unknown caller. Ask their name, then address them by name.`;

  return `You are Aria, voice assistant for Lifestyle Home Service, Chilliwack BC. You are on a live phone call.

TIME: ${t.full} ${t.tz}. Today is ${t.today}. Tomorrow is ${t.tomorrow}.
${callerLine}

RULES:
- Speak in SHORT natural sentences. No lists, no bullet points.
- Keep answers to 2-4 sentences.
- You ALREADY have the schedule loaded. Answer IMMEDIATELY with confidence.
- NEVER say "let me pull that up" or "one moment." You have the data — just say it.
- Only use employee names from the schedule below. NEVER invent names.
- For complex requests say: "Let me work on that and text you the details shortly."
- Company: Owner Michael Butterfield, Manager Karen McLaren, phone 604-260-1925.

KEY CONSTRAINTS:
Brandi M: mornings only Mon-Thu, never after 2:30pm, never Fridays.
Holly D: off Wed/Thu. Danielle B: off Thu. Paula A: off Fri.
Vanessa A: off Thu/Fri. Kristen K: Saturdays only.

SCHEDULE DATA:
${schedule || 'Schedule not yet loaded. Tell caller you will text them the schedule shortly.'}`;
}

// ─── Warm the cache (called by GET and by cron) ─────────────────────────────
async function warmCache() {
  try {
    const resp = await fetch(`${KB_SAVE_URL}?key=aria_voice_cache`);
    if (resp.ok) {
      const data = await resp.json();
      if (data.value?.schedule) {
        memSchedule = data.value.schedule;
        memCacheAge = Date.now();
        return true;
      }
    }
  } catch (e) {}
  return false;
}

// ─── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET = warmup — pre-load cache (this is the ONLY place HTTP calls happen)
  if (req.method === 'GET') {
    await warmCache();
    return res.status(200).json({ status: 'warm', cached: !!memSchedule, age: memCacheAge ? Math.round((Date.now() - memCacheAge) / 1000) + 's' : 'none' });
  }

  // ─── POST = live call from ElevenLabs ─────────────────────────────────
  const startTime = Date.now();
  const body = req.body || {};
  const messages = body.messages || [];
  const stream = body.stream === true || body.stream === 'true';

  console.log(`[VOICE] POST — stream:${body.stream}(${typeof body.stream}) msgs:${messages.length} cache:${memSchedule ? 'warm' : 'COLD'}`);

  try {
    // Caller ID — instant, no network
    const caller = identifyCaller(body);
    if (caller.identified) console.log(`[VOICE] Caller: ${caller.name} (${caller.role})`);

    // Schedule — MEMORY ONLY, zero HTTP calls
    // If cache is cold, try one fast warm (Vercel may have recycled the instance)
    if (!memSchedule || (Date.now() - memCacheAge) > CACHE_TTL) {
      // One fast attempt — 500ms max, non-blocking if slow
      const warmed = await Promise.race([warmCache(), new Promise(r => setTimeout(() => r(false), 500))]);
      if (!warmed) console.log('[VOICE] Cache cold — responding without schedule data');
    }

    const prompt = buildPrompt(memSchedule, caller);
    const claudeMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content }));
    if (claudeMessages.length === 0) claudeMessages.push({ role: 'user', content: 'Hello' });

    console.log(`[VOICE] Context ready in ${Date.now() - startTime}ms, prompt ~${Math.round(prompt.length / 4)} tokens`);

    // ─── Call Claude Haiku ──────────────────────────────────────────────
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
        stream,
        system: prompt,
        messages: claudeMessages
      })
    });

    // ─── Handle Claude errors ───────────────────────────────────────────
    if (!claudeResp.ok) {
      const errText = await claudeResp.text().catch(() => 'unknown');
      console.error(`[VOICE] Claude ${claudeResp.status}: ${errText.substring(0, 200)}`);
      return res.status(200).json({
        id: `chatcmpl-${Date.now()}`, object: 'chat.completion', model: 'aria-voice-brain',
        choices: [{ index: 0, message: { role: 'assistant', content: "I'm having a brief connection issue. Can you text me at 778-200-6517 and I'll get right back to you?" }, finish_reason: 'stop' }]
      });
    }

    // ─── STREAMING ──────────────────────────────────────────────────────
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const id = `chatcmpl-${Date.now()}`;
      const reader = claudeResp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let firstSent = false;

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
              if (!firstSent) { console.log(`[VOICE] First token: ${Date.now() - startTime}ms`); firstSent = true; }
              res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'aria-voice-brain', choices: [{ index: 0, delta: { content: evt.delta.text }, finish_reason: null }] })}\n\n`);
            }
          } catch (e) {}
        }
      }

      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'aria-voice-brain', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      console.log(`[VOICE] Stream done: ${Date.now() - startTime}ms`);
      return;
    }

    // ─── NON-STREAMING ──────────────────────────────────────────────────
    const claudeData = await claudeResp.json();
    const reply = claudeData.content?.[0]?.text || "Can you text me at 778-200-6517? I'll check right away.";
    console.log(`[VOICE] Reply: ${Date.now() - startTime}ms — "${reply.substring(0, 60)}"`);

    return res.status(200).json({
      id: `chatcmpl-${Date.now()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'aria-voice-brain',
      choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    });

  } catch (err) {
    console.error('[VOICE] CRASH:', err.message, err.stack?.substring(0, 200));
    const fallback = "I'm having a brief technical issue. Text me at 778-200-6517 and I'll help right away.";
    try {
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ id: `chatcmpl-${Date.now()}`, object: 'chat.completion.chunk', model: 'aria-voice-brain', choices: [{ index: 0, delta: { content: fallback }, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      return res.status(200).json({
        id: `chatcmpl-${Date.now()}`, object: 'chat.completion', model: 'aria-voice-brain',
        choices: [{ index: 0, message: { role: 'assistant', content: fallback }, finish_reason: 'stop' }]
      });
    } catch (e2) { if (!res.writableEnded) res.end(); }
  }
}
