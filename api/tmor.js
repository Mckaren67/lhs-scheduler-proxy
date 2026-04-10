// TMOR — The Morning Opportunity Report
// Karen describes morning situations, Aria saves learnings,
// sends Michael a summary, checks for matching SOPs

export const config = { api: { bodyParser: true }, maxDuration: 20 };

const KAREN_PHONE = '+16048009630';
const MICHAEL_PHONE = '+16042601925';
const KB = 'https://lhs-knowledge-base.vercel.app/api/save';
const TIMEZONE = 'America/Vancouver';

async function kbWrite(key, val) {
  await fetch(KB, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value: val }) });
}

async function kbRead(key) {
  try { const r = await fetch(`${KB}?key=${key}`); const d = await r.json(); return d.value; }
  catch (e) { return null; }
}

async function sendSMS(to, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_PHONE_NUMBER;
  const toPhone = to.startsWith('+') ? to : `+1${to}`;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST', headers: { 'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: toPhone, From: from, Body: message }).toString()
  });
}

export async function saveTMOR({ description, adminPhone }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  const dayName = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE, weekday: 'long', month: 'long', day: 'numeric' });

  // Send to Claude for analysis
  const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: `You are analyzing a Morning Opportunity Report from Karen, manager of Lifestyle Home Service (cleaning company, Chilliwack BC). Extract structured learnings.

For each situation Karen describes, identify:
1. CATEGORY: staff | client | scheduling | supply | quality | safety | hiring | admin
2. ISSUE: one sentence summary
3. OPPORTUNITY: what can be improved or automated
4. RECOMMENDED IMPROVEMENT: specific actionable step

Format as numbered items. Maximum 5 items. Be concise.`,
      messages: [{ role: 'user', content: `Karen's morning report for ${dayName}:\n\n${description}` }]
    })
  });

  const analysis = (await claudeResp.json()).content?.[0]?.text || 'Analysis unavailable.';

  // Save to KB log
  const log = (await kbRead('aria_tmor_log')) || [];
  const entry = {
    id: `tmor_${Date.now().toString(36)}`,
    date: today,
    dayName,
    description,
    analysis,
    timestamp: new Date().toISOString()
  };
  log.push(entry);
  await kbWrite('aria_tmor_log', log);

  // Send Michael summary
  const michaelMsg = `🌅 TMOR — Morning Opportunity Report ${dayName}\n\nKaren reported:\n${analysis.substring(0, 600)}\n\nSaved to knowledge base. Will inform tomorrow's proactive briefing. — Aria 🏠`;
  await sendSMS(MICHAEL_PHONE, michaelMsg);

  // Check for matching SOPs
  const sopIndex = await kbRead('aria_sop_index');
  let sopMatch = '';
  if (sopIndex?.sops) {
    const descLower = description.toLowerCase();
    if (descLower.includes('last day') || descLower.includes('offboard') || descLower.includes('leaving')) {
      sopMatch = 'I noticed this might relate to our Employee Offboarding SOP. Want me to initiate that workflow?';
    } else if (descLower.includes('sick') || descLower.includes('called in')) {
      sopMatch = 'This sounds like a sick day situation. Want me to run the sick day cascade?';
    } else if (descLower.includes('complaint') || descLower.includes('quality')) {
      sopMatch = 'This might need our Quality Control process. Want me to log a quality issue?';
    }
  }

  return { ok: true, entry, analysis, sopMatch, michaelNotified: true };
}

// HTTP handler for direct testing
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  if (!process.env.INTERNAL_SECRET || authHeader !== `Bearer ${process.env.INTERNAL_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { description } = req.body || {};
  if (!description) return res.status(400).json({ error: 'Missing description' });

  const result = await saveTMOR({ description, adminPhone: KAREN_PHONE });
  return res.status(200).json(result);
}
