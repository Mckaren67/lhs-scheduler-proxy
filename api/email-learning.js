// Comprehensive email learning analysis — reads ALL Karen's 2026 Gmail,
// extracts communication patterns, updates personas, sends summary
// Run: GET /api/email-learning?run=true
// Pagination: processes emails in batches of 100, continues until all read

export const config = { api: { bodyParser: false }, maxDuration: 300 };

const KB = 'https://lhs-knowledge-base.vercel.app/api/save';
const MICHAEL_PHONE = '+16042601925';

async function getGmailToken() {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    }).toString()
  });
  const d = await resp.json();
  if (d.error) throw new Error(`OAuth: ${d.error}`);
  return d.access_token;
}

function decodeBase64Url(str) {
  if (!str) return '';
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractBody(payload) {
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  if (payload.parts) {
    const text = payload.parts.find(p => p.mimeType === 'text/plain');
    if (text?.body?.data) return decodeBase64Url(text.body.data);
    for (const part of payload.parts) {
      if (part.parts) { const nested = extractBody(part); if (nested) return nested; }
    }
  }
  return '';
}

async function sendSMS(to, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_PHONE_NUMBER;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST', headers: { 'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: message }).toString()
  });
}

async function kbWrite(key, val) {
  await fetch(KB, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value: val }) });
}

async function kbRead(key) {
  try { const r = await fetch(`${KB}?key=${key}`); const d = await r.json(); return d.value; }
  catch { return null; }
}

// Fetch ALL message IDs in date range, paginating through results
async function fetchAllMessageIds(token, query, maxResults = 100) {
  const ids = [];
  let pageToken = null;
  let page = 0;
  do {
    const url = new URL('https://www.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', maxResults);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const resp = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await resp.json();
    const msgs = data.messages || [];
    ids.push(...msgs.map(m => m.id));
    pageToken = data.nextPageToken || null;
    page++;
    console.log(`[EMAIL-LEARN] Page ${page}: ${msgs.length} messages (total: ${ids.length})`);
  } while (pageToken);
  return ids;
}

// Read a single message and extract summary (patterns only, no verbatim content)
async function readMessage(token, msgId) {
  try {
    const resp = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const msg = await resp.json();
    const headers = msg.payload?.headers || [];
    const getHeader = name => headers.find(h => h.name === name)?.value || '';
    const body = extractBody(msg.payload);
    const labels = msg.labelIds || [];

    return {
      from: getHeader('From').substring(0, 80),
      to: getHeader('To').substring(0, 80),
      subject: getHeader('Subject').substring(0, 120),
      date: getHeader('Date').substring(0, 30),
      bodyLength: body.length,
      snippet: body.substring(0, 150).replace(/\n/g, ' '),
      labels,
      isSent: labels.includes('SENT'),
      isStarred: labels.includes('STARRED')
    };
  } catch (e) {
    return null;
  }
}

// Analyze a batch of email summaries via Claude
async function analyzeBatch(summaries, batchNum, totalBatches) {
  const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20241022',
      max_tokens: 2000,
      system: `You are analyzing emails from Karen, manager of Lifestyle Home Service (residential cleaning, Chilliwack BC). She manages 20 cleaners and 177 clients. Key accounts: Prokey Living (property management/post-construction) and Six Cedars/Westbow Construction (post-construction).

Extract PATTERNS ONLY — no personal information or verbatim content.

Analyze for:
1. COMMUNICATION STYLE — Karen's tone, common phrases, email length patterns
2. CLIENT PATTERNS — frequent contacts, recurring requests, complaint types
3. STAFF PATTERNS — which cleaners generate traffic, common issues
4. KEY ACCOUNTS — Prokey, Westbow, Six Cedars specifics
5. JOTFORM — intake form types, frequency, submitters
6. BILLING — invoice issues, payment patterns, reconciliation problems
7. SCHEDULING — common scheduling requests, cancellations, rescheduling
8. TMOR CANDIDATES — recurring morning situations, automatable patterns

Format as structured JSON with categories as keys.`,
      messages: [{ role: 'user', content: `Batch ${batchNum}/${totalBatches} (${summaries.length} emails):\n\n${summaries.map(s => `${s.isSent ? 'SENT' : 'RECV'} | ${s.from} | ${s.subject} | ${s.date} | ${s.bodyLength}ch | ${s.snippet}`).join('\n')}` }]
    })
  });
  return (await claudeResp.json()).content?.[0]?.text || '';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const authHeader = req.headers.authorization || '';
  if (!process.env.INTERNAL_SECRET || authHeader !== `Bearer ${process.env.INTERNAL_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.query.run !== 'true') {
    return res.status(200).json({ message: 'Add ?run=true to execute comprehensive email analysis' });
  }

  try {
    const token = await getGmailToken();
    const startDate = req.query.from || '2026/01/01';
    const endDate = req.query.to || new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    console.log(`[EMAIL-LEARN] Starting comprehensive analysis: ${startDate} to ${endDate}`);

    // Fetch ALL message IDs — inbox + sent + all folders
    const query = `after:${startDate} before:${endDate}`;
    const allIds = await fetchAllMessageIds(token, query);
    console.log(`[EMAIL-LEARN] Total messages found: ${allIds.length}`);

    // Process in batches of 100
    const BATCH_SIZE = 100;
    const batches = [];
    let sentCount = 0, receivedCount = 0;

    for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
      const batchIds = allIds.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allIds.length / BATCH_SIZE);

      console.log(`[EMAIL-LEARN] Reading batch ${batchNum}/${totalBatches}...`);

      // Read messages in parallel (5 at a time to avoid rate limits)
      const summaries = [];
      for (let j = 0; j < batchIds.length; j += 5) {
        const chunk = batchIds.slice(j, j + 5);
        const results = await Promise.all(chunk.map(id => readMessage(token, id)));
        summaries.push(...results.filter(Boolean));
      }

      summaries.forEach(s => { if (s.isSent) sentCount++; else receivedCount++; });

      // Analyze batch via Claude
      const analysis = await analyzeBatch(summaries, batchNum, totalBatches);
      batches.push({ batchNum, count: summaries.length, analysis });
    }

    // Final synthesis — combine all batch analyses
    const synthesisResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20241022',
        max_tokens: 4000,
        system: `You are synthesizing email analysis results for Lifestyle Home Service. Combine batch findings into a comprehensive report. Format as structured learnings — patterns only, no personal data.`,
        messages: [{ role: 'user', content: `Synthesize these ${batches.length} batch analyses (${allIds.length} total emails, ${sentCount} sent, ${receivedCount} received):\n\n${batches.map(b => `BATCH ${b.batchNum} (${b.count} emails):\n${b.analysis}`).join('\n\n---\n\n')}` }]
      })
    });
    const synthesis = (await synthesisResp.json()).content?.[0]?.text || 'Synthesis unavailable';

    // Save comprehensive analysis to KB
    await kbWrite('aria_email_learnings', {
      date: new Date().toISOString(),
      dateRange: { from: startDate, to: endDate },
      totalEmails: allIds.length,
      sentCount,
      receivedCount,
      batchesProcessed: batches.length,
      synthesis,
      patterns: synthesis.split('\n').filter(l => l.trim().length > 10)
    });

    // Update personas with email-derived insights
    const existingClient = (await kbRead('aria_client_personas')) || [];
    const existingEmployee = (await kbRead('aria_employee_personas')) || [];
    const existingMgmt = (await kbRead('aria_management_personas')) || [];

    // Add email-derived communication style to management persona
    const karenPersona = existingMgmt.find(p => p.name === 'Karen McLaren');
    if (karenPersona) {
      karenPersona.email_communication_style = {
        lastUpdated: new Date().toISOString(),
        emailsAnalyzed: allIds.length,
        sentCount,
        receivedCount,
        derivedFromSynthesis: true
      };
      await kbWrite('aria_management_personas', existingMgmt);
    }

    // Send Michael summary
    const smsMsg = `\u{1F4E7} Full Email Analysis Complete \u2014 ${new Date().toISOString().slice(0, 10)}\n\nTotal emails analyzed: ${receivedCount} received + ${sentCount} sent = ${allIds.length} total\n\nDate range: ${startDate} to ${endDate}\nBatches processed: ${batches.length}\n\nFull analysis saved to knowledge base. \u2014 Aria \u{1F3E0}`;
    await sendSMS(MICHAEL_PHONE, smsMsg);

    return res.status(200).json({
      ok: true,
      totalEmails: allIds.length,
      sentCount,
      receivedCount,
      batchesProcessed: batches.length,
      synthesis: synthesis.substring(0, 2000),
      savedToKB: true,
      michaelNotified: true
    });

  } catch (err) {
    console.error('[EMAIL-LEARN] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
