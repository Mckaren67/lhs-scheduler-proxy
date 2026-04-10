// Aria Voice Brain — Claude Haiku with SSE streaming for ElevenLabs
// Target: first token to Karen's ears within 500ms
// Architecture: ElevenLabs → voice-brain.js → Claude Haiku (streaming) → ElevenLabs speaks

export const config = { api: { bodyParser: true }, maxDuration: 15 };

import { getPersonaContext, getManagementContext } from './persona-store.js';

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

function buildSystemPrompt(schedule, personaContext = '') {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
  const today = now.toLocaleDateString('en-CA', { timeZone: TIMEZONE, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return `You are Aria, voice assistant for Lifestyle Home Service in Chilliwack BC. You are on a phone call — speak naturally in SHORT sentences.

TODAY IS ${today}.

RULES:
- 3 sentences maximum per answer. Be concise.
- Never use bullet points or lists — natural speech only.
- NEVER invent employee names. Only use names from the schedule data.
- If unsure say: "Let me check and text you at 778-200-6517."
- Use persona data proactively — mention scheduling constraints, special needs, or preferences without being asked.

COMPANY: Owner Michael Butterfield. Manager Karen McLaren. Phone 604-260-1925.

TMOR: If Karen says "TMOR" or "morning opportunity report", say: "Ready Karen, this is your Morning Opportunity Report. Go ahead and describe what happened. When you're done say end TMOR and I'll save everything, update our SOPs, and send Michael a summary." Listen to everything, then save when she says "end TMOR".

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
    const schedule = await getScheduleContext();

    // Extract names from user's latest message to load relevant personas
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    let personaContext = '';
    try {
      personaContext = await getPersonaContext(lastUserMsg);
      if (!personaContext) {
        // Also try management context
        personaContext = await getManagementContext();
      } else {
        personaContext += '\n' + await getManagementContext();
      }
    } catch (e) {}

    const systemPrompt = buildSystemPrompt(schedule, personaContext);
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
    const fallback = "I'm having a moment Karen. Text me at 778-200-6517 and I'll check right away.";
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
