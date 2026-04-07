// Aria outbound calling — Twilio Programmable Voice + ElevenLabs voice AI
// Makes calls on Karen's behalf, delivers messages, leaves voicemails

export const config = { api: { bodyParser: true }, maxDuration: 15 };

const LHS_PHONE = '6042601925'; // Main LHS number for caller ID

async function sendSMS(to, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const toPhone = to.startsWith('+') ? to : to.length === 10 ? `+1${to}` : `+${to}`;
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ To: toPhone, From: from, Body: message }).toString()
    }
  );
  return response.json();
}

// Initiate an outbound call with a spoken message via TwiML
export async function makeCall({ to, message, callerName }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromPhone = process.env.TWILIO_PHONE_NUMBER;
  const toPhone = to.startsWith('+') ? to : to.length === 10 ? `+1${to}` : `+${to}`;

  // Build TwiML that speaks the message and handles voicemail
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say voice="Polly.Joanna" language="en-US">
    ${escapeXml(message)}
  </Say>
  <Pause length="1"/>
  <Say voice="Polly.Joanna" language="en-US">
    If you have any questions, please call us back at 604-260-1925 or text 778-200-6517. Thank you and have a wonderful day!
  </Say>
</Response>`;

  // Encode TwiML as a URL for Twilio
  const baseUrl = 'https://lhs-scheduler-proxy.vercel.app';
  const twimlUrl = `${baseUrl}/api/aria-call?action=twiml&msg=${encodeURIComponent(message)}&name=${encodeURIComponent(callerName || '')}`;

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        To: toPhone,
        From: fromPhone,
        Url: twimlUrl,
        MachineDetection: 'DetectMessageEnd',
        MachineDetectionTimeout: '10'
      }).toString()
    }
  );

  const data = await response.json();
  if (data.sid) {
    console.log(`[CALL] Initiated to ${toPhone}: SID ${data.sid}`);
    return { called: true, callSid: data.sid, to: toPhone, status: data.status };
  } else {
    console.error('[CALL] Failed:', JSON.stringify(data));
    return { called: false, error: data.message || 'Call failed' };
  }
}

function escapeXml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Look up client phone from HCP
export async function lookupClientPhone(clientName) {
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
    if (!match) return null;
    const phone = match.mobile_number || match.home_number || match.work_number;
    return phone || null;
  } catch (e) {
    console.error('[CALL] Client lookup failed:', e.message);
    return null;
  }
}

// HTTP handler — serves TwiML for active calls AND handles API requests
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // TwiML endpoint — called by Twilio during the call (no auth needed, Twilio calls this)
  if (action === 'twiml') {
    const message = req.query.msg || 'Hello, this is Aria from Lifestyle Home Service calling on behalf of Karen.';
    const callerName = req.query.name || '';

    // Check if voicemail was detected
    const answeredBy = req.body?.AnsweredBy || '';
    const isVoicemail = answeredBy.includes('machine');

    let greeting;
    if (isVoicemail) {
      greeting = `Hi${callerName ? ', this is a message for ' + callerName : ''}. This is Aria calling from Lifestyle Home Service on behalf of Karen McLaren.`;
    } else {
      greeting = `Hi${callerName ? ' ' + callerName : ''}! This is Aria calling from Lifestyle Home Service on behalf of Karen McLaren.`;
    }

    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say voice="Polly.Joanna" language="en-US">${escapeXml(greeting)}</Say>
  <Pause length="1"/>
  <Say voice="Polly.Joanna" language="en-US">${escapeXml(message)}</Say>
  <Pause length="1"/>
  <Say voice="Polly.Joanna" language="en-US">If you have any questions, please call us back at 604-260-1925 or text 778-200-6517. Thank you and have a wonderful day!</Say>
</Response>`);
  }

  // API endpoints — require auth
  const authHeader = req.headers.authorization || '';
  if (!process.env.INTERNAL_SECRET || authHeader !== `Bearer ${process.env.INTERNAL_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (action === 'call') {
      const { clientName, message } = req.body || {};
      if (!clientName || !message) return res.status(400).json({ error: 'Missing clientName or message' });

      const phone = await lookupClientPhone(clientName);
      if (!phone) return res.status(200).json({ called: false, error: `No phone number found for ${clientName}` });

      const result = await makeCall({ to: phone, message, callerName: clientName });
      return res.status(200).json(result);
    }

    if (action === 'lookup') {
      const phone = await lookupClientPhone(req.query.name || req.body?.clientName || '');
      return res.status(200).json({ phone });
    }

    return res.status(400).json({ error: 'Use ?action=call|lookup' });
  } catch (err) {
    console.error('[CALL] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
