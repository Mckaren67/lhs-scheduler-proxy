// Aria email sending — drafts and sends emails via Gmail API on Karen's behalf
// Routine emails auto-send. Sensitive emails save as draft for Karen to review.

export const config = { api: { bodyParser: true }, maxDuration: 15 };

const KAREN_EMAIL = process.env.GMAIL_USER_EMAIL || 'karen@lifestylehomeservice.com';

async function getAccessToken() {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    }).toString()
  });
  const data = await resp.json();
  if (data.error) throw new Error(`OAuth: ${data.error}`);
  return data.access_token;
}

function encodeBase64Url(str) {
  return Buffer.from(str, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildRawEmail({ to, subject, body, isHtml = false }) {
  const contentType = isHtml ? 'text/html' : 'text/plain';
  const raw = [
    `From: Karen McLaren <${KAREN_EMAIL}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: ${contentType}; charset=utf-8`,
    '',
    body
  ].join('\r\n');
  return encodeBase64Url(raw);
}

// Send an email immediately
export async function sendEmail({ to, subject, body, isHtml = false }) {
  const token = await getAccessToken();
  const raw = buildRawEmail({ to, subject, body, isHtml });

  const resp = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gmail send failed: ${resp.status} ${err.substring(0, 200)}`);
  }

  const result = await resp.json();
  console.log(`[EMAIL] Sent to ${to}: "${subject}" — ID ${result.id}`);
  return { sent: true, messageId: result.id, to, subject };
}

// Save as draft for Karen to review
export async function saveDraft({ to, subject, body, isHtml = false }) {
  const token = await getAccessToken();
  const raw = buildRawEmail({ to, subject, body, isHtml });

  const resp = await fetch('https://www.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { raw } })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gmail draft failed: ${resp.status} ${err.substring(0, 200)}`);
  }

  const result = await resp.json();
  console.log(`[EMAIL] Draft saved for ${to}: "${subject}" — ID ${result.id}`);
  return { drafted: true, draftId: result.id, to, subject };
}

// Determine if an email topic is routine (auto-send) or sensitive (draft only)
const SENSITIVE_KEYWORDS = ['complaint', 'issue', 'problem', 'refund', 'discount',
  'pricing', 'price change', 'increase', 'cancel', 'terminate', 'legal',
  'damage', 'broken', 'unhappy', 'disappointed', 'upset', 'angry', 'sorry'];

export function isSensitiveTopic(subject, body) {
  const text = `${subject} ${body}`.toLowerCase();
  return SENSITIVE_KEYWORDS.some(kw => text.includes(kw));
}

// Look up client email from HCP
export async function lookupClientEmail(clientName) {
  try {
    const apiKey = process.env.HCP_API_KEY;
    const resp = await fetch(
      `https://api.housecallpro.com/customers?query=${encodeURIComponent(clientName)}&page_size=5`,
      { headers: { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' } }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const customers = data.customers || [];
    const match = customers.find(c => {
      const name = `${c.first_name || ''} ${c.last_name || ''}`.trim().toLowerCase();
      return name.includes(clientName.toLowerCase()) || clientName.toLowerCase().includes(name);
    });
    return match?.email || null;
  } catch (e) {
    console.error('[EMAIL] Client lookup failed:', e.message);
    return null;
  }
}

// HTTP handler for direct testing
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  if (!process.env.INTERNAL_SECRET || authHeader !== `Bearer ${process.env.INTERNAL_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { action } = req.query;
  const { to, subject, body, clientName, isHtml } = req.body || {};

  try {
    if (action === 'send') {
      const result = await sendEmail({ to, subject, body, isHtml });
      return res.status(200).json(result);
    }
    if (action === 'draft') {
      const result = await saveDraft({ to, subject, body, isHtml });
      return res.status(200).json(result);
    }
    if (action === 'lookup') {
      const email = await lookupClientEmail(clientName || '');
      return res.status(200).json({ clientName, email });
    }
    return res.status(400).json({ error: 'Use ?action=send|draft|lookup' });
  } catch (err) {
    console.error('[EMAIL] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
