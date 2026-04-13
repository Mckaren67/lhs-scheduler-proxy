// Tool definitions: tasks — 3 tools
// Extracted from incoming-sms.js lines 882–917
// NOTE: save_task has a dynamic due_date description computed at request time

import { registerTool } from '../registry.js';
import { TIMEZONE } from '../../shared/time.js';

// Helper: compute dynamic date references for save_task description
// The original inline IIFE computed today/tomorrow/weekday dates at request time
function buildDueDateDescription() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
  const today = now.toISOString().split('T')[0];
  const tom = new Date(now); tom.setDate(tom.getDate() + 1);
  const tomorrow = tom.toISOString().split('T')[0];
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekdays = [];
  for (let i = 1; i <= 7; i++) {
    const next = new Date(now); next.setDate(now.getDate() + i);
    weekdays.push(`${days[next.getDay()]}=${next.toISOString().split('T')[0]}`);
  }
  return `Due date in YYYY-MM-DD format, or null if no specific date. Use these EXACT dates for relative references — do NOT calculate yourself: today=${today}, tomorrow=${tomorrow}, ${weekdays.join(', ')}`;
}

// 1. save_task — definition built as factory (due_date is dynamic)
export function registerTaskTools() {
  registerTool('save_task', {
    name: 'save_task',
    description: 'Save a task, follow-up, reminder, or to-do for Karen. Use whenever she mentions something she needs to do, follow up on, or remember.',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Clear description of the task (e.g. "Follow up with Ladda about interview")' },
        priority: { type: 'string', enum: ['urgent', 'important', 'normal'], description: 'Task priority — urgent for same-day/revenue-impacting, important for this-week, normal for general' },
        category: { type: 'string', enum: ['scheduling', 'client', 'staff', 'ar', 'operations', 'admin', 'communications', 'urgent'], description: 'Task category — scheduling (jobs/reassign), client (follow-up/complaint), staff (cleaner/hiring), ar (invoice/payment), operations (supply/equipment), admin (SOP/data), communications (email/text/call), urgent (same-day critical)' },
        due_date: { type: 'string', description: buildDueDateDescription() },
        assigned_to: { type: 'string', enum: ['karen', 'aria', 'michael', 'claude'], description: 'Who handles this. Default karen.' },
        linked_client: { type: 'string', description: 'Client name if task is related to a specific client' },
        linked_cleaner: { type: 'string', description: 'Cleaner name if task is related to a specific cleaner' },
        estimated_time_minutes: { type: 'number', description: 'Estimated minutes to complete' },
        notes: { type: 'string', description: 'Additional context or details' }
      },
      required: ['description', 'priority', 'category']
    }
  }, null); // Handler wired in Phase 5

  // 2. complete_task
  registerTool('complete_task', {
    name: 'complete_task',
    description: 'Mark a task as completed. Use when Karen says something is done, finished, handled, paid, or completed.',
    input_schema: {
      type: 'object',
      properties: {
        search_query: { type: 'string', description: 'Keywords to find the matching task (e.g. "pay Vanessa", "Ladda follow-up")' }
      },
      required: ['search_query']
    }
  }, null);

  // 3. search_tasks
  registerTool('search_tasks', {
    name: 'search_tasks',
    description: 'Search the TASK DASHBOARD (to-do items) by keyword. ONLY use when Karen explicitly asks about "tasks", "to-do list", "action items", or "task board". Do NOT use this for schedule questions — schedule questions about cleaning jobs should use the live HCP data in the system prompt or fetch_day_schedule tool instead.',
    input_schema: {
      type: 'object',
      properties: {
        search_query: { type: 'string', description: 'Keywords to search for. Use "all" to list all open tasks, "overdue" for overdue items.' },
        status_filter: { type: 'string', enum: ['open', 'completed', 'all'], description: 'Filter by status. Default: all.' }
      },
      required: ['search_query']
    }
  }, null);

  // 4. reassign_task
  registerTool('reassign_task', {
    name: 'reassign_task',
    description: 'Reassign a task to a different person. Use when Karen says "move X to Michael", "Aria take the X task", or "reassign X to Y".',
    input_schema: {
      type: 'object',
      properties: {
        search_query: { type: 'string', description: 'Keywords to find the task to reassign' },
        new_assignee: { type: 'string', enum: ['karen', 'aria', 'michael', 'claude'], description: 'Who to reassign the task to' }
      },
      required: ['search_query', 'new_assignee']
    }
  }, null);
}

// Register immediately on import
registerTaskTools();
