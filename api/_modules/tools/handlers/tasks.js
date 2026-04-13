// Tool handlers: tasks — 3 handlers
// Extracted from incoming-sms.js lines 1119–1199

import { saveTask, completeTask, updateTask, searchTasks, getOpenTasks, getOverdueTasks } from '../../../_task-client.js';
import { TIMEZONE } from '../../shared/time.js';
import { registerTool } from '../registry.js';

// ─── save_task ──────────────────────────────────────────────────────────────

async function handleSaveTask(input, ctx) {
  const { description, priority, category, due_date, assigned_to, estimated_time_minutes, notes } = input;
  console.log(`[TASKS] Save tool: "${description}" (${priority}, ${category}, due: ${due_date || 'none'})`);

  try {
    await saveTask({
      description, priority: priority || 'medium', category: category || 'admin',
      due_date: due_date || null, assigned_to: assigned_to || 'karen',
      estimated_time_minutes: estimated_time_minutes || null, notes: notes || '',
      source_message: ctx.incomingMessage
    });
    return `Got it! I've saved "${description}"${due_date ? ` for ${due_date}` : ''}. I'll keep track of this for you! — LHS 🏠`;
  } catch (err) {
    console.error('[TASKS] Save failed:', err.message);
    return `Sorry, I couldn't save that task. Please try again! — LHS 🏠`;
  }
}

// ─── complete_task ──────────────────────────────────────────────────────────

async function handleCompleteTask(input, ctx) {
  const { search_query } = input;
  console.log(`[TASKS] Complete tool: searching for "${search_query}"`);

  try {
    const results = await searchTasks(search_query, 'open');

    if (results.length === 0) {
      const allResults = await searchTasks(search_query, 'completed');
      if (allResults.length > 0) {
        const t = allResults[0];
        const completedDate = t.completed_at ? new Date(t.completed_at).toLocaleDateString('en-CA', { timeZone: TIMEZONE }) : 'earlier';
        return `That one's already done! "${t.description}" was completed on ${completedDate}. — LHS 🏠`;
      }
      return `I couldn't find an open task matching "${search_query}". Could you try different keywords? — LHS 🏠`;
    }

    const task = await completeTask(results[0].id);
    const openCount = (await getOpenTasks()).length;
    return `Nice work! Marked "${task.description}" as done. ✓ You have ${openCount} task${openCount !== 1 ? 's' : ''} remaining. — LHS 🏠`;
  } catch (err) {
    console.error('[TASKS] Complete failed:', err.message);
    return `Sorry, something went wrong completing that task. Please try again! — LHS 🏠`;
  }
}

// ─── search_tasks ───────────────────────────────────────────────────────────

async function handleSearchTasks(input, ctx) {
  const { search_query, status_filter } = input;
  console.log(`[TASKS] Search tool: "${search_query}" (filter: ${status_filter || 'all'})`);

  try {
    let results;
    if (search_query === 'overdue') results = await getOverdueTasks();
    else if (search_query === 'all') results = await getOpenTasks();
    else results = await searchTasks(search_query, status_filter || 'all');

    if (results.length === 0) return `Nothing found for "${search_query}". Your slate is clean! — LHS 🏠`;

    const shown = results.slice(0, 5);
    const lines = shown.map(t => {
      const status = t.status === 'completed' ? '✓' : (t.due_date && t.due_date < new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE }) ? '⚠️' : '○');
      const due = t.due_date ? ` (${t.due_date})` : '';
      return `${status} ${t.description}${due}`;
    });
    let msg = lines.join('\n');
    if (results.length > 5) msg += `\n...and ${results.length - 5} more`;
    return msg + ' — LHS 🏠';
  } catch (err) {
    console.error('[TASKS] Search failed:', err.message);
    return `Sorry, I couldn't search tasks right now. Please try again! — LHS 🏠`;
  }
}

// ─── reassign_task ──────────────────────────────────────────────────────────

async function handleReassignTask(input, ctx) {
  const { search_query, new_assignee } = input;
  console.log(`[TASKS] Reassign tool: "${search_query}" → ${new_assignee}`);
  try {
    const results = await searchTasks(search_query, 'open');
    if (results.length === 0) return `I couldn't find an open task matching "${search_query}". Could you try different keywords? — LHS 🏠`;
    const task = results[0];
    await updateTask(task.id, { assigned_to: new_assignee });
    return `Done — "${task.description}" is now assigned to ${new_assignee[0].toUpperCase() + new_assignee.slice(1)}. — LHS 🏠`;
  } catch (err) {
    console.error('[TASKS] Reassign failed:', err.message);
    return `Sorry, I couldn't reassign that task. Please try again! — LHS 🏠`;
  }
}

// Wire handlers into registry
registerTool('save_task', null, handleSaveTask);
registerTool('complete_task', null, handleCompleteTask);
registerTool('search_tasks', null, handleSearchTasks);
registerTool('reassign_task', null, handleReassignTask);
