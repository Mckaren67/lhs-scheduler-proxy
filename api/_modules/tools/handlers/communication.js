// Tool handlers: communication — 3 handlers
// Extracted from incoming-sms.js lines 1428–1453, 1612–1631, 1455–1610

import { sendEmail, saveDraft, lookupClientEmail, isSensitiveTopic } from '../../../aria-email.js';
import { makeCall, lookupClientPhone } from '../../../aria-call.js';
import { saveLearning } from '../../../aria-memory.js';
import { logSickDay, detectPatterns } from '../../../sick-day-log.js';
import { sendSMS, KAREN_PHONE } from '../../shared/sms.js';
import { hcpHeaders } from '../../shared/hcp.js';
import { fetchWithTimeout, TIMEZONE } from '../../shared/time.js';
import { registerTool } from '../registry.js';

// ─── send_email ─────────────────────────────────────────────────────────────

async function handleSendEmail(input, ctx) {
  const { client_name, to_email, subject, body, force_draft } = input;
  console.log(`[EMAIL] Tool: ${client_name || to_email} — "${subject}"`);

  try {
    let email = to_email;
    if (!email && client_name) email = await lookupClientEmail(client_name);
    if (!email) return `I couldn't find an email address for ${client_name || 'that contact'}. Can you give me the email? — LHS 🏠`;

    const sensitive = force_draft || isSensitiveTopic(subject, body);
    if (sensitive) {
      await saveDraft({ to: email, subject, body });
      return `I've saved a draft email to ${client_name || email} about "${subject}". Please review in your Gmail drafts before sending. — LHS 🏠`;
    } else {
      await sendEmail({ to: email, subject, body });
      return `Done! I emailed ${client_name || email} about "${subject}". — LHS 🏠`;
    }
  } catch (err) {
    console.error('[EMAIL] Failed:', err.message);
    return `Sorry, I couldn't send that email. Error: ${err.message.substring(0, 80)}. — LHS 🏠`;
  }
}

// ─── call_client ────────────────────────────────────────────────────────────

async function handleCallClient(input, ctx) {
  const { client_name, message } = input;
  console.log(`[CALL] Tool: calling ${client_name}`);

  try {
    const phone = await lookupClientPhone(client_name);
    if (!phone) return `I couldn't find a phone number for ${client_name} in HouseCall Pro. Can you give me their number? — LHS 🏠`;

    const result = await makeCall({ to: phone, message, callerName: client_name });
    if (result.called) {
      return `Done! I'm calling ${client_name} now to deliver your message. I'll leave a voicemail if they don't answer. — LHS 🏠`;
    } else {
      return `Sorry, I couldn't reach ${client_name}: ${result.error}. — LHS 🏠`;
    }
  } catch (err) {
    console.error('[CALL] Failed:', err.message);
    return `Sorry, the call to ${client_name} failed. — LHS 🏠`;
  }
}

// ─── report_sick_day (highest complexity — full cascade) ────────────────────

async function handleReportSickDay(input, ctx) {
  const { cleaner_name } = input;
  console.log(`[SICK-DAY] Processing sick day for ${cleaner_name}`);

  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

    // Fetch today's jobs and client/cleaner data in parallel
    const [jobsResp, clientsResp] = await Promise.all([
      fetchWithTimeout(`https://api.housecallpro.com/jobs?scheduled_start_min=${startOfDay}&scheduled_start_max=${endOfDay}&page_size=200`, { headers: hcpHeaders() }, 10000),
      fetchWithTimeout('https://lhs-knowledge-base.vercel.app/api/clients', {}, 8000)
    ]);

    const jobsData = await jobsResp.json();
    const clientsData = await clientsResp.json();
    const allJobs = (jobsData.jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at);
    const cleaners = clientsData.cleaners || [];
    const clients = clientsData.clients || [];

    // Find jobs assigned to the sick cleaner
    const sickJobs = allJobs.filter(j =>
      (j.assigned_employees || []).some(e =>
        `${e.first_name} ${e.last_name}`.trim().toLowerCase().includes(cleaner_name.toLowerCase())
      )
    );

    if (sickJobs.length === 0) {
      await logSickDay({ cleanerName: cleaner_name, cleanerPhone: ctx.from, jobsAffected: 0, resolution: 'no_jobs' });
      await sendSMS(KAREN_PHONE, `${cleaner_name} called in sick today but has no jobs assigned. No action needed. — Aria 🏠`);
      return `Hi ${cleaner_name.split(' ')[0]}! Sorry you're not feeling well. Good news — you don't have any jobs assigned today so rest easy. I'll let Karen know. — LHS 🏠`;
    }

    // Build client lookup
    const clientLookup = {};
    for (const c of clients) clientLookup[c.name.toLowerCase()] = c;

    // Find available replacements
    const dayName = now.toLocaleDateString('en-CA', { timeZone: TIMEZONE, weekday: 'long' });
    const hour = now.getHours();
    const availableCleaners = cleaners.filter(c => {
      if (!c.days || !c.days.includes(dayName)) return false;
      if (c.name.toLowerCase().includes(cleaner_name.toLowerCase())) return false;
      if (c.name === 'Brandi M' && dayName !== 'Friday' && hour >= 14) return false;
      if (c.name === 'Kristen K' && dayName !== 'Saturday') return false;
      return true;
    });

    // Build replacement suggestions for each job
    const jobSuggestions = [];
    const affectedClientNames = [];

    for (const job of sickJobs) {
      const custName = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim();
      affectedClientNames.push(custName);
      const prefs = clientLookup[custName.toLowerCase()];
      const startTime = job.schedule?.scheduled_start
        ? new Date(job.schedule.scheduled_start).toLocaleTimeString('en-CA', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' })
        : '?';

      // Find best replacement: preferred cleaner first, then least-loaded
      let suggested = null;
      if (prefs?.preferred_cleaner) {
        const prefNames = prefs.preferred_cleaner.split(',').map(n => n.trim().toLowerCase());
        suggested = availableCleaners.find(c => prefNames.some(pn => c.name.toLowerCase().includes(pn.split(' ')[0])));
      }
      if (!suggested && availableCleaners.length > 0) {
        const loadMap = {};
        for (const j of allJobs) {
          for (const e of (j.assigned_employees || [])) {
            const n = `${e.first_name} ${e.last_name}`.trim();
            loadMap[n] = (loadMap[n] || 0) + 1;
          }
        }
        suggested = availableCleaners.sort((a, b) => (loadMap[a.name] || 0) - (loadMap[b.name] || 0))[0];
      }

      const isHighPri = prefs?.priority === 'High';
      const isCommercial = prefs?.client_type === 'Commercial';

      jobSuggestions.push({
        jobId: job.id, client: custName, time: startTime,
        address: job.address?.street || '', suggested: suggested?.name || null,
        needsKaren: isCommercial || !suggested, isHighPri, isCommercial
      });
    }

    // Log the sick day
    await logSickDay({
      cleanerName: cleaner_name, cleanerPhone: ctx.from, jobsAffected: sickJobs.length,
      affectedClients: affectedClientNames,
      replacements: jobSuggestions.map(j => ({ client: j.client, suggested: j.suggested })),
      resolution: 'pending'
    });

    // Check for patterns
    const patterns = await detectPatterns(cleaner_name);

    // Build Karen's summary
    const autoAssign = jobSuggestions.filter(j => !j.needsKaren && j.suggested);
    const needsKaren = jobSuggestions.filter(j => j.needsKaren);
    const highPri = jobSuggestions.filter(j => j.isHighPri);

    let karenMsg = `🤒 ${cleaner_name} called in sick. ${sickJobs.length} job${sickJobs.length !== 1 ? 's' : ''} affected today.\n\n`;

    if (highPri.length > 0) {
      karenMsg += `⚡ HIGH PRIORITY:\n`;
      for (const j of highPri) karenMsg += `• ${j.client} at ${j.time} → ${j.suggested || 'NO REPLACEMENT'}\n`;
      karenMsg += '\n';
    }
    if (autoAssign.length > 0) {
      karenMsg += `✅ Can auto-assign (${autoAssign.length}):\n`;
      for (const j of autoAssign) karenMsg += `• ${j.client} at ${j.time} → ${j.suggested}\n`;
      karenMsg += '\n';
    }
    if (needsKaren.length > 0) {
      karenMsg += `🔒 Need your decision (${needsKaren.length}):\n`;
      for (const j of needsKaren) karenMsg += `• ${j.client} at ${j.time}${j.isCommercial ? ' (Commercial)' : ''}\n`;
      karenMsg += '\n';
    }
    if (patterns.length > 0) {
      karenMsg += `⚠️ Pattern alert: ${patterns[0].message}\n\n`;
    }
    karenMsg += `Reply "approve" to auto-assign the ${autoAssign.length} suggested replacements. — Aria 🏠`;

    await sendSMS(KAREN_PHONE, karenMsg);

    // Save learning (non-blocking)
    saveLearning({
      subject: cleaner_name, category: 'cleaner',
      fact: `Called in sick on ${now.toLocaleDateString('en-CA', { timeZone: TIMEZONE })}. ${sickJobs.length} jobs affected.`,
      source: 'sick_day_report'
    }).catch(() => {});

    return `Hi ${cleaner_name.split(' ')[0]}! Sorry to hear you're not well. I've noted your absence and will take care of notifying your ${sickJobs.length} client${sickJobs.length !== 1 ? 's' : ''} today. Please rest up and feel better soon! — LHS 🏠`;

  } catch (err) {
    console.error('[SICK-DAY] Error:', err.message);
    return `Hi ${cleaner_name.split(' ')[0]}! Sorry you're not feeling well. I've noted your absence — Karen will be in touch. Rest up! — LHS 🏠`;
  }
}

// Wire handlers into registry
registerTool('send_email', null, handleSendEmail);
registerTool('call_client', null, handleCallClient);
registerTool('report_sick_day', null, handleReportSickDay);
