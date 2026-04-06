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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Authenticate — only internal calls allowed
  const authHeader = req.headers.authorization || '';
  const expectedToken = process.env.INTERNAL_SECRET;
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    console.error('[BULK-NOTES] Unauthorized request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { clientName, noteContent, dateRangeStart, dateRangeEnd, adminPhone, timestamp } = req.body || {};

  if (!clientName || !noteContent) {
    return res.status(400).json({ error: 'Missing clientName or noteContent' });
  }

  const dateStr = timestamp ? new Date(timestamp).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  const formattedNote = `[${dateStr} via Aria] ${noteContent}`;

  console.log(`[BULK-NOTES] Starting: "${noteContent}" for ${clientName} (${dateRangeStart} to ${dateRangeEnd})`);

  try {
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
      if (adminPhone) {
        await sendSMS(adminPhone, `Sorry, I couldn't fetch the schedule to add notes for ${clientName}. HCP returned an error. Please try again or add manually. — LHS 🏠`);
      }
      return res.status(502).json({ error: 'HCP fetch failed' });
    }

    const jobsData = await jobsResponse.json();
    const allJobs = jobsData.jobs || [];

    // 2. Filter by client name (case-insensitive partial match)
    const searchLower = clientName.toLowerCase();
    const matchedJobs = allJobs.filter(job => {
      const custName = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim().toLowerCase();
      const isActive = job.work_status !== 'pro canceled' && !job.deleted_at;
      return isActive && (custName.includes(searchLower) || searchLower.includes(custName));
    });

    console.log(`[BULK-NOTES] Found ${matchedJobs.length} matching jobs for "${clientName}" out of ${allJobs.length} total`);

    if (matchedJobs.length === 0) {
      if (adminPhone) {
        await sendSMS(adminPhone, `No upcoming jobs found for "${clientName}" in the next ${Math.round((new Date(end) - new Date(start)) / 86400000)} days. Double-check the name? — LHS 🏠`);
      }
      return res.status(200).json({ matched: 0, noted: 0, notified: [] });
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
        }).then(r => ({ jobId: job.id, status: r.status, ok: r.ok }))
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
    const smsResults = await Promise.allSettled(
      cleaners.map(cleaner => {
        // Format phone as E.164 for Twilio
        const toPhone = cleaner.phone.startsWith('+') ? cleaner.phone :
          cleaner.phone.length === 10 ? `+1${cleaner.phone}` : `+${cleaner.phone}`;

        return sendSMS(toPhone,
          `Hi ${cleaner.name.split(' ')[0]}, there's been an update to the job notes for ${clientName}. Please review before your next visit. — LHS 🏠`
        ).then(result => {
          if (result.sid) {
            notified.push(cleaner.name);
          } else {
            notifyFailed.push(cleaner.name);
          }
          return result;
        });
      })
    );

    // 6. Confirm back to Karen
    if (adminPhone) {
      const rangeDays = Math.round((new Date(end) - new Date(start)) / 86400000);
      let confirmMsg = `Done! Added note to ${succeeded} ${clientName} job${succeeded !== 1 ? 's' : ''} (next ${rangeDays} days).`;
      if (failed > 0) confirmMsg += ` ${failed} failed.`;
      if (notified.length > 0) confirmMsg += ` Notified: ${notified.join(', ')}.`;
      if (notifyFailed.length > 0) confirmMsg += ` Could not reach: ${notifyFailed.join(', ')}.`;
      confirmMsg += ' — LHS 🏠';

      await sendSMS(adminPhone, confirmMsg);
      console.log('[BULK-NOTES] Confirmation sent to admin:', confirmMsg);
    }

    return res.status(200).json({
      matched: matchedJobs.length,
      noted: succeeded,
      failed: failed,
      notified: notified,
      notifyFailed: notifyFailed
    });

  } catch (err) {
    console.error('[BULK-NOTES] Fatal error:', err.message, err.stack);
    if (adminPhone) {
      await sendSMS(adminPhone, `Something went wrong adding notes for ${clientName}. Error: ${err.message}. Please try again. — LHS 🏠`).catch(() => {});
    }
    return res.status(500).json({ error: err.message });
  }
}
