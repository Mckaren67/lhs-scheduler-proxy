export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const body = req.body || {};
  const from = body.From || '';
  const message = body.Body || '';
  const to = body.To || '';

  console.log(`Incoming SMS from ${from}: ${message}`);

  // Build Aria's response
  let reply = '';

  const lowerMsg = message.toLowerCase();

  // Sick day detection
  if (lowerMsg.includes('sick') || lowerMsg.includes('not feeling well') || 
      lowerMsg.includes("can't make it") || lowerMsg.includes('unwell')) {
    reply = `Hi! Sorry to hear you're not well. I've noted your absence for today and will take care of notifying your clients right away. Please rest up and feel better soon! Karen will be notified. 🏠`;
  }
  // Time off request
  else if (lowerMsg.includes('day off') || lowerMsg.includes('time off') || 
           lowerMsg.includes('vacation') || lowerMsg.includes('holiday')) {
    reply = `Hi! I've received your time off request. Could you let me know the specific dates you're requesting? I'll check the schedule and get Karen's approval for you.`;
  }
  // Meeting request
  else if (lowerMsg.includes('meeting') || lowerMsg.includes('speak to karen') || 
           lowerMsg.includes('talk to karen') || lowerMsg.includes('personal')) {
    reply = `Hi! Of course — I'll arrange a meeting with Karen for you. To help her prepare, could you briefly share the topics you'd like to cover? Everything is kept confidential. 🏠`;
  }
  // Default response
  else {
    reply = `Hi! Thanks for your message. I've passed it along and someone will get back to you shortly. For urgent matters please call 604-260-1925. — Lifestyle Home Service 🏠`;
  }

  // Send reply via Twilio TwiML
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${reply}</Message>
</Response>`);
}
