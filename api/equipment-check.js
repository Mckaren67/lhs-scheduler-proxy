// Sunday evening equipment check — sends SMS to all active cleaners at 6pm PT
// Cron: 0 1 * * 1 (1am Monday UTC = 6pm Sunday PDT)

export const config = { api: { bodyParser: true }, maxDuration: 30 };

const CLEANERS = [
  { name: 'Alissa D', first: 'Alissa' },
  { name: 'Anna F', first: 'Anna' },
  { name: 'April W', first: 'April' },
  { name: 'Brandi M', first: 'Brandi' },
  { name: 'Danielle B', first: 'Danielle' },
  { name: 'Genevieve O', first: 'Genevieve' },
  { name: 'Holly D', first: 'Holly' },
  { name: 'Kristen K', first: 'Kristen' },
  { name: 'Margret W', first: 'Margret' },
  { name: 'Nicole D', first: 'Nicole' },
  { name: 'Paula A', first: 'Paula' },
  { name: 'Rebecca D', first: 'Rebecca' },
  { name: 'Vanessa A', first: 'Vanessa' },
  { name: 'Amber J', first: 'Amber' },
  { name: 'Cathy W', first: 'Cathy' },
  { name: 'Kelly K', first: 'Kelly' },
  { name: 'Nikki S', first: 'Nikki' }
];

async function sendSMS(to, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ To: to, From: from, Body: message }).toString()
  });
  return resp.json();
}

export default async function handler(req, res) {
  const isCron = req.headers['x-vercel-cron'] === '1';
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (!isCron && auth !== process.env.INTERNAL_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // For now, log the intent — actual SMS sending requires cleaner phone numbers from HCP
    // When phone numbers are available, uncomment the sendSMS calls below
    const sent = [];
    console.log(`[EQUIP-CHECK] Sunday equipment check — ${CLEANERS.length} cleaners`);

    for (const c of CLEANERS) {
      const msg = `Hi ${c.first}! This is Aria from LHS.\nFriendly reminder to check your equipment is ready for the week ahead — vacuum, cleaning kit, mop and supplies.\n\nReply READY if all good.\nReply ISSUE if you have any equipment concerns and I will flag it for Karen right away.\n\nHave a great week! — Aria from LHS`;
      console.log(`[EQUIP-CHECK] Would send to ${c.name}: ${msg.substring(0, 60)}...`);
      sent.push(c.name);
    }

    return res.status(200).json({ ok: true, cleanerCount: CLEANERS.length, sent });
  } catch (err) {
    console.error('[EQUIP-CHECK] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
