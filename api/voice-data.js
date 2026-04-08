// Real-time data endpoint for ElevenLabs voice agent tools
// Returns schedule, tasks, flags in plain conversational English

export const config = { api: { bodyParser: true }, maxDuration: 15 };

import { getOpenTasks, getOverdueTasks } from './task-store.js';
import { getCapacityData } from './capacity-check.js';
import { getCallerHistory, getRecentConversations, searchLearnings } from './aria-memory.js';

const TIMEZONE = 'America/Vancouver';

const KB_SAVE_URL = 'https://lhs-knowledge-base.vercel.app/api/save';
const VOICE_CACHE_KEY = 'aria_voice_cache';

// Read pre-built cache from KB — NEVER calls HCP directly. Instant response.
async function readVoiceCache() {
  try {
    const resp = await fetch(`${KB_SAVE_URL}?key=${VOICE_CACHE_KEY}`);
    const data = await resp.json();
    if (data.value && data.value.schedule) {
      console.log(`[VOICE-DATA] Cache hit — cached at ${data.value.cachedAt}`);
      return data.value;
    }
    console.log('[VOICE-DATA] Cache empty');
    return null;
  } catch (err) {
    console.error('[VOICE-DATA] Cache read failed:', err.message);
    return null;
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
      const [cache, openTasks, flags] = await Promise.all([
        readVoiceCache(),
        getOpenTasks(),
        buildUrgentFlags()
      ]);

      if (!cache) {
        return res.status(200).json({
          schedule: 'Schedule data is not available right now. The cache is being built. Please try again in a moment or text 778-200-6517 for accurate information.',
          tasks: 'No task data available.',
          urgentFlags: ['Voice cache is empty — data will be available shortly.'],
          timestamp: new Date().toLocaleString('en-CA', { timeZone: TIMEZONE })
        });
      }

      const taskSummary = openTasks.length > 0
        ? `Karen has ${openTasks.length} open task${openTasks.length !== 1 ? 's' : ''}. Top priorities: ${openTasks.slice(0, 3).map(t => t.description).join(', ')}.`
        : 'No open tasks right now.';

      return res.status(200).json({
        schedule: cache.schedule,
        tasks: taskSummary,
        taskCount: openTasks.length,
        urgentFlags: flags,
        todayJobCount: cache.todayJobCount || 0,
        tomorrowJobCount: cache.tomorrowJobCount || 0,
        cleanerCount: cache.cleanerCount || 0,
        cachedAt: cache.cachedAt,
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
