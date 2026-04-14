// Task Client — thin HTTP client for the KB task API
// Replaces _task-store.js (in-memory Map) with HTTP calls to the authoritative API
// All functions match _task-store.js signatures for drop-in replacement

const KB_TASK_API = 'https://lhs-knowledge-base.vercel.app/api/tasks';
const TZ = 'America/Vancouver';

function getToken() { return process.env.INTERNAL_SECRET || 'lhs-aria-internal-2026-secret-key'; }
function todayPT() { return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); }

async function apiCall(path, opts = {}) {
  const url = path.startsWith('http') ? path : KB_TASK_API + path;
  const r = await fetch(url, {
    ...opts,
    headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  return r.json();
}

// ─── Compatibility layer — same signatures as _task-store.js ────────────────

export async function forceHydrate() {
  // No-op — KB API is always fresh. Kept for backward compat.
}

export async function saveTask({ description, priority = 'normal', category, due_date = null, assigned_to = 'karen', notes = '', estimated_time_minutes = null, source_message = '', linked_client = null, linked_cleaner = null }) {
  return apiCall('', {
    method: 'POST',
    body: JSON.stringify({ description, priority, category, due_date, assigned_to, notes, estimated_time_minutes, source_message, linked_client, linked_cleaner })
  });
}

export async function completeTask(taskId) {
  return apiCall(`?id=${taskId}&action=complete`, { method: 'PATCH' });
}

export async function updateTask(taskId, fields) {
  return apiCall(`?id=${taskId}`, { method: 'PATCH', body: JSON.stringify(fields) });
}

export async function deleteTask(taskId) {
  return apiCall(`?id=${taskId}&action=delete`, { method: 'DELETE' });
}

export async function getOpenTasks() {
  const d = await apiCall('');
  return [...(d.karen || []), ...(d.aria || []), ...(d.michael || [])];
}

export async function getOverdueTasks() {
  const tasks = await getOpenTasks();
  const today = todayPT();
  return tasks.filter(t => t.due_date && t.due_date < today);
}

export async function getTasksDueBy(dateStr) {
  const tasks = await getOpenTasks();
  return tasks.filter(t => t.due_date && t.due_date <= dateStr);
}

export async function getTasksCompletedToday() {
  const today = todayPT();
  const d = await apiCall(`?status=completed&from=${today}&to=${today}`);
  return d.tasks || [];
}

export async function getAllCompletedTasks() {
  const d = await apiCall('?status=completed');
  return d.tasks || [];
}

export async function getCompletedTasksInRange(startDate, endDate) {
  const d = await apiCall(`?status=completed&from=${startDate}&to=${endDate}`);
  return d.tasks || [];
}

export async function searchTasks(query, statusFilter = 'all') {
  const d = await apiCall(`?search=${encodeURIComponent(query)}&status=${statusFilter}`);
  return d.tasks || [];
}

export async function getMorningBriefingData() {
  const [stats, open, overdue] = await Promise.all([
    apiCall('?stats=true'),
    getOpenTasks(),
    getOverdueTasks()
  ]);
  const topFollowUps = open.filter(t => t.priority === 'urgent' || t.priority === 'important').slice(0, 5);
  const delegatedToAria = open.filter(t => t.assigned_to === 'aria');
  return {
    openCount: stats.totalActive || 0,
    overdueCount: stats.overdue || 0,
    topFollowUps,
    delegatedToAria,
    estimatedMinutesSaved: stats.ariaImpact?.savedAllTimeMinutes || 0
  };
}

export async function getEveningBriefingData() {
  const [stats, completedToday, open] = await Promise.all([
    apiCall('?stats=true'),
    getTasksCompletedToday(),
    getOpenTasks()
  ]);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomStr = tomorrow.toLocaleDateString('en-CA', { timeZone: TZ });
  const tomorrowPriorities = open.filter(t => t.due_date && t.due_date <= tomStr).slice(0, 5);
  return {
    completedToday,
    completedThisWeek: stats.completedThisWeek || 0,
    stillOpen: stats.totalActive || 0,
    tomorrowPriorities,
    estimatedMinutesSaved: stats.ariaImpact?.savedTodayMinutes || 0,
    ariaImpact: stats.ariaImpact || {},
    contributors: stats.contributors || {},
    aiValue: stats.aiValue || {}
  };
}

// ─── Aria self-logging — NEW ────────────────────────────────────────────────

export async function logAriaAction({ description, category = 'admin', time_saved_minutes = 5, source_message = 'Auto — Aria' }) {
  return apiCall('', {
    method: 'POST',
    body: JSON.stringify({
      description,
      priority: 'normal',
      category,
      assigned_to: 'aria',
      aria_auto: true,
      time_saved_minutes,
      estimated_time_minutes: time_saved_minutes,
      source_message,
      notes: `Aria auto-logged at ${new Date().toLocaleTimeString('en-CA', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })}`
    })
  });
}
