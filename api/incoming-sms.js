// Aria SMS Router — thin orchestrator for incoming SMS
// Delegates to modular handlers for all features
// Refactored from 1,812 lines to ~250 lines — Phase 6

export const config = { api: { bodyParser: true }, maxDuration: 60 };

// ─── Shared utilities ────────────────────────────────────────────────────────
import { getPacificDateTime } from './_modules/shared/time.js';

// ─── Schedule modules ────────────────────────────────────────────────────────
import { fetchTodaysJobs, parseDateFromMessage, fetchJobsForDate } from './_modules/schedule/fetch.js';
import { getCachedPatterns } from './_modules/schedule/patterns.js';
import { fetchClientPreferences, buildScheduleContext } from './_modules/schedule/context.js';
import { formatDateFriendly } from './_modules/shared/time.js';

// ─── Prompt builder ──────────────────────────────────────────────────────────
import { buildSystemPrompt } from './_modules/prompt/builder.js';

// ─── Tool registry + all definitions (import triggers registration) ──────────
import { getToolDefinitions, getToolHandler } from './_modules/tools/registry.js';
import './_modules/tools/definitions/scheduling.js';
import './_modules/tools/definitions/tasks.js';
import './_modules/tools/definitions/operations.js';
import './_modules/tools/definitions/communication.js';
import './_modules/tools/definitions/notes.js';

// ─── Handler imports (import triggers handler wiring into registry) ──────────
import './_modules/tools/handlers/scheduling.js';
import './_modules/tools/handlers/tasks.js';
import './_modules/tools/handlers/operations.js';
import './_modules/tools/handlers/communication.js';
import './_modules/tools/handlers/notes.js';

// ─── Memory (conversation history + caller context) ──────────────────────────
import { saveConversation, buildCallerContext } from './aria-memory.js';

// ─── Multi-turn conversation memory ─────────────────────────────────────────
const conversationStore = new Map();
const CONVERSATION_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours
const MAX_HISTORY = 10;

function getConversation(phone) {
  const now = Date.now();
  const conv = conversationStore.get(phone);
  if (!conv || (now - conv.lastActivity) > CONVERSATION_TIMEOUT) {
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
  if (conv.messages.length > MAX_HISTORY) {
    conv.messages = conv.messages.slice(-MAX_HISTORY);
  }
  conv.lastActivity = Date.now();
}

// ─── Escape XML for TwiML ───────────────────────────────────────────────────
function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── SMS conversation context memory (5 minute TTL via Redis) ───────────────
const KB_SAVE_URL = 'https://lhs-knowledge-base.vercel.app/api/save';

async function getSmsContext(phone) {
  try {
    const key = 'sms_context_' + phone.replace(/\D/g, '').slice(-10);
    const r = await fetch(`${KB_SAVE_URL}?key=${key}`);
    const d = await r.json();
    if (!d.value) return null;
    // Check TTL — 5 minutes
    if (d.value.createdAt && (Date.now() - new Date(d.value.createdAt).getTime()) > 300000) return null;
    return d.value;
  } catch { return null; }
}

async function setSmsContext(phone, context) {
  try {
    const key = 'sms_context_' + phone.replace(/\D/g, '').slice(-10);
    await fetch(KB_SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: { ...context, createdAt: new Date().toISOString() } }) });
  } catch (e) { console.error('[CONTEXT] Save failed:', e.message); }
}

async function clearSmsContext(phone) {
  try {
    const key = 'sms_context_' + phone.replace(/\D/g, '').slice(-10);
    await fetch(KB_SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: null }) });
  } catch {}
}

function mapAssigneeName(text, senderPhone) {
  const t = (text || '').trim().toLowerCase();
  if (t === 'michael' || t === 'mike') return 'michael';
  if (t === 'karen') return 'karen';
  if (t === 'aria') return 'aria';
  if (t === 'claude') return 'claude';
  if (t === 'me') {
    const digits = senderPhone.replace(/\D/g, '');
    if (digits.includes('6048009630')) return 'karen';
    if (digits.includes('6042601925')) return 'michael';
    return 'karen';
  }
  if (t === 'you') return 'aria';
  return null;
}

// ─── Main handler ───────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const body = req.body || {};
  const from = body.From || '';
  const incomingMessage = body.Body || '';

  // ─── Admin detection ────────────────────────────────────────────────────
  const ADMIN_PHONES = (process.env.ADMIN_PHONE_NUMBERS || '6048009630')
    .split(',').map(p => p.trim().replace(/\D/g, ''));
  const senderDigits = from.replace(/\D/g, '');
  const isAdmin = ADMIN_PHONES.some(p => senderDigits.includes(p) || p.includes(senderDigits));

  console.log(`[ARIA] Incoming SMS from ${from} (admin: ${isAdmin}): "${incomingMessage}"`);

  // ─── Check conversation context first ──────────────────────────────────
  try {
    const ctx = await getSmsContext(from);
    if (ctx?.awaitingResponse === 'assignee' && ctx.taskId) {
      const assignee = mapAssigneeName(incomingMessage, from);
      if (assignee) {
        const { updateTask } = await import('./_task-client.js');
        await updateTask(ctx.taskId, { assigned_to: assignee });
        await clearSmsContext(from);
        const reply = `Done — "${ctx.taskTitle}" assigned to ${assignee[0].toUpperCase() + assignee.slice(1)}. — LHS`;
        res.setHeader('Content-Type', 'text/xml');
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Message>${escapeXml(reply)}</Message>\n</Response>`);
      }
    }
  } catch (e) { console.error('[CONTEXT] Check failed:', e.message); }

  // ─── Fetch data in parallel ─────────────────────────────────────────────
  const requestedDate = parseDateFromMessage(incomingMessage);
  const todayDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
  const isSpecificDateRequest = requestedDate && requestedDate !== todayDate;

  const fetchPromises = [fetchTodaysJobs(), fetchClientPreferences()];
  if (isSpecificDateRequest) fetchPromises.push(fetchJobsForDate(requestedDate));

  const [hcpResult, clientData, specificDateResult] = await Promise.all(fetchPromises);
  const patterns = getCachedPatterns();
  let scheduleContext = buildScheduleContext({ ...hcpResult, patterns }, clientData);

  if (specificDateResult) {
    const friendly = formatDateFriendly(requestedDate);
    scheduleContext = `\n*** SPECIFICALLY REQUESTED DATE — ${friendly} ***\nKaren asked about this specific date. Answer with ONLY this day's data:\n${specificDateResult.schedule}\n*** END OF REQUESTED DATE ***\n\n${scheduleContext}`;
    console.log(`[ARIA] Specific date requested: ${requestedDate} — ${specificDateResult.jobs.length} jobs found`);
  }

  // ─── Caller memory ──────────────────────────────────────────────────────
  let callerContext = '';
  try { callerContext = await buildCallerContext(from); }
  catch (err) { console.error('[ARIA] Memory context failed:', err.message); }

  console.log(`[ARIA] Context built — HCP today: ${hcpResult.jobs.length}, KB clients: ${clientData.clients.length}, patterns cached: ${patterns ? 'yes' : 'no'}, memory: ${callerContext ? 'yes' : 'no'}`);

  // ─── Build system prompt ────────────────────────────────────────────────
  const pt = getPacificDateTime();
  const ARIA_SYSTEM_PROMPT = buildSystemPrompt({
    pacificDateTime: pt.dateTime,
    pacificTzAbbr: pt.tzAbbr,
    tomorrowDate: pt.tomorrowDate,
    callerContext,
    scheduleContext,
    isAdmin
  });

  try {
    // ─── Conversation history ───────────────────────────────────────────
    const conv = getConversation(from);
    addToConversation(from, 'user', `Incoming SMS from ${from}: "${incomingMessage}"`);
    const messages = conv.messages.length > 0
      ? conv.messages
      : [{ role: 'user', content: `Incoming SMS from ${from}: "${incomingMessage}"` }];

    // ─── Claude API call ────────────────────────────────────────────────
    const tools = isAdmin ? getToolDefinitions() : [];
    const claudeBody = {
      model: 'claude-sonnet-4-5',
      max_tokens: 400,
      system: ARIA_SYSTEM_PROMPT,
      messages
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

    // ─── Tool dispatch via registry ─────────────────────────────────────
    const toolUse = claudeData.content?.find(b => b.type === 'tool_use');
    const textBlock = claudeData.content?.find(b => b.type === 'text');
    let twimlReply;

    if (toolUse) {
      const toolHandler = getToolHandler(toolUse.name);
      if (toolHandler) {
        console.log(`[ARIA] Tool: ${toolUse.name}`);
        const ctx = { from, incomingMessage, isAdmin };
        twimlReply = await toolHandler(toolUse.input, ctx);
      } else {
        console.warn(`[ARIA] No handler for tool: ${toolUse.name}`);
        twimlReply = textBlock?.text || "I tried to handle that but ran into an issue. Please try again! — LHS 🏠";
      }
    } else {
      twimlReply = textBlock?.text || claudeData.content?.[0]?.text ||
        "Hi! Thanks for your message. I'll get back to you shortly. For urgent matters please call 604-260-1925. — LHS 🏠";
    }

    // ─── Response ───────────────────────────────────────────────────────
    addToConversation(from, 'assistant', twimlReply);

    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(twimlReply)}</Message>
</Response>`);

    // Aria self-logging (non-blocking)
    try {
      const { logAriaAction } = await import('./_task-client.js');
      const cat = toolUse ? (toolUse.name.includes('schedule') ? 'scheduling' : toolUse.name.includes('task') ? 'admin' : 'communications') : 'communications';
      const saved = toolUse ? 5 : 3;
      logAriaAction({ description: `Answered SMS: "${incomingMessage.substring(0, 60)}"`, category: cat, time_saved_minutes: saved, source_message: `SMS from ${from}` }).catch(() => {});
    } catch {}

    // Save conversation summary (non-blocking)
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
