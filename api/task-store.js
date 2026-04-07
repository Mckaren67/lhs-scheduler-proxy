// Task storage module for Aria — Karen's digital chief of staff
// In-memory Map with persistence to lhs-knowledge-base save.js
// Imported directly by incoming-sms.js and briefing endpoints

const KB_SAVE_URL = 'https://lhs-knowledge-base.vercel.app/api/save';
const KB_KEY = 'aria_tasks';
const TIMEZONE = 'America/Vancouver';

const tasks = new Map();
let hydrated = false;
let hydratePromise = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 6);
  return `task_${ts}_${rand}`;
}

function todayPT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

function nowPT() {
  return new Date().toLocaleString('en-CA', { timeZone: TIMEZONE, hour12: false });
}

// ─── Persistence ────────────────────────────────────────────────────────────

async function hydrateTasks() {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    try {
      console.log('[TASKS] Hydrating from knowledge base...');
      const res = await fetch(`${KB_SAVE_URL}?key=${KB_KEY}`);
      const data = await res.json();
      if (data.value && Array.isArray(data.value)) {
        for (const t of data.value) {
          tasks.set(t.id, t);
        }
        console.log(`[TASKS] Hydrated ${data.value.length} tasks`);
      } else {
        console.log('[TASKS] No existing tasks found in KB');
      }
    } catch (err) {
      console.error('[TASKS] Hydration failed:', err.message);
    }
    hydrated = true;
    hydratePromise = null;
  })();

  return hydratePromise;
}

function persistTasks() {
  // Fire and forget — don't block the caller
  const allTasks = Array.from(tasks.values());
  fetch(KB_SAVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: KB_KEY, value: allTasks })
  }).then(() => {
    console.log(`[TASKS] Persisted ${allTasks.length} tasks to KB`);
  }).catch(err => {
    console.error('[TASKS] Persist failed:', err.message);
  });
}

// ─── Priority sorting ───────────────────────────────────────────────────────

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const CATEGORY_ORDER = { client: 0, staff: 1, scheduling: 2, billing: 3, admin: 4 };

function sortByPriority(taskList) {
  const today = todayPT();
  return taskList.sort((a, b) => {
    // Overdue first
    const aOverdue = a.due_date && a.due_date < today ? 1 : 0;
    const bOverdue = b.due_date && b.due_date < today ? 1 : 0;
    if (bOverdue !== aOverdue) return bOverdue - aOverdue;

    // Priority band
    const aPri = PRIORITY_ORDER[a.priority] ?? 2;
    const bPri = PRIORITY_ORDER[b.priority] ?? 2;
    if (aPri !== bPri) return aPri - bPri;

    // Category
    const aCat = CATEGORY_ORDER[a.category] ?? 4;
    const bCat = CATEGORY_ORDER[b.category] ?? 4;
    if (aCat !== bCat) return aCat - bCat;

    // Due date (earliest first, no-date last)
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return 0;
  });
}

// ─── Exported functions ─────────────────────────────────────────────────────

export async function saveTask({
  description, priority = 'medium', category = 'admin', due_date = null,
  assigned_to = 'karen', notes = '', estimated_time_minutes = null, source_message = ''
}) {
  await hydrateTasks();

  const task = {
    id: generateId(),
    description,
    priority,
    category,
    due_date,
    assigned_to,
    status: 'open',
    created_at: new Date().toISOString(),
    completed_at: null,
    notes,
    estimated_time_minutes,
    source_message
  };

  tasks.set(task.id, task);
  persistTasks();
  console.log(`[TASKS] Created: ${task.id} — "${description}" (${priority}, due: ${due_date || 'none'})`);
  return task;
}

export async function completeTask(taskId) {
  await hydrateTasks();

  const task = tasks.get(taskId);
  if (!task) return null;

  task.status = 'completed';
  task.completed_at = new Date().toISOString();
  tasks.set(taskId, task);
  persistTasks();
  console.log(`[TASKS] Completed: ${task.id} — "${task.description}"`);
  return task;
}

export async function updateTask(taskId, fields) {
  await hydrateTasks();

  const task = tasks.get(taskId);
  if (!task) return null;

  Object.assign(task, fields);
  tasks.set(taskId, task);
  persistTasks();
  return task;
}

export async function getOpenTasks() {
  await hydrateTasks();
  const open = Array.from(tasks.values()).filter(t => t.status === 'open');
  return sortByPriority(open);
}

export async function getOverdueTasks() {
  await hydrateTasks();
  const today = todayPT();
  return Array.from(tasks.values()).filter(t =>
    t.status === 'open' && t.due_date && t.due_date < today
  );
}

export async function getTasksDueBy(dateStr) {
  await hydrateTasks();
  return Array.from(tasks.values()).filter(t =>
    t.status === 'open' && t.due_date && t.due_date <= dateStr
  );
}

export async function getTasksCompletedToday() {
  await hydrateTasks();
  const today = todayPT();
  return Array.from(tasks.values()).filter(t => {
    if (t.status !== 'completed' || !t.completed_at) return false;
    const completedDate = new Date(t.completed_at).toLocaleDateString('en-CA', { timeZone: TIMEZONE });
    return completedDate === today;
  });
}

export async function searchTasks(query, statusFilter = 'all') {
  await hydrateTasks();
  const q = query.toLowerCase();
  let results = Array.from(tasks.values()).filter(t => {
    const text = `${t.description} ${t.notes} ${t.assigned_to} ${t.category}`.toLowerCase();
    return text.includes(q);
  });

  if (statusFilter === 'open') results = results.filter(t => t.status === 'open');
  else if (statusFilter === 'completed') results = results.filter(t => t.status === 'completed');

  return sortByPriority(results);
}

export async function getMorningBriefingData() {
  await hydrateTasks();
  const today = todayPT();
  const open = await getOpenTasks();
  const overdue = open.filter(t => t.due_date && t.due_date < today);
  const dueToday = open.filter(t => t.due_date === today);
  const delegated = open.filter(t => t.assigned_to === 'aria');
  const topFollowUps = [...overdue, ...dueToday, ...open.filter(t => !overdue.includes(t) && !dueToday.includes(t))].slice(0, 5);
  const estimatedMinutes = delegated.reduce((sum, t) => sum + (t.estimated_time_minutes || 15), 0);

  return {
    openCount: open.length,
    overdueCount: overdue.length,
    topFollowUps,
    delegatedToAria: delegated,
    estimatedMinutesSaved: estimatedMinutes
  };
}

export async function getEveningBriefingData() {
  await hydrateTasks();
  const completedToday = await getTasksCompletedToday();
  const open = await getOpenTasks();

  // Tomorrow's priorities — overdue + due tomorrow + top open
  const today = todayPT();
  const tomorrow = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const tomorrowPriorities = open.slice(0, 10);
  const estimatedMinutes = completedToday.reduce((sum, t) => sum + (t.estimated_time_minutes || 15), 0);

  return {
    completedToday,
    stillOpen: open,
    tomorrowPriorities,
    estimatedMinutesSaved: estimatedMinutes
  };
}
