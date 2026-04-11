// Tool handlers: scheduling — 4 handlers
// Extracted from incoming-sms.js lines 1663–1777

import { fetchJobsForDate } from '../../schedule/fetch.js';
import { formatDateFriendly } from '../../shared/time.js';
import { analyzeSchedule } from '../../../scheduling-intelligence.js';
import { saveLearning } from '../../../aria-memory.js';
import { sendSMS } from '../../shared/sms.js';
import { hcpHeaders } from '../../shared/hcp.js';
import { fetchWithTimeout } from '../../shared/time.js';
import { registerTool } from '../registry.js';

// ─── fetch_day_schedule ─────────────────────────────────────────────────────

async function handleFetchDaySchedule(input, ctx) {
  const { date } = input;
  console.log(`[HCP] fetch_day_schedule tool called for: ${date}`);

  try {
    const result = await fetchJobsForDate(date);
    const friendly = formatDateFriendly(date);
    if (result.jobs.length === 0) {
      return `I don't see any jobs scheduled for ${friendly} yet. Would you like me to check a different date? — LHS 🏠`;
    }
    return `${friendly} has ${result.jobs.length} jobs scheduled:\n${result.schedule.split('\n').slice(1).join('\n')}\n\n— LHS 🏠`;
  } catch (err) {
    console.error('[HCP] fetch_day_schedule error:', err.message);
    return `Sorry, I couldn't pull the schedule for that date. Try again? — LHS 🏠`;
  }
}

// ─── get_schedule_intelligence ──────────────────────────────────────────────

async function handleGetScheduleIntelligence(input, ctx) {
  console.log('[SCHED-INTEL] Running schedule analysis via tool');

  try {
    const result = await analyzeSchedule();
    const topInsights = result.insights.slice(0, 3);
    const topRecs = result.recommendations.slice(0, 2);

    let msg = `Here's what I see for the next 7 days (${result.jobCount} jobs):\n\n`;
    if (topInsights.length > 0) {
      for (const i of topInsights) msg += `• ${i}\n`;
    }
    if (topRecs.length > 0) {
      msg += `\nI'd recommend:\n`;
      for (const r of topRecs) msg += `• ${r}\n`;
    }
    if (topInsights.length === 0 && topRecs.length === 0) {
      msg += `Everything looks great — no conflicts or issues this week!`;
    }
    return msg + `\nWant me to dig into any of these? — LHS 🏠`;
  } catch (err) {
    console.error('[SCHED-INTEL] Error:', err.message);
    return `Sorry, I couldn't analyze the schedule right now. Please try again! — LHS 🏠`;
  }
}

// ─── suggest_schedule_change ────────────────────────────────────────────────

async function handleSuggestScheduleChange(input, ctx) {
  const { client_name, change_type, current_state, proposed_state, reason } = input;
  console.log(`[SCHED-CHANGE] Suggesting: ${client_name} — ${change_type}`);

  let msg = `I'd like to suggest a change:\n\n`;
  msg += `Client: ${client_name}\n`;
  msg += `Currently: ${current_state}\n`;
  msg += `Proposed: ${proposed_state}\n`;
  msg += `Reason: ${reason}\n\n`;
  msg += `Want me to go ahead with this? — LHS 🏠`;

  // Save the suggestion as a learning so Aria remembers it
  saveLearning({
    subject: client_name, category: 'scheduling',
    fact: `Suggested ${change_type}: ${current_state} → ${proposed_state}. Reason: ${reason}`,
    source: 'schedule_intelligence'
  }).catch(() => {});

  return msg;
}

// ─── implement_schedule_change ──────────────────────────────────────────────

async function handleImplementScheduleChange(input, ctx) {
  const { job_id, new_date, new_start_time, new_end_time } = input;
  console.log(`[SCHED-CHANGE] Implementing: ${job_id} → ${new_date} ${new_start_time || ''}`);

  try {
    const startISO = new_start_time
      ? `${new_date}T${new_start_time}:00-07:00`
      : `${new_date}T09:00:00-07:00`;
    const endISO = new_end_time
      ? `${new_date}T${new_end_time}:00-07:00`
      : `${new_date}T11:00:00-07:00`;

    const resp = await fetch(`https://api.housecallpro.com/jobs/${job_id}/schedule`, {
      method: 'PUT',
      headers: hcpHeaders(true),
      body: JSON.stringify({ start_time: startISO, end_time: endISO })
    });

    if (resp.ok) {
      // Notify the assigned cleaner
      const jobResp = await fetchWithTimeout(`https://api.housecallpro.com/jobs/${job_id}`, { headers: hcpHeaders() });
      const jobData = await jobResp.json();
      const custName = `${jobData.customer?.first_name || ''} ${jobData.customer?.last_name || ''}`.trim();

      for (const emp of (jobData.assigned_employees || [])) {
        if (emp.mobile_number) {
          const phone = emp.mobile_number.length === 10 ? `+1${emp.mobile_number}` : `+${emp.mobile_number}`;
          await sendSMS(phone,
            `Hi ${emp.first_name}, the ${custName} job has been moved to ${new_date}. Please check HouseCall Pro for your updated schedule. — LHS 🏠`
          );
        }
      }

      // Save as a learning
      saveLearning({
        subject: custName, category: 'scheduling',
        fact: `Job rescheduled to ${new_date}${new_start_time ? ' at ' + new_start_time : ''}. Karen approved.`,
        source: 'schedule_change'
      }).catch(() => {});

      return `Done! Moved ${custName} to ${new_date}. The cleaner has been notified. — LHS 🏠`;
    } else {
      const errText = await resp.text();
      console.error(`[SCHED-CHANGE] HCP error: ${resp.status} ${errText}`);
      return `Sorry, I couldn't update that job in HCP. Error: ${resp.status}. Please try manually. — LHS 🏠`;
    }
  } catch (err) {
    console.error('[SCHED-CHANGE] Error:', err.message);
    return `Sorry, something went wrong with the schedule change. Please try again! — LHS 🏠`;
  }
}

// Wire handlers into registry
registerTool('fetch_day_schedule', null, handleFetchDaySchedule);
registerTool('get_schedule_intelligence', null, handleGetScheduleIntelligence);
registerTool('suggest_schedule_change', null, handleSuggestScheduleChange);
registerTool('implement_schedule_change', null, handleImplementScheduleChange);
