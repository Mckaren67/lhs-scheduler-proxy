// Tuesday 9am Pacific payroll reminder — SMS to Karen and Michael
// Cron: 0 16 * * 2 (4pm UTC Tuesday = 9am PDT Tuesday)

export const config = { api: { bodyParser: false }, maxDuration: 15 };

async function sendSMS(to, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ To: to, From: from, Body: message }).toString()
  });
  return r.json();
}

export default async function handler(req, res) {
  const isCron = req.headers['x-vercel-cron'] === '1';
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (!isCron && auth !== process.env.INTERNAL_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Fetch current payroll status
    const pr = await fetch('https://lhs-knowledge-base.vercel.app/api/payroll', {
      headers: { 'Authorization': `Bearer ${process.env.INTERNAL_SECRET}` }
    });
    const pd = await pr.json();
    const period = pd.current;
    const statusMap = { open: 'hours not yet confirmed', confirmed: 'hours confirmed — ready for calculator', submitted: 'submitted to Bill Gee', processed: 'fully processed' };
    const statusText = statusMap[period?.status] || period?.status || 'unknown';

    const msg = `Good morning! Payroll reminder 📋\n\nPeriod: ${period?.startDate || '?'} to ${period?.endDate || '?'}\nStatus: ${statusText}\nDue: Wednesday — ${pd.daysUntilDue || '?'} day${pd.daysUntilDue !== 1 ? 's' : ''} away\n\nCalculator: aistudio.google.com/app/apps/82328746-e0d6-41ec-9059-9e5f3f2cae31\n\nText PAYROLL for full status.\nText 'Payroll confirmed' when hours are done.\n— Aria 🏠`;

    const [karenR, michaelR] = await Promise.all([
      sendSMS('+16048009630', msg),
      sendSMS('+16046180336', msg)
    ]);

    console.log(`[PAYROLL-REMIND] Karen: ${karenR.sid || 'failed'} | Michael: ${michaelR.sid || 'failed'}`);
    return res.status(200).json({ ok: true, karenSid: karenR.sid, michaelSid: michaelR.sid });
  } catch (err) {
    console.error('[PAYROLL-REMIND] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
