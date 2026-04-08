// Real-time data endpoint for ElevenLabs voice agent tools
// Returns schedule, tasks, flags in plain conversational English

export const config = { api: { bodyParser: true }, maxDuration: 15 };

import { getOpenTasks, getOverdueTasks } from './task-store.js';
import { getCapacityData } from './capacity-check.js';
import { getCallerHistory, getRecentConversations, searchLearnings } from './aria-memory.js';

const TIMEZONE = 'America/Vancouver';

async function fetchSchedule() {
  try {
    const apiKey = process.env.HCP_API_KEY;
    const hcpHeaders = { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' };
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59).toISOString();

    // Fetch today, tomorrow, and KB data in parallel
    const [todayResp, tomorrowResp, clientsResp] = await Promise.all([
      fetch(`https://api.housecallpro.com/jobs?scheduled_start_min=${todayStart}&scheduled_start_max=${todayEnd}&page_size=200`, { headers: hcpHeaders }),
      fetch(`https://api.housecallpro.com/jobs?scheduled_start_min=${tomorrowStart}&scheduled_start_max=${tomorrowEnd}&page_size=200`, { headers: hcpHeaders }),
      fetch('https://lhs-knowledge-base.vercel.app/api/clients').catch(() => null)
    ]);

    const todayJobs = todayResp.ok ? ((await todayResp.json()).jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at) : [];
    const tomorrowJobs = tomorrowResp.ok ? ((await tomorrowResp.json()).jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at) : [];

    // Build client lookup and cleaner roster from KB
    const clientLookup = {};
    let cleanerRoster = [];
    if (clientsResp?.ok) {
      const clientsData = await clientsResp.json();
      for (const c of (clientsData.clients || [])) clientLookup[c.name.toLowerCase()] = c;
      cleanerRoster = (clientsData.cleaners || []).filter(c => c.days && c.days.length > 0);
    }

    // Format a job list into plain English with FULL employee names
    function formatJobs(jobs, dayLabel) {
      if (jobs.length === 0) return `No jobs scheduled for ${dayLabel}.`;

      const inProgress = jobs.filter(j => j.work_status === 'in progress' || j.work_timestamps?.started_at);
      const scheduled = jobs.filter(j => j.work_status === 'scheduled' && !j.work_timestamps?.started_at);
      const completed = jobs.filter(j => j.work_status === 'complete' || j.work_status === 'complete unrated');
      const unassigned = jobs.filter(j => !j.assigned_employees || j.assigned_employees.length === 0);

      let text = `${dayLabel}: ${jobs.length} jobs. `;
      if (inProgress.length > 0) text += `${inProgress.length} in progress. `;
      if (scheduled.length > 0) text += `${scheduled.length} scheduled. `;
      if (completed.length > 0) text += `${completed.length} completed. `;
      if (unassigned.length > 0) text += `WARNING: ${unassigned.length} jobs have NO cleaner assigned! `;

      text += '\n';
      for (const job of jobs) {
        const clientName = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim() || 'Unknown client';
        // FULL names — first AND last for every employee
        const empNames = (job.assigned_employees || []).map(e => `${e.first_name} ${e.last_name}`.trim());
        const employees = empNames.length > 0 ? empNames.join(' and ') : 'NO CLEANER ASSIGNED';
        const startTime = job.schedule?.scheduled_start
          ? new Date(job.schedule.scheduled_start).toLocaleTimeString('en-CA', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' })
          : 'no time set';
        const addr = job.address?.street || '';
        const city = job.address?.city || '';
        const status = job.work_status || 'scheduled';

        const prefs = clientLookup[clientName.toLowerCase()];
        let notes = '';
        if (prefs?.priority === 'High') notes += ' HIGH PRIORITY.';
        if (prefs?.client_type === 'Commercial') notes += ' Commercial.';

        text += `- ${clientName} at ${startTime}, ${addr}${city ? ', ' + city : ''}, assigned to ${employees}, status: ${status}.${notes}\n`;
      }
      return text;
    }

    const todayText = formatJobs(todayJobs, 'TODAY');
    const tomorrowText = formatJobs(tomorrowJobs, 'TOMORROW');

    // Build cleaner roster with EXACT names
    let rosterText = '\nACTIVE CLEANER ROSTER (these are the ONLY employees — never invent names):\n';
    for (const c of cleanerRoster) {
      rosterText += `- ${c.name} — works ${c.days.join(', ')}`;
      if (c.availability_note) rosterText += ` (${c.availability_note})`;
      rosterText += '\n';
    }

    const fullText = todayText + '\n' + tomorrowText + rosterText;

    return { text: fullText, todayJobs, tomorrowJobs, cleanerRoster };
  } catch (err) {
    console.error('[VOICE-DATA] Schedule error:', err.message);
    return { text: 'Sorry, I could not load the schedule right now. Please try again.', todayJobs: [], tomorrowJobs: [], cleanerRoster: [] };
  }
}

async function buildUrgentFlags() {
  const flags = [];
  const overdue = await getOverdueTasks();
  if (overdue.length > 0) {
    flags.push(`${overdue.length} overdue task${overdue.length !== 1 ? 's' : ''} need attention: ${overdue.slice(0, 3).map(t => t.description).join(', ')}`);
  }

  try {
    const cap = await getCapacityData();
    if (cap.capacity >= 90) flags.push(`Workforce is at ${cap.capacity}% capacity — urgent hiring needed.`);
    else if (cap.capacity >= 80) flags.push(`Workforce is at ${cap.capacity}% capacity — time to start hiring.`);
    else if (cap.capacity >= 70) flags.push(`Workforce is at ${cap.capacity}% capacity — hiring should be on the radar.`);
  } catch (e) {}

  return flags;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  if (!process.env.INTERNAL_SECRET || authHeader !== `Bearer ${process.env.INTERNAL_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { action } = req.query;

  try {
    // get_live_data — full real-time context for voice conversations
    if (action === 'live_data' || !action) {
      const [schedule, openTasks, flags] = await Promise.all([
        fetchSchedule(),
        getOpenTasks(),
        buildUrgentFlags()
      ]);

      const taskSummary = openTasks.length > 0
        ? `Karen has ${openTasks.length} open task${openTasks.length !== 1 ? 's' : ''}. Top priorities: ${openTasks.slice(0, 3).map(t => t.description).join(', ')}.`
        : 'No open tasks right now.';

      return res.status(200).json({
        schedule: schedule.text,
        tasks: taskSummary,
        taskCount: openTasks.length,
        urgentFlags: flags,
        todayJobCount: schedule.todayJobs?.length || 0,
        tomorrowJobCount: schedule.tomorrowJobs?.length || 0,
        cleanerCount: schedule.cleanerRoster?.length || 0,
        timestamp: new Date().toLocaleString('en-CA', { timeZone: TIMEZONE })
      });
    }

    // get_caller_history — past conversations with a specific caller
    if (action === 'caller_history') {
      const phone = req.query.phone || req.body?.phone || '';
      const history = await getCallerHistory(phone, 5);
      if (history.length === 0) {
        return res.status(200).json({ text: 'No previous conversations found with this caller.' });
      }
      let text = `I found ${history.length} previous conversation${history.length !== 1 ? 's' : ''} with this caller:\n`;
      for (const c of history) {
        text += `On ${c.date}: ${c.summary}`;
        if (c.actionTaken) text += ` Action taken: ${c.actionTaken}.`;
        text += '\n';
      }
      return res.status(200).json({ text, history });
    }

    // save_learning — store something new Aria learned
    if (action === 'save_learning' && req.method === 'POST') {
      const { saveLearning } = await import('./aria-memory.js');
      const entry = await saveLearning(req.body);
      return res.status(201).json({ text: `Got it, I've noted that down about ${entry.subject}.`, entry });
    }

    // search_knowledge — search learnings and memory
    if (action === 'search_knowledge') {
      const q = req.query.q || req.body?.q || '';
      const results = await searchLearnings(q, 5);
      if (results.length === 0) {
        return res.status(200).json({ text: `I don't have any specific notes about "${q}" yet.` });
      }
      let text = `Here's what I know about "${q}":\n`;
      for (const l of results) {
        text += `${l.date}: ${l.fact}\n`;
      }
      return res.status(200).json({ text, results });
    }

    // get_task_list — Karen's open tasks with priorities
    if (action === 'task_list') {
      const tasks = await getOpenTasks();
      const overdue = await getOverdueTasks();
      if (tasks.length === 0) return res.status(200).json({ text: 'No open tasks right now. Your slate is clean!' });

      let text = `Karen has ${tasks.length} open task${tasks.length !== 1 ? 's' : ''}.`;
      if (overdue.length > 0) text += ` ${overdue.length} overdue!`;
      text += '\n\nTop priorities:\n';
      for (const t of tasks.slice(0, 8)) {
        const flag = t.due_date && t.due_date < new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE }) ? ' OVERDUE' : '';
        text += `• ${t.description}${t.due_date ? ' (due ' + t.due_date + ')' : ''}${flag}\n`;
      }
      if (tasks.length > 8) text += `...and ${tasks.length - 8} more.\n`;
      return res.status(200).json({ text, total: tasks.length, overdueCount: overdue.length });
    }

    // get_capacity — workforce capacity and trend
    if (action === 'capacity') {
      try {
        const cap = await getCapacityData();
        const trendStr = cap.trend > 0 ? `up ${cap.trend}% from last week` : cap.trend < 0 ? `down ${Math.abs(cap.trend)}% from last week` : 'flat from last week';
        let text = `Workforce is at ${cap.capacity}% capacity. ${cap.bookedHours} hours booked out of ${cap.availableHours} available across ${cap.cleanerCount} cleaners. Trend: ${trendStr}.`;
        if (cap.weeksUntilFull) text += ` At this pace, we'll be at full capacity in about ${cap.weeksUntilFull} weeks.`;
        if (cap.capacity >= 90) text += ' This is urgent — we need to hire immediately.';
        else if (cap.capacity >= 80) text += ' I recommend starting the hiring process this week.';
        else if (cap.capacity >= 70) text += ' Good time to start thinking about hiring.';
        return res.status(200).json({ text, ...cap });
      } catch (e) {
        return res.status(200).json({ text: 'Could not load capacity data right now.' });
      }
    }

    // add_task — save a task from voice conversation
    if (action === 'add_task' && req.method === 'POST') {
      const { saveTask } = await import('./task-store.js');
      const task = await saveTask({
        description: req.body.description || 'Task from voice call',
        priority: req.body.priority || 'medium',
        category: req.body.category || 'administrative',
        due_date: req.body.due_date || null,
        assigned_to: 'karen',
        source_message: 'Voice conversation with Aria'
      });
      return res.status(201).json({ text: `Got it! I've saved "${task.description}" as a task.`, task });
    }

    return res.status(400).json({ error: 'Unknown action. Use: live_data, task_list, capacity, caller_history, save_learning, search_knowledge, add_task' });

  } catch (err) {
    console.error('[VOICE-DATA] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
