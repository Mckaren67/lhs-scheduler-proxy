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

    const response = await fetch(
      `https://api.housecallpro.com/jobs?scheduled_start_min=${start}&scheduled_start_max=${end}&page_size=200`,
      { headers: { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' } }
    );
    if (!response.ok) return { text: 'Could not fetch schedule right now.', jobs: [] };
    const data = await response.json();
    const jobs = (data.jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at);

    if (jobs.length === 0) return { text: 'No jobs scheduled today.', jobs: [] };

    // Build conversational summary
    const inProgress = jobs.filter(j => j.work_status === 'in progress' || j.work_timestamps?.started_at);
    const scheduled = jobs.filter(j => j.work_status === 'scheduled' && !j.work_timestamps?.started_at);
    const completed = jobs.filter(j => j.work_status === 'complete' || j.work_status === 'complete unrated');

    let text = `There are ${jobs.length} jobs today. `;
    if (inProgress.length > 0) text += `${inProgress.length} in progress right now. `;
    if (scheduled.length > 0) text += `${scheduled.length} still scheduled. `;
    if (completed.length > 0) text += `${completed.length} already completed. `;

    text += '\n\nHere are the details:\n';
    for (const job of jobs) {
      const name = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim();
      const employees = (job.assigned_employees || []).map(e => `${e.first_name}`).join(' and ') || 'unassigned';
      const startTime = job.schedule?.scheduled_start
        ? new Date(job.schedule.scheduled_start).toLocaleTimeString('en-CA', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' })
        : 'no time set';
      const status = job.work_status || 'scheduled';
      text += `${name} at ${startTime}, ${employees}, ${status}. `;
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

    return res.status(400).json({ error: 'Unknown action. Use: live_data, caller_history, save_learning, search_knowledge' });

  } catch (err) {
    console.error('[VOICE-DATA] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
