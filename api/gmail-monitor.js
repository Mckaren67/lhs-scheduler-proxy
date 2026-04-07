// Gmail monitor — checks Karen's inbox every 15 min, drafts replies, texts Karen
// Uses OAuth refresh token stored in Vercel env vars

export const config = { api: { bodyParser: false }, maxDuration: 30 };

const KAREN_PHONE = '+16048009630';

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
  if (data.error) throw new Error(`OAuth: ${data.error} — ${data.error_description || ''}`);
  return data.access_token;
}

async function gmailGet(token, path) {
  const resp = await fetch(`https://www.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gmail GET ${path}: ${resp.status} ${err.substring(0, 200)}`);
  }
  return resp.json();
}

async function gmailPost(token, path, body) {
  const resp = await fetch(`https://www.googleapis.com/gmail/v1/users/me/${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gmail POST ${path}: ${resp.status} ${err.substring(0, 200)}`);
  }
  return resp.json();
}

function decodeBase64Url(str) {
  if (!str) return '';
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf-8');
}

function encodeBase64Url(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function extractHeader(headers, name) {
  const h = headers?.find(h => h.name.toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

function extractBody(payload) {
  // Try plain text first, then HTML
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  if (payload.parts) {
    const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
    if (textPart?.body?.data) return decodeBase64Url(textPart.body.data);
    const htmlPart = payload.parts.find(p => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      const html = decodeBase64Url(htmlPart.body.data);
      return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    // Nested multipart
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }
  return '';
}

function isSkippable(from, subject) {
  const skipSenders = ['noreply', 'no-reply', 'notifications', 'mailer-daemon', 'postmaster',
    'donotreply', 'updates@', 'news@', 'marketing@', 'promo@', 'newsletter'];
  const fromLower = from.toLowerCase();
  if (skipSenders.some(s => fromLower.includes(s))) return true;
  const skipSubjects = ['unsubscribe', 'verify your email', 'confirm your', 'password reset',
    'security alert', 'invoice from quickbooks', 'payment receipt'];
  const subjLower = (subject || '').toLowerCase();
  if (skipSubjects.some(s => subjLower.includes(s))) return true;
  return false;
}

function extractSenderName(from) {
  // "Karen McLaren <karen@lhs.com>" → "Karen McLaren"
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  // Just email
  return from.split('@')[0].replace(/[._-]/g, ' ').trim();
}

function buildDraftReply(fromName, subject, bodySnippet, messageId, threadId) {
  const firstName = fromName.split(' ')[0];
  const topicHint = subject.replace(/^(re:|fwd?:)\s*/gi, '').trim();

  // Build a warm Karen-style response
  let replyBody = `Hi ${firstName},\n\n`;
  replyBody += `Thank you for reaching out! I wanted to let you know I received your message`;
  if (topicHint) replyBody += ` about ${topicHint.toLowerCase()}`;
  replyBody += `.\n\n`;
  replyBody += `I'll review the details and get back to you shortly. If this is urgent, please don't hesitate to call us at 604-260-1925.\n\n`;
  replyBody += `Warm regards,\nKaren McLaren\nLifestyle Home Service\n604-260-1925`;

  // Build RFC 2822 message
  const rawMessage = [
    `In-Reply-To: ${messageId}`,
    `References: ${messageId}`,
    `Subject: Re: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    '',
    replyBody
  ].join('\r\n');

  return {
    message: { raw: encodeBase64Url(rawMessage), threadId },
    senderName: fromName,
    topic: topicHint || subject
  };
}

async function sendSMS(to, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ To: to, From: from, Body: message }).toString()
    }
  );
  return response.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const authHeader = req.headers.authorization || '';
  const hasToken = process.env.INTERNAL_SECRET && authHeader === `Bearer ${process.env.INTERNAL_SECRET}`;
  if (!isVercelCron && !hasToken) return res.status(401).json({ error: 'Unauthorized' });

  if (!process.env.GMAIL_REFRESH_TOKEN) {
    return res.status(500).json({ error: 'GMAIL_REFRESH_TOKEN not set' });
  }

  try {
    const token = await getAccessToken();
    console.log('[GMAIL] Access token obtained');

    // Search for unread emails, skip promotions/social/updates
    const searchResp = await gmailGet(token,
      'messages?q=' + encodeURIComponent('is:unread -category:promotions -category:social -category:updates -category:forums -from:noreply -from:no-reply') +
      '&maxResults=5'
    );

    const messageIds = (searchResp.messages || []).map(m => m.id);
    if (messageIds.length === 0) {
      console.log('[GMAIL] No new unread emails');
      return res.status(200).json({ ok: true, processed: 0, message: 'No new emails' });
    }

    console.log(`[GMAIL] Found ${messageIds.length} unread email(s)`);
    const drafted = [];

    for (const msgId of messageIds) {
      try {
        const msg = await gmailGet(token, `messages/${msgId}?format=full`);
        const headers = msg.payload?.headers || [];
        const from = extractHeader(headers, 'From');
        const subject = extractHeader(headers, 'Subject');
        const messageIdHeader = extractHeader(headers, 'Message-ID') || extractHeader(headers, 'Message-Id');

        // Skip automated emails
        if (isSkippable(from, subject)) {
          console.log(`[GMAIL] Skipping: ${from} — ${subject}`);
          continue;
        }

        // Skip if Karen already replied (check thread)
        const userEmail = process.env.GMAIL_USER_EMAIL || 'karen@lifestylehomeservice.com';
        if (msg.payload?.headers?.some(h => h.name === 'From' && h.value.includes(userEmail))) {
          continue;
        }

        const body = extractBody(msg.payload);
        const senderName = extractSenderName(from);

        console.log(`[GMAIL] Processing: ${senderName} — ${subject}`);

        // Build and save draft reply
        const { message: draftMessage, topic } = buildDraftReply(
          senderName, subject, body.substring(0, 500), messageIdHeader, msg.threadId
        );

        await gmailPost(token, 'drafts', draftMessage);
        console.log(`[GMAIL] Draft saved for: ${senderName}`);

        // Text Karen
        await sendSMS(KAREN_PHONE,
          `Hi Karen, I've drafted a response to ${senderName} about "${topic}". Check your Gmail drafts when you get a chance. — Aria 🏠`
        );

        drafted.push({ sender: senderName, subject, topic });

      } catch (msgErr) {
        console.error(`[GMAIL] Error processing ${msgId}:`, msgErr.message);
      }
    }

    console.log(`[GMAIL] Done: ${drafted.length} draft(s) created`);
    return res.status(200).json({ ok: true, processed: drafted.length, drafted });

  } catch (err) {
    console.error('[GMAIL] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
