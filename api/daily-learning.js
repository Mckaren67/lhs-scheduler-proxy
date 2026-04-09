// Daily Learning Review — runs at 7pm PT (2am UTC)
// Collects day's interactions, sends to Claude for analysis,
// texts Karen/Michael for approval, saves approved learnings

export const config = { api: { bodyParser: true }, maxDuration: 30 };

const KAREN_PHONE = '+16048009630';
const TIMEZONE = 'America/Vancouver';
const KB = 'https://lhs-knowledge-base.vercel.app/api/save';

async function kbRead(key) {
  try { const r = await fetch(`${KB}?key=${key}`); const d = await r.json(); return d.value || []; }
  catch (e) { return []; }
}

async function kbWrite(key, val) {
  await fetch(KB, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value: val }) });
}

async function sendSMS(to, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_PHONE_NUMBER;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST', headers: { 'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: message }).toString()
  });
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const authHeader = req.headers.authorization || '';
  const hasToken = process.env.INTERNAL_SECRET && authHeader === `Bearer ${process.env.INTERNAL_SECRET}`;
  if (!isVercelCron && !hasToken) return res.status(401).json({ error: 'Unauthorized' });

  const today = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  console.log(`[DAILY-LEARNING] Running for ${today}`);

  try {
    // Step 1: Collect today's interactions
    const [conversations, learnings, sickDays, tasks] = await Promise.all([
      kbRead('aria_memory_conversations'),
      kbRead('aria_memory_learnings'),
      kbRead('aria_sick_days'),
      kbRead('aria_tasks')
    ]);

    const todayConvos = conversations.filter(c => c.date === today);
    const todayLearnings = learnings.filter(l => l.date === today);
    const todaySick = (Array.isArray(sickDays) ? sickDays : []).filter(s => s.date === today);
    const todayTasks = (Array.isArray(tasks) ? tasks : []).filter(t =>
      (t.created_at && t.created_at.startsWith(today)) || (t.completed_at && t.completed_at.startsWith(today))
    );

    const summary = `Today's activity (${today}):
Conversations: ${todayConvos.length}
${todayConvos.map(c => `- ${c.contactName}: ${c.summary}`).join('\n')}

Learnings saved today: ${todayLearnings.length}
${todayLearnings.map(l => `- ${l.subject}: ${l.fact}`).join('\n')}

Sick days reported: ${todaySick.length}
${todaySick.map(s => `- ${s.cleanerName}: ${s.jobsAffected} jobs affected`).join('\n')}

Tasks created/completed today: ${todayTasks.length}
${todayTasks.slice(0, 10).map(t => `- [${t.status}] ${t.description}`).join('\n')}`;

    console.log(`[DAILY-LEARNING] Collected: ${todayConvos.length} convos, ${todayLearnings.length} learnings, ${todaySick.length} sick, ${todayTasks.length} tasks`);

    // Step 2: Send to Claude for analysis
    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: `You are reviewing Aria's interactions for Lifestyle Home Service today. Extract key learnings that will make Aria smarter tomorrow.

Focus on:
1. CORRECTIONS — anything Aria got wrong and what is right
2. CLIENT DISCOVERIES — new preferences or personality notes
3. CLEANER DISCOVERIES — new availability, strengths or patterns
4. MANAGEMENT PATTERNS — how Karen or Michael made decisions
5. SCHEDULING PATTERNS — rhythms or recurring requests

Format each as a single line: CATEGORY | SUBJECT | LEARNING
Maximum 8 learnings. Only include genuinely new information.
If nothing new was learned today, say "NO_NEW_LEARNINGS".`,
        messages: [{ role: 'user', content: summary }]
      })
    });

    const claudeData = await claudeResp.json();
    const analysis = claudeData.content?.[0]?.text || 'NO_NEW_LEARNINGS';

    console.log(`[DAILY-LEARNING] Claude analysis: ${analysis.substring(0, 200)}`);

    if (analysis.includes('NO_NEW_LEARNINGS') || analysis.trim().length < 20) {
      // Nothing new — still update morning context with date
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
      await kbWrite('aria_morning_context', {
        date: today, tomorrow: tomorrowStr,
        learnings: [], pending_corrections: [],
        updated_at: new Date().toISOString()
      });

      await sendSMS(KAREN_PHONE, `Good evening Karen! Quiet day for learning — no new patterns or corrections to report. See you bright and early tomorrow! — Aria 🏠`);
      return res.status(200).json({ ok: true, learnings: 0, message: 'No new learnings today' });
    }

    // Parse learnings
    const parsedLearnings = analysis.split('\n')
      .filter(l => l.includes('|'))
      .map((l, i) => {
        const parts = l.split('|').map(p => p.trim());
        return { id: i + 1, category: parts[0] || '', subject: parts[1] || '', learning: parts[2] || '', raw: l };
      })
      .filter(l => l.learning.length > 5);

    // Save as pending
    await kbWrite('aria_pending_learnings', { date: today, learnings: parsedLearnings, status: 'pending' });

    // Step 3: Send approval SMS
    let smsText = `Good evening Karen! Here's what I learned today:\n\n`;
    for (const l of parsedLearnings) {
      smsText += `${l.id}. ${l.learning}\n`;
    }
    smsText += `\nReply CONFIRM to save all.\nReply a NUMBER to remove that one.\nReply SKIP to discard all.\n— Aria 🏠`;

    const smsResult = await sendSMS(KAREN_PHONE, smsText);
    console.log(`[DAILY-LEARNING] SMS sent: ${smsResult.sid ? 'OK' : 'FAILED'}`);

    // Step 6: Update morning context
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: TIMEZONE });

    // Get recent learnings for context
    const recentLearnings = learnings.slice(-20).map(l => `${l.subject}: ${l.fact}`);

    await kbWrite('aria_morning_context', {
      date: today,
      tomorrow: tomorrowStr,
      learnings: recentLearnings.slice(-10),
      pending_learnings: parsedLearnings,
      pending_corrections: [],
      updated_at: new Date().toISOString()
    });

    return res.status(200).json({
      ok: true,
      learnings: parsedLearnings.length,
      analysis,
      smsSent: !!smsResult.sid,
      smsText
    });

  } catch (err) {
    console.error('[DAILY-LEARNING] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
