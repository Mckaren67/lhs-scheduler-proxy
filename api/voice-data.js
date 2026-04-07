// Real-time data endpoint for ElevenLabs voice agent tools
// Returns schedule, tasks, flags in plain conversational English

export const config = { api: { bodyParser: true }, maxDuration: 15 };

import { getOpenTasks, getOverdueTasks } from './task-store.js';
import { getCapacityData } from './capacity-check.js';
import { getCallerHistory, getRecentConversations, searchLearnings } from './aria-memory.js';

const TIMEZONE = 'America/Vancouver';

async function fetchTodaySchedule() {
  try {
    const apiKey = process.env.HCP_API_KEY;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

    // Fetch HCP jobs and KB client prefs in parallel
    const [jobsResp, clientsResp] = await Promise.all([
      fetch(`https://api.housecallpro.com/jobs?scheduled_start_min=${start}&scheduled_start_max=${end}&page_size=200`,
        { headers: { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' } }),
      fetch('https://lhs-knowledge-base.vercel.app/api/clients').catch(() => null)
    ]);

    if (!jobsResp.ok) return { text: 'Could not fetch the schedule right now.', jobs: [] };
    const jobsData = await jobsResp.json();
    const jobs = (jobsData.jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at);

    // Build client preference lookup
    const clientLookup = {};
    if (clientsResp?.ok) {
      const clientsData = await clientsResp.json();
      for (const c of (clientsData.clients || [])) {
        clientLookup[c.name.toLowerCase()] = c;
      }
    }

    if (jobs.length === 0) return { text: 'No jobs scheduled today.', jobs: [] };

    const inProgress = jobs.filter(j => j.work_status === 'in progress' || j.work_timestamps?.started_at);
    const scheduled = jobs.filter(j => j.work_status === 'scheduled' && !j.work_timestamps?.started_at);
    const completed = jobs.filter(j => j.work_status === 'complete' || j.work_status === 'complete unrated');

    let text = `There are ${jobs.length} jobs today. `;
    if (inProgress.length > 0) text += `${inProgress.length} in progress. `;
    if (scheduled.length > 0) text += `${scheduled.length} still to go. `;
    if (completed.length > 0) text += `${completed.length} completed. `;

    text += '\n\nJob details:\n';
    for (const job of jobs) {
      const name = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim();
      const employees = (job.assigned_employees || []).map(e => `${e.first_name}`).join(' and ') || 'unassigned';
      const startTime = job.schedule?.scheduled_start
        ? new Date(job.schedule.scheduled_start).toLocaleTimeString('en-CA', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' })
        : 'no time set';
      const addr = job.address?.street || '';
      const city = job.address?.city || '';
      const status = job.work_status || 'scheduled';

      // Enrich with client preferences
      const prefs = clientLookup[name.toLowerCase()];
      let prefNote = '';
      if (prefs) {
        if (prefs.priority === 'High') prefNote += ' High priority client.';
        if (prefs.preferred_cleaner && !employees.toLowerCase().includes(prefs.preferred_cleaner.split(' ')[0].toLowerCase())) {
          prefNote += ` Note: preferred cleaner is ${prefs.preferred_cleaner}.`;
        }
        if (prefs.client_type === 'Commercial') prefNote += ' Commercial account.';
      }

      text += `${name}, ${addr}${city ? ' in ' + city : ''}, at ${startTime}, assigned to ${employees}, ${status}.${prefNote} `;
    }

    return { text, jobs };
  } catch (err) {
    console.error('[VOICE-DATA] Schedule error:', err.message);
    return { text: 'Sorry, I could not load the schedule right now.', jobs: [] };
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
        fetchTodaySchedule(),
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
