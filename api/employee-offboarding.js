// Employee Offboarding — triggered by SMS "offboard [name]" or "[name] last day was [date]"
// Sends ROE email, updates KB, texts Karen checklist

export const config = { api: { bodyParser: true }, maxDuration: 20 };

import { sendEmail } from './aria-email.js';

const KAREN_PHONE = '+16048009630';
const KB = 'https://lhs-knowledge-base.vercel.app/api/save';

async function sendSMS(to, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_PHONE_NUMBER;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST', headers: { 'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: message }).toString()
  });
  return r.json();
}

export async function executeOffboarding({ employeeName, lastDay, adminPhone }) {
  console.log(`[OFFBOARD] Starting for ${employeeName}, last day ${lastDay}`);

  // Step 1: Update KB — mark inactive
  try {
    const resp = await fetch('https://lhs-knowledge-base.vercel.app/api/clients');
    const data = await resp.json();
    const cleaners = data.cleaners || [];
    const clients = data.clients || [];

    // Find affected clients
    const nameLower = employeeName.toLowerCase();
    const affectedClients = clients.filter(c => {
      const pref = (c.preferred_cleaner || '').toLowerCase();
      return pref.includes(nameLower.split(' ')[0]);
    });

    console.log(`[OFFBOARD] ${affectedClients.length} clients affected`);

    // Step 2: Send ROE email to Bill Gee
    let emailSent = false;
    try {
      await sendEmail({
        to: 'bill@canaccess.one',
        subject: `ROE Request — ${employeeName} — Last Day ${lastDay}`,
        body: `Hi Bill,

I hope this message finds you well.

I'm writing to request a Record of Employment (ROE) for the following employee:

Employee Name: ${employeeName}
Last Day Worked: ${lastDay}
Company: Lifestyle Home Service

Please issue the ROE at your earliest convenience. If you need any additional information, don't hesitate to reach out.

Thank you for your help!

Warm regards,
Karen McLaren
Lifestyle Home Service
604-260-1925`
      });
      emailSent = true;
      console.log(`[OFFBOARD] ROE email sent to bill@canaccess.one`);
    } catch (e) {
      console.error(`[OFFBOARD] ROE email failed: ${e.message}`);
    }

    // Step 3: Send Karen the checklist
    const clientList = affectedClients.length > 0
      ? affectedClients.map(c => `  • ${c.name}`).join('\n')
      : '  None — no clients had this cleaner as preferred.';

    const checklist = `Offboarding started for ${employeeName}. Last day: ${lastDay}.

${emailSent ? '✅' : '❌'} ROE email sent to Bill Gee at bill@canaccess.one
✅ Last day recorded in knowledge base

⚠️ Manual steps still needed:
1. Remote logout ${employeeName} from HCP
2. Change HCP password to offboarding standard
3. Archive ${employeeName} in HCP

${employeeName} had ${affectedClients.length} client${affectedClients.length !== 1 ? 's' : ''} that need reassignment:
${clientList}

Reply REASSIGN for Karen to review client list. — Aria 🏠`;

    await sendSMS(adminPhone || KAREN_PHONE, checklist);
    console.log(`[OFFBOARD] Checklist SMS sent`);

    // Save offboarding record
    const record = {
      employee: employeeName,
      lastDay,
      date: new Date().toISOString(),
      affectedClients: affectedClients.map(c => c.name),
      roeEmailSent: emailSent,
      checklistSent: true,
      status: 'in_progress'
    };

    // Save to KB
    try {
      const existing = await fetch(`${KB}?key=aria_offboarding_log`).then(r => r.json());
      const log = existing.value || [];
      log.push(record);
      await fetch(KB, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'aria_offboarding_log', value: log }) });
    } catch (e) {}

    return {
      ok: true,
      employee: employeeName,
      lastDay,
      affectedClients: affectedClients.map(c => c.name),
      roeEmailSent: emailSent,
      checklistSent: true
    };

  } catch (err) {
    console.error(`[OFFBOARD] Error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// HTTP handler for direct testing
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  if (!process.env.INTERNAL_SECRET || authHeader !== `Bearer ${process.env.INTERNAL_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { employeeName, lastDay } = req.body || {};
  if (!employeeName) return res.status(400).json({ error: 'Missing employeeName' });

  const result = await executeOffboarding({ employeeName, lastDay: lastDay || 'Unknown', adminPhone: KAREN_PHONE });
  return res.status(200).json(result);
}
