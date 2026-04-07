// Aria's persistent learning memory — conversation summaries, new facts, pattern observations
// Stored in lhs-knowledge-base save.js, keyed by type

export const config = { api: { bodyParser: true } };

const KB_SAVE_URL = 'https://lhs-knowledge-base.vercel.app/api/save';
const TIMEZONE = 'America/Vancouver';

const KEYS = {
  conversations: 'aria_memory_conversations',
  learnings: 'aria_memory_learnings',
  patterns: 'aria_memory_patterns'
};

// ─── KB read/write ──────────────────────────────────────────────────────────

async function kbRead(key) {
  try {
    const res = await fetch(`${KB_SAVE_URL}?key=${key}`);
    const data = await res.json();
    return data.value || [];
  } catch (err) {
    console.error(`[MEMORY] Read failed for ${key}:`, err.message);
    return [];
  }
}

async function kbWrite(key, value) {
  try {
    await fetch(KB_SAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value })
    });
  } catch (err) {
    console.error(`[MEMORY] Write failed for ${key}:`, err.message);
  }
}

// ─── Conversation summaries ─────────────────────────────────────────────────

export async function saveConversation({ phone, contactName, channel, summary, actionTaken, outcome }) {
  const conversations = await kbRead(KEYS.conversations);
  const entry = {
    id: `conv_${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    date: new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE }),
    phone,
    contactName: contactName || phone,
    channel: channel || 'sms',
    summary,
    actionTaken: actionTaken || null,
    outcome: outcome || null
  };
  conversations.push(entry);
  // Keep last 200 conversations
  const trimmed = conversations.slice(-200);
  await kbWrite(KEYS.conversations, trimmed);
  console.log(`[MEMORY] Saved conversation: ${contactName || phone} — ${summary.substring(0, 60)}`);
  return entry;
}

export async function getCallerHistory(phone, limit = 10) {
  const conversations = await kbRead(KEYS.conversations);
  const digits = phone.replace(/\D/g, '');
  const matches = conversations.filter(c => {
    const cDigits = (c.phone || '').replace(/\D/g, '');
    return cDigits.includes(digits) || digits.includes(cDigits);
  });
  return matches.slice(-limit);
}

export async function getRecentConversations(limit = 20) {
  const conversations = await kbRead(KEYS.conversations);
  return conversations.slice(-limit);
}

// ─── Learning entries — new facts about clients, cleaners, business ─────────

export async function saveLearning({ subject, category, fact, source, confidence }) {
  const learnings = await kbRead(KEYS.learnings);
  const entry = {
    id: `learn_${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    date: new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE }),
    subject,
    category: category || 'general',
    fact,
    source: source || 'conversation',
    confidence: confidence || 'high'
  };
  learnings.push(entry);
  const trimmed = learnings.slice(-500);
  await kbWrite(KEYS.learnings, trimmed);
  console.log(`[MEMORY] Learned: ${subject} — ${fact.substring(0, 60)}`);
  return entry;
}

export async function searchLearnings(query, limit = 10) {
  const learnings = await kbRead(KEYS.learnings);
  const q = query.toLowerCase();
  return learnings
    .filter(l => `${l.subject} ${l.fact} ${l.category}`.toLowerCase().includes(q))
    .slice(-limit);
}

export async function getSubjectLearnings(subject, limit = 10) {
  const learnings = await kbRead(KEYS.learnings);
  const q = subject.toLowerCase();
  return learnings
    .filter(l => l.subject.toLowerCase().includes(q))
    .slice(-limit);
}

// ─── Pattern observations ───────────────────────────────────────────────────

export async function savePattern({ pattern, evidence, recommendation }) {
  const patterns = await kbRead(KEYS.patterns);
  const entry = {
    id: `pat_${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    date: new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE }),
    pattern,
    evidence,
    recommendation: recommendation || null
  };
  patterns.push(entry);
  const trimmed = patterns.slice(-100);
  await kbWrite(KEYS.patterns, trimmed);
  console.log(`[MEMORY] Pattern: ${pattern.substring(0, 60)}`);
  return entry;
}

export async function getRecentPatterns(limit = 10) {
  const patterns = await kbRead(KEYS.patterns);
  return patterns.slice(-limit);
}

// ─── Build context for a caller — used before conversations ─────────────────

export async function buildCallerContext(phone) {
  const [history, learnings] = await Promise.all([
    getCallerHistory(phone, 5),
    kbRead(KEYS.learnings)
  ]);

  let context = '';

  if (history.length > 0) {
    context += 'RECENT CONVERSATIONS WITH THIS CALLER:\n';
    for (const c of history) {
      context += `  ${c.date}: ${c.summary}`;
      if (c.actionTaken) context += ` → Action: ${c.actionTaken}`;
      if (c.outcome) context += ` → Outcome: ${c.outcome}`;
      context += '\n';
    }
  }

  // Find learnings related to this caller's name
  const callerLearnings = history.length > 0
    ? learnings.filter(l => {
        const name = (history[0].contactName || '').toLowerCase();
        return name && l.subject.toLowerCase().includes(name.split(' ')[0].toLowerCase());
      }).slice(-5)
    : [];

  if (callerLearnings.length > 0) {
    context += '\nTHINGS ARIA HAS LEARNED ABOUT THIS PERSON:\n';
    for (const l of callerLearnings) {
      context += `  ${l.date}: ${l.fact}\n`;
    }
  }

  return context;
}

// ─── HTTP handler for direct access / voice agent tools ─────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  if (!process.env.INTERNAL_SECRET || authHeader !== `Bearer ${process.env.INTERNAL_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { action } = req.query;

  try {
    if (req.method === 'POST') {
      if (action === 'conversation') {
        const entry = await saveConversation(req.body);
        return res.status(201).json(entry);
      }
      if (action === 'learning') {
        const entry = await saveLearning(req.body);
        return res.status(201).json(entry);
      }
      if (action === 'pattern') {
        const entry = await savePattern(req.body);
        return res.status(201).json(entry);
      }
    }

    if (req.method === 'GET') {
      if (action === 'history') {
        const history = await getCallerHistory(req.query.phone || '', parseInt(req.query.limit) || 10);
        return res.status(200).json({ total: history.length, history });
      }
      if (action === 'learnings') {
        const results = req.query.subject
          ? await getSubjectLearnings(req.query.subject)
          : await searchLearnings(req.query.q || '', parseInt(req.query.limit) || 10);
        return res.status(200).json({ total: results.length, learnings: results });
      }
      if (action === 'patterns') {
        const patterns = await getRecentPatterns(parseInt(req.query.limit) || 10);
        return res.status(200).json({ total: patterns.length, patterns });
      }
      if (action === 'context') {
        const context = await buildCallerContext(req.query.phone || '');
        return res.status(200).json({ context });
      }
      if (action === 'recent') {
        const convos = await getRecentConversations(parseInt(req.query.limit) || 20);
        return res.status(200).json({ total: convos.length, conversations: convos });
      }
    }

    return res.status(400).json({
      error: 'Unknown action',
      usage: 'POST: ?action=conversation|learning|pattern. GET: ?action=history&phone=X|learnings&q=X|patterns|context&phone=X|recent'
    });
  } catch (err) {
    console.error('[MEMORY] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
