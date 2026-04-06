export const config = { api: { bodyParser: true } };

const KAREN_PHONE = '+16048009630';

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

async function lookupEmployeePhone(firstName) {
  try {
    const response = await fetch('https://api.housecallpro.com/employees?page_size=50', {
      headers: {
        'Authorization': `Token ${process.env.HCP_API_KEY}`,
        'Accept': 'application/json'
      }
    });
    if (!response.ok) return null;
    const data = await response.json();
    const employees = data.employees || [];
    const match = employees.find(e =>
      e.first_name?.toLowerCase() === firstName.toLowerCase()
    );
    if (match?.mobile_number) {
      const phone = match.mobile_number;
      return phone.startsWith('+') ? phone :
        phone.length === 10 ? `+1${phone}` : `+${phone}`;
    }
    return null;
  } catch (err) {
    console.error('[LEAVE] Employee lookup failed:', err.message);
    return null;
  }
}

function parseJotFormPayload(body) {
  // JotForm sends data as either a rawRequest JSON string or as flat form fields
  // Field names use patterns like q3_firstName, q4_lastName, etc.
  // We search all keys for matching labels since field IDs vary by form

  let fields = body;

  // If JotForm sent rawRequest, parse it
  if (body.rawRequest) {
    try {
      fields = JSON.parse(body.rawRequest);
    } catch (e) {
      console.error('[LEAVE] Failed to parse rawRequest:', e.message);
    }
  }

  // Extract by searching field keys and values
  // JotForm keys look like: q3_firstName, q5_leaveStart, etc.
  // Or in rawRequest: { "3": { "first": "Holly", "last": "D" }, "5": "2026-04-10", ... }
  let firstName = '', lastName = '', startDate = '', endDate = '', leaveType = '', comments = '';

  for (const [key, val] of Object.entries(fields)) {
    const k = key.toLowerCase();

    if (typeof val === 'object' && val !== null && (val.first || val.last)) {
      // Name field — JotForm sends names as { first, last }
      firstName = val.first || firstName;
      lastName = val.last || lastName;
      continue;
    }

    const v = String(val || '');

    if (k.includes('firstname') || k.includes('first_name') || k === 'first') {
      firstName = v;
    } else if (k.includes('lastname') || k.includes('last_name') || k === 'last') {
      lastName = v;
    } else if (k.includes('leavestart') || k.includes('leave_start') || k.includes('start_date') || k.includes('startdate')) {
      startDate = v;
    } else if (k.includes('leaveend') || k.includes('leave_end') || k.includes('end_date') || k.includes('enddate')) {
      endDate = v;
    } else if (k.includes('leavetype') || k.includes('leave_type') || k.includes('type')) {
      // Avoid matching generic keys like "formType"
      if (!k.includes('form') && !k.includes('submission')) leaveType = v;
    } else if (k.includes('comment') || k.includes('reason') || k.includes('notes')) {
      comments = v;
    }

    // Also match JotForm's "pretty" field names sent in some webhook formats
    if (k.includes('first name') || k === 'first name') firstName = v;
    if (k.includes('last name') || k === 'last name') lastName = v;
    if (k.includes('leave start') || k === 'leave start') startDate = v;
    if (k.includes('leave end') || k === 'leave end') endDate = v;
    if (k.includes('leave type') || k === 'leave type') leaveType = v;
  }

  // Fallback: try to find name in a "fullName" or "name" field
  if (!firstName) {
    const nameField = fields.fullName || fields.name || fields.employee_name || '';
    if (typeof nameField === 'string' && nameField.includes(' ')) {
      const parts = nameField.split(' ');
      firstName = parts[0];
      lastName = parts.slice(1).join(' ');
    }
  }

  return { firstName: firstName.trim(), lastName: lastName.trim(), startDate, endDate, leaveType, comments };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  console.log('[LEAVE] Received JotForm webhook:', JSON.stringify(req.body).substring(0, 500));

  const { firstName, lastName, startDate, endDate, leaveType, comments } = parseJotFormPayload(req.body || {});
  const fullName = `${firstName} ${lastName}`.trim();

  if (!firstName || !startDate) {
    console.error('[LEAVE] Missing required fields — name:', fullName, 'start:', startDate);
    return res.status(200).json({ ok: false, error: 'Missing required fields' });
  }

  console.log(`[LEAVE] Parsed: ${fullName} | ${leaveType} | ${startDate} to ${endDate} | ${comments}`);

  try {
    // 1. SMS Karen
    const karenMsg = `Leave request from ${fullName} — ${leaveType || 'Leave'} from ${startDate} to ${endDate || startDate}.${comments ? ` Comments: ${comments}` : ''} — LHS 🏠`;
    const karenResult = await sendSMS(KAREN_PHONE, karenMsg);
    console.log(`[LEAVE] Karen SMS:`, karenResult.sid ? `sent (${karenResult.sid})` : 'failed');

    // 2. Look up employee phone and send confirmation
    let employeeNotified = false;
    const employeePhone = await lookupEmployeePhone(firstName);

    if (employeePhone) {
      const dateRange = endDate && endDate !== startDate
        ? `${startDate} to ${endDate}`
        : startDate;
      const empMsg = `Hi ${firstName}, your leave request for ${dateRange} has been received. Karen will follow up with you shortly. — LHS 🏠`;
      const empResult = await sendSMS(employeePhone, empMsg);
      employeeNotified = !!empResult.sid;
      console.log(`[LEAVE] Employee SMS to ${firstName} (${employeePhone}):`, empResult.sid ? `sent (${empResult.sid})` : 'failed');
    } else {
      console.log(`[LEAVE] No phone found for ${firstName}, skipping employee SMS`);
    }

    return res.status(200).json({
      ok: true,
      employee: fullName,
      leaveType,
      startDate,
      endDate,
      karenNotified: !!karenResult.sid,
      employeeNotified
    });

  } catch (err) {
    console.error('[LEAVE] Error:', err.message, err.stack);
    return res.status(200).json({ ok: false, error: err.message });
  }
}
