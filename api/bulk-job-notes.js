export const config = { api: { bodyParser: true } };

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

// Core logic — exported so incoming-sms.js can call it directly (no HTTP self-call)
export async function executeBulkNotes({ clientName, noteContent, dateRangeStart, dateRangeEnd, adminPhone, timestamp }) {
  if (!clientName || !noteContent) {
    return { error: 'Missing clientName or noteContent', matched: 0, noted: 0, notified: [] };
  }

  const dateStr = timestamp ? new Date(timestamp).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  const formattedNote = `[${dateStr} via Aria] ${noteContent}`;

  console.log(`[BULK-NOTES] Starting: "${noteContent}" for ${clientName}`);

  // 1. Fetch jobs from HCP for the date range
  const apiKey = process.env.HCP_API_KEY;
  const start = dateRangeStart || new Date().toISOString();
  const end = dateRangeEnd || new Date(Date.now() + 90 * 86400000).toISOString();

  const jobsUrl = `https://api.housecallpro.com/jobs?scheduled_start_min=${start}&scheduled_start_max=${end}&page_size=200`;
  console.log('[BULK-NOTES] Fetching jobs:', jobsUrl);
  const jobsResponse = await fetch(jobsUrl, {
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });

  if (!jobsResponse.ok) {
    const errText = await jobsResponse.text();
    console.error('[BULK-NOTES] HCP fetch failed:', jobsResponse.status, errText);
    return { error: 'HCP fetch failed', matched: 0, noted: 0, notified: [] };
  }

  const jobsData = await jobsResponse.json();
  const allJobs = jobsData.jobs || [];

  // 2. Filter by client name (strict matching)
  const searchLower = clientName.toLowerCase().trim();
  const searchParts = searchLower.split(/\s+/);
  const matchedJobs = allJobs.filter(job => {
    const firstName = (job.customer?.first_name || '').trim().toLowerCase();
    const lastName = (job.customer?.last_name || '').trim().toLowerCase();
    const fullName = `${firstName} ${lastName}`.trim();
    if (!fullName) return false;
    const isActive = job.work_status !== 'pro canceled' && !job.deleted_at;
    if (!isActive) return false;

    if (fullName === searchLower) return true;
    if (searchParts.length >= 2 && firstName && lastName) {
      if (searchParts.includes(firstName) && searchParts.includes(lastName)) return true;
    }
    if (searchParts.length === 1) {
      if (firstName === searchLower || lastName === searchLower) return true;
    }
    return false;
  });

  console.log(`[BULK-NOTES] Found ${matchedJobs.length} matching jobs for "${clientName}" out of ${allJobs.length} total`);
  for (const job of matchedJobs) {
    const jName = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim();
    console.log(`[BULK-NOTES]   Match: ${job.id} | "${jName}" | ${job.work_status} | ${job.schedule?.scheduled_start}`);
  }

  if (matchedJobs.length === 0) {
    return { matched: 0, noted: 0, notified: [], notifyFailed: [] };
  }

  // 3. Add note to each matching job (parallel)
  const noteResults = await Promise.allSettled(
    matchedJobs.map(job =>
      fetch(`https://api.housecallpro.com/jobs/${job.id}/notes`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ content: formattedNote })
      }).then(async r => {
        const body = await r.text();
        console.log(`[BULK-NOTES]   Note POST ${job.id}: HTTP ${r.status} ${r.ok ? 'OK' : 'FAIL'} — ${body.substring(0, 200)}`);
        return { jobId: job.id, status: r.status, ok: r.ok };
      })
    )
  );

  const succeeded = noteResults.filter(r => r.status === 'fulfilled' && r.value.ok).length;
  const failed = matchedJobs.length - succeeded;
  console.log(`[BULK-NOTES] Notes added: ${succeeded}/${matchedJobs.length} (${failed} failed)`);

  // 4. Collect unique assigned cleaners
  const cleanerMap = {};
  for (const job of matchedJobs) {
    for (const emp of (job.assigned_employees || [])) {
      const phone = emp.mobile_number;
      if (phone && !cleanerMap[phone]) {
        cleanerMap[phone] = {
          name: `${emp.first_name} ${emp.last_name}`.trim(),
          phone: phone
        };
      }
    }
  }

  const cleaners = Object.values(cleanerMap);
  console.log(`[BULK-NOTES] Notifying ${cleaners.length} cleaner(s):`, cleaners.map(c => c.name).join(', '));

  // 5. SMS each cleaner
  const notified = [];
  const notifyFailed = [];
  for (const cleaner of cleaners) {
    try {
      const toPhone = cleaner.phone.startsWith('+') ? cleaner.phone :
        cleaner.phone.length === 10 ? `+1${cleaner.phone}` : `+${cleaner.phone}`;

      const result = await sendSMS(toPhone,
        `Hi ${cleaner.name.split(' ')[0]}, there's been an update to the job notes for ${clientName}. Please review before your next visit. — LHS 🏠`
      );
      if (result.sid) {
        notified.push(cleaner.name);
        console.log(`[BULK-NOTES] SMS sent to ${cleaner.name} (${toPhone}): SID ${result.sid}`);
      } else {
        notifyFailed.push(cleaner.name);
        console.error(`[BULK-NOTES] SMS failed for ${cleaner.name}:`, JSON.stringify(result));
      }
    } catch (err) {
      notifyFailed.push(cleaner.name);
      console.error(`[BULK-NOTES] SMS error for ${cleaner.name}:`, err.message);
    }
  }

  console.log(`[BULK-NOTES] Complete: ${succeeded} noted, ${failed} failed, notified: ${notified.join(', ') || 'none'}`);

  return {
    matched: matchedJobs.length,
    noted: succeeded,
    failed: failed,
    notified: notified,
    notifyFailed: notifyFailed
  };
}

// HTTP handler — kept for direct API testing via curl
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const expectedToken = process.env.INTERNAL_SECRET;
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await executeBulkNotes(req.body || {});
    return res.status(result.error ? 502 : 200).json(result);
  } catch (err) {
    console.error('[BULK-NOTES] Fatal error:', err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
}
