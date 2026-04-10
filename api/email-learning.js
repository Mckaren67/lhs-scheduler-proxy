// One-time email learning analysis — reads Karen's 2026 Gmail,
// extracts communication patterns, updates personas
// Run once: GET /api/email-learning?run=true

export const config = { api: { bodyParser: false }, maxDuration: 60 };

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const authHeader = req.headers.authorization || '';
  if (!process.env.INTERNAL_SECRET || authHeader !== `Bearer ${process.env.INTERNAL_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.query.run !== 'true') {
    return res.status(200).json({ message: 'Add ?run=true to execute email analysis' });
  }

  try {
    const token = await getGmailToken();
    console.log('[EMAIL-LEARN] Gmail token obtained');

    // Fetch sent emails from 2026
    const searchResp = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent('from:karen@lifestylehomeservice.com after:2026/01/01 before:2026/04/11')}&maxResults=100`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const searchData = await searchResp.json();
    const messageIds = (searchData.messages || []).map(m => m.id);
    console.log(`[EMAIL-LEARN] Found ${messageIds.length} sent emails`);

    // Read up to 50 emails (avoid timeout)
    const emailSummaries = [];
    for (const msgId of messageIds.slice(0, 50)) {
      try {
        const msgResp = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const msg = await msgResp.json();
        const headers = msg.payload?.headers || [];
        const to = headers.find(h => h.name === 'To')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';
        const body = extractBody(msg.payload);

        // Extract patterns only — no verbatim content stored
        emailSummaries.push(`To: ${to.substring(0, 50)} | Subject: ${subject.substring(0, 80)} | Date: ${date.substring(0, 20)} | Length: ${body.length} chars | Snippet: ${body.substring(0, 100).replace(/\n/g, ' ')}`);
      } catch (e) {}
    }

    console.log(`[EMAIL-LEARN] Read ${emailSummaries.length} emails`);

    // Send to Claude for analysis
    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 800,
        system: `You are analyzing emails from Karen, manager of a residential cleaning company (Lifestyle Home Service, Chilliwack BC). Extract PATTERNS ONLY — no personal information.

Extract:
1. COMMUNICATION STYLE — how Karen writes, her tone, common phrases
2. RECURRING ISSUES — what problems come up repeatedly
3. CLIENT PATTERNS — which clients email most, what about
4. STAFF PATTERNS — which staff generate most email traffic
5. RESPONSE PATTERNS — what types of emails she prioritizes
6. COMMON REQUESTS — what clients and staff ask most
7. TMOR CANDIDATES — recurring morning situations that could become proactive workflows

Format as structured learnings. Maximum 10 items. Be concise.`,
        messages: [{ role: 'user', content: `${emailSummaries.length} emails from Karen's sent folder (Jan-Apr 2026):\n\n${emailSummaries.join('\n')}` }]
      })
    });

    const analysis = (await claudeResp.json()).content?.[0]?.text || 'Analysis unavailable';
    console.log(`[EMAIL-LEARN] Analysis complete: ${analysis.length} chars`);

    // Save to KB — patterns only, no verbatim email content
    await fetch(KB, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'aria_email_learnings', value: {
        date: new Date().toISOString(),
        emailsAnalyzed: emailSummaries.length,
        analysis,
        patterns: analysis.split('\n').filter(l => l.trim().length > 10)
      }})
    });

    // Send Michael summary
    const top5 = analysis.split('\n').filter(l => l.trim().length > 10).slice(0, 5).join('\n');
    await sendSMS(MICHAEL_PHONE, `📧 Email analysis complete for Karen's 2026 inbox.\n\n${emailSummaries.length} emails analyzed.\n\nKey findings:\n${top5}\n\nFull analysis saved to knowledge base. — Aria 🏠`);

    return res.status(200).json({
      ok: true,
      emailsAnalyzed: emailSummaries.length,
      analysis,
      savedToKB: true,
      michaelNotified: true
    });

  } catch (err) {
    console.error('[EMAIL-LEARN] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
