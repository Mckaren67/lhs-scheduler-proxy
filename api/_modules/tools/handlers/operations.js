// Tool handlers: operations — 5 handlers
// Extracted from incoming-sms.js lines 1201–1409, 1633–1661
// Includes the two highest-risk handlers: approve_stat_holiday_plan and report_sick_day
// (report_sick_day moved to communication.js as it involves SMS cascade)

import { getCapacityData } from '../../../capacity-check.js';
import { executeOffboarding } from '../../../employee-offboarding.js';
import { saveTMOR } from '../../../tmor.js';
import { sendSMS, KAREN_PHONE } from '../../shared/sms.js';
import { hcpHeaders } from '../../shared/hcp.js';
import { fetchWithTimeout, TIMEZONE } from '../../shared/time.js';
import { registerTool } from '../registry.js';

// ─── build_stat_holiday_plan ────────────────────────────────────────────────

async function handleBuildStatHolidayPlan(input, ctx) {
  const { holiday_date, holiday_name } = input;
  console.log(`[STAT-PLAN] Building plan for ${holiday_name} (${holiday_date})`);

  try {
    const start = `${holiday_date}T00:00:00Z`;
    const end = `${holiday_date}T23:59:59Z`;

    const [jobsResp, clientsResp] = await Promise.all([
      fetchWithTimeout(`https://api.housecallpro.com/jobs?scheduled_start_min=${start}&scheduled_start_max=${end}&page_size=200`, { headers: hcpHeaders() }, 10000),
      fetchWithTimeout('https://lhs-knowledge-base.vercel.app/api/clients', {}, 8000)
    ]);

    const jobsData = await jobsResp.json();
    const clientsData = await clientsResp.json();
    const jobs = (jobsData.jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at);
    const clients = clientsData.clients || [];

    if (jobs.length === 0) {
      return `No jobs scheduled on ${holiday_name} (${holiday_date}). Nothing to reschedule! — LHS 🏠`;
    }

    const clientLookup = {};
    for (const c of clients) clientLookup[c.name.toLowerCase()] = c;

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let msg = `📋 Rescheduling plan for ${holiday_name} (${holiday_date}):\n\n`;
    let lockedCount = 0;
    let flexCount = 0;

    for (const job of jobs) {
      const custName = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim();
      const employees = (job.assigned_employees || []).map(e => `${e.first_name} ${e.last_name}`).join(', ') || 'Unassigned';
      const prefs = clientLookup[custName.toLowerCase()];
      const isCommercial = prefs?.client_type === 'Commercial';

      if (isCommercial) {
        lockedCount++;
        msg += `🔒 ${custName} (Commercial) — ${employees}\n   LOCKED: Needs your decision\n`;
      } else {
        flexCount++;
        const beforeDate = new Date(holiday_date + 'T12:00:00Z');
        beforeDate.setDate(beforeDate.getDate() - 1);
        const afterDate = new Date(holiday_date + 'T12:00:00Z');
        afterDate.setDate(afterDate.getDate() + 1);
        const suggestDate = beforeDate.getUTCDay() !== 0 ? beforeDate : afterDate;
        const suggestStr = suggestDate.toISOString().split('T')[0];
        const suggestDay = dayNames[suggestDate.getUTCDay()];
        msg += `✅ ${custName} — ${employees}\n   Suggest: move to ${suggestDay} ${suggestStr}\n`;
      }
    }

    msg += `\n${lockedCount} locked (need your call), ${flexCount} flexible (ready to move).\n`;
    msg += `Reply "approve the plan" and I'll reschedule the flexible ones. Locked ones are up to you! — Aria 🏠`;
    return msg;

  } catch (err) {
    console.error('[STAT-PLAN] Error:', err.message);
    return `Sorry, I couldn't build the rescheduling plan for ${holiday_name}. Please try again! — LHS 🏠`;
  }
}

// ─── approve_stat_holiday_plan (HIGH RISK — HCP writes + SMS cascade) ──────

async function handleApproveStatHolidayPlan(input, ctx) {
  const { holiday_date, holiday_name } = input;
  console.log(`[STAT-APPROVE] Executing approved plan for ${holiday_name} (${holiday_date})`);

  try {
    const headers = hcpHeaders(true);
    const start = `${holiday_date}T00:00:00Z`;
    const end = `${holiday_date}T23:59:59Z`;

    const [jobsResp, clientsResp] = await Promise.all([
      fetchWithTimeout(`https://api.housecallpro.com/jobs?scheduled_start_min=${start}&scheduled_start_max=${end}&page_size=200`, { headers }, 10000),
      fetchWithTimeout('https://lhs-knowledge-base.vercel.app/api/clients', {}, 8000)
    ]);

    const jobsData = await jobsResp.json();
    const clientsData = await clientsResp.json();
    const jobs = (jobsData.jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at);
    const clients = clientsData.clients || [];
    const clientLookup = {};
    for (const c of clients) clientLookup[c.name.toLowerCase()] = c;

    let rescheduled = 0;
    let locked = 0;
    const clientsNotified = [];
    const cleanersNotified = new Map();

    for (const job of jobs) {
      const custName = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim();
      const prefs = clientLookup[custName.toLowerCase()];
      const isCommercial = prefs?.client_type === 'Commercial';

      if (isCommercial) { locked++; continue; }

      // Calculate new date: day before holiday, skip Sunday
      const newDate = new Date(holiday_date + 'T12:00:00Z');
      newDate.setDate(newDate.getDate() - 1);
      if (newDate.getUTCDay() === 0) newDate.setDate(newDate.getDate() - 1);

      const origStart = new Date(job.schedule?.scheduled_start);
      const origEnd = new Date(job.schedule?.scheduled_end);
      const duration = origEnd - origStart;
      const newStart = new Date(newDate.toISOString().split('T')[0] + 'T' + origStart.toISOString().split('T')[1]);
      const newEnd = new Date(newStart.getTime() + duration);

      try {
        const schedResp = await fetch(`https://api.housecallpro.com/jobs/${job.id}/schedule`, {
          method: 'PUT', headers,
          body: JSON.stringify({ start_time: newStart.toISOString(), end_time: newEnd.toISOString() })
        });

        if (schedResp.ok) {
          rescheduled++;
          const newDateStr = newDate.toLocaleDateString('en-CA', { timeZone: TIMEZONE, month: 'long', day: 'numeric', weekday: 'long' });

          const clientPhone = job.customer?.mobile_number || job.customer?.home_number;
          if (clientPhone) {
            await sendSMS(clientPhone,
              `Hi ${job.customer.first_name}! Your cleaning on ${holiday_name} has been moved to ${newDateStr}. Same time, same great service! Questions? Call us at 604-260-1925. — LHS 🏠`
            );
            clientsNotified.push(custName);
          }

          for (const emp of (job.assigned_employees || [])) {
            if (emp.mobile_number && !cleanersNotified.has(emp.mobile_number)) {
              cleanersNotified.set(emp.mobile_number, {
                name: `${emp.first_name} ${emp.last_name}`.trim(),
                phone: emp.mobile_number
              });
            }
          }
        } else {
          console.error(`[STAT-APPROVE] Reschedule failed for ${job.id}:`, await schedResp.text());
        }
      } catch (err) {
        console.error(`[STAT-APPROVE] Error rescheduling ${job.id}:`, err.message);
      }
    }

    // Notify all affected cleaners
    const cleanerNames = [];
    for (const [phone, cleaner] of cleanersNotified) {
      const result = await sendSMS(phone,
        `Hi ${cleaner.name.split(' ')[0]}! Some of your ${holiday_name} jobs have been rescheduled. Please check HouseCall Pro for your updated schedule. Questions? Text back or call Karen. — LHS 🏠`
      );
      if (result.sid) cleanerNames.push(cleaner.name);
    }

    let msg = `Done! ${holiday_name} rescheduling complete:\n\n`;
    msg += `✅ ${rescheduled} job${rescheduled !== 1 ? 's' : ''} rescheduled\n`;
    if (locked > 0) msg += `🔒 ${locked} commercial job${locked !== 1 ? 's' : ''} still need your decision\n`;
    if (clientsNotified.length > 0) msg += `📱 ${clientsNotified.length} client${clientsNotified.length !== 1 ? 's' : ''} notified\n`;
    if (cleanerNames.length > 0) msg += `👷 Cleaners notified: ${cleanerNames.join(', ')}\n`;
    msg += `\n— Aria 🏠`;

    console.log(`[STAT-APPROVE] Complete: ${rescheduled} rescheduled, ${locked} locked, ${clientsNotified.length} clients notified, ${cleanerNames.length} cleaners notified`);
    return msg;

  } catch (err) {
    console.error('[STAT-APPROVE] Error:', err.message);
    return `Sorry, something went wrong executing the rescheduling plan. Please try again! — LHS 🏠`;
  }
}

// ─── check_capacity ─────────────────────────────────────────────────────────

async function handleCheckCapacity(input, ctx) {
  console.log('[CAPACITY] Checking capacity via SMS tool');

  try {
    const cap = await getCapacityData();
    const trendStr = cap.trend > 0 ? `📈 up ${cap.trend}%` : cap.trend < 0 ? `📉 down ${Math.abs(cap.trend)}%` : '➡️ flat';

    let msg = `📊 Workforce Capacity: ${cap.capacity}%\n\n`;
    msg += `${cap.bookedHours}h booked / ${cap.availableHours}h available this week\n`;
    msg += `${cap.jobCount} jobs across ${cap.cleanerCount} active cleaners\n`;
    msg += `Trend: ${trendStr} from last week\n`;
    if (cap.weeksUntilFull) {
      msg += `At this pace, full capacity in ~${cap.weeksUntilFull} week${cap.weeksUntilFull !== 1 ? 's' : ''}\n`;
    }

    if (cap.capacity >= 90) msg += `\n🔴 Critical — hiring needed immediately!`;
    else if (cap.capacity >= 80) msg += `\n🟠 Time to start the hiring process.`;
    else if (cap.capacity >= 70) msg += `\n🟡 Keep an eye on it — hiring soon.`;
    else msg += `\n💚 Healthy — room to grow!`;
    return msg + ` — LHS 🏠`;
  } catch (err) {
    console.error('[CAPACITY] Check failed:', err.message);
    return `Sorry, I couldn't pull the capacity data right now. Please try again! — LHS 🏠`;
  }
}

// ─── save_tmor ──────────────────────────────────────────────────────────────

async function handleSaveTmor(input, ctx) {
  const { description } = input;
  console.log(`[TMOR] Saving report: ${description.substring(0, 60)}`);

  try {
    const result = await saveTMOR({ description, adminPhone: ctx.from });
    let msg = `TMOR saved! I've analyzed your morning report and sent Michael a summary.\n\n`;
    msg += result.analysis.substring(0, 300);
    if (result.sopMatch) msg += `\n\n${result.sopMatch}`;
    return msg + `\n\n— Aria 🏠`;
  } catch (err) {
    console.error('[TMOR] Failed:', err.message);
    return `I had trouble saving the TMOR. I'll note what you said and try again. — LHS 🏠`;
  }
}

// ─── offboard_employee ──────────────────────────────────────────────────────

async function handleOffboardEmployee(input, ctx) {
  const { employee_name, last_day } = input;
  console.log(`[OFFBOARD] Tool: ${employee_name}, last day ${last_day || 'unknown'}`);

  try {
    const result = await executeOffboarding({ employeeName: employee_name, lastDay: last_day || 'Unknown', adminPhone: ctx.from });
    if (result.ok) {
      return `Understood. Starting offboarding for ${employee_name} now. Last day recorded as ${last_day || 'unknown'}. ROE email ${result.roeEmailSent ? 'sent' : 'failed'} to Bill Gee. I've sent you the full checklist. — LHS 🏠`;
    } else {
      return `I had trouble with the offboarding for ${employee_name}. Error: ${result.error}. — LHS 🏠`;
    }
  } catch (err) {
    console.error('[OFFBOARD] Failed:', err.message);
    return `Sorry, the offboarding process hit an error. I'll note this and Karen can follow up manually. — LHS 🏠`;
  }
}

// Wire handlers into registry
registerTool('build_stat_holiday_plan', null, handleBuildStatHolidayPlan);
registerTool('approve_stat_holiday_plan', null, handleApproveStatHolidayPlan);
registerTool('check_capacity', null, handleCheckCapacity);
registerTool('save_tmor', null, handleSaveTmor);
registerTool('offboard_employee', null, handleOffboardEmployee);
