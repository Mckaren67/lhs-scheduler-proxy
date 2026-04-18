// Task client — local JSON file storage (Option 2)
// Replaces the old HTTP client that called the dead lhs-knowledge-base service.
// Writable state lives in /tmp/aria-tasks.json (Vercel serverless — survives warm
// invocations, resets on cold start). A committed seed at api/_tasks-seed.json
// provides the initial state after a cold start.
//
// All function signatures match the previous _task-client.js so callers are unchanged.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const TZ = 'America/Vancouver';
const STORAGE_PATH = '/tmp/aria-tasks.json';
const SEED_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '_tasks-seed.json');

let cache = null;

// ─── Persistence ────────────────────────────────────────────────────────────

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { tasks: parsed };
    if (parsed && Array.isArray(parsed.tasks)) return parsed;
    return { tasks: [] };
  } catch {
    return null;
  }
}

async function loadCache() {
  if (cache) return cache;
  const fromTmp = await readJson(STORAGE_PATH);
  if (fromTmp) { cache = fromTmp; return cache; }
  const fromSeed = await readJson(SEED_PATH);
  if (fromSeed) { cache = fromSeed; return cache; }
  cache = { tasks: [] };
  return cache;
}

async function persist() {
  try {
    await fs.writeFile(STORAGE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.error('[TASKS] Persist failed:', err.message);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 6);
  return `task_${ts}_${rand}`;
}

function todayPT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

const PRIORITY_ORDER = { urgent: 0, high: 0, important: 1, medium: 1, normal: 1, low: 2 };

function sortByPriority(list) {
  const today = todayPT();
  return [...list].sort((a, b) => {
    const aOverdue = a.due_date && a.due_date < today ? 1 : 0;
    const bOverdue = b.due_date && b.due_date < today ? 1 : 0;
    if (bOverdue !== aOverdue) return bOverdue - aOverdue;
    const aPri = PRIORITY_ORDER[a.priority] ?? 1;
    const bPri = PRIORITY_ORDER[b.priority] ?? 1;
    if (aPri !== bPri) return aPri - bPri;
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return (b.created_at || '').localeCompare(a.created_at || '');
  });
}

// ─── Exported functions ─────────────────────────────────────────────────────

export async function forceHydrate() {
  cache = null;
  await loadCache();
}

export async function saveTask({
  description, priority = 'normal', category = 'administrative', due_date = null,
  assigned_to = 'karen', notes = '', estimated_time_minutes = null,
  source_message = '', linked_client = null, linked_cleaner = null,
  aria_auto = false, time_saved_minutes = null
}) {
  await loadCache();
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
    source_message,
    linked_client,
    linked_cleaner,
    aria_auto,
    time_saved_minutes
  };
  cache.tasks.push(task);
  await persist();
  console.log(`[TASKS] Created: ${task.id} — "${description}"`);
  return task;
}

export async function completeTask(taskId) {
  await loadCache();
  const task = cache.tasks.find(t => t.id === taskId);
  if (!task) return null;
  task.status = 'completed';
  task.completed_at = new Date().toISOString();
  await persist();
  return task;
}

export async function updateTask(taskId, fields) {
  await loadCache();
  const task = cache.tasks.find(t => t.id === taskId);
  if (!task) return null;
  Object.assign(task, fields);
  await persist();
  return task;
}

export async function deleteTask(taskId) {
  await loadCache();
  const idx = cache.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return null;
  const [removed] = cache.tasks.splice(idx, 1);
  await persist();
  return removed;
}

export async function getOpenTasks() {
  await loadCache();
  return sortByPriority(cache.tasks.filter(t => t.status === 'open'));
}

export async function getOverdueTasks() {
  await loadCache();
  const today = todayPT();
  return cache.tasks.filter(t => t.status === 'open' && t.due_date && t.due_date < today);
}

export async function getTasksDueBy(dateStr) {
  await loadCache();
  return cache.tasks.filter(t => t.status === 'open' && t.due_date && t.due_date <= dateStr);
}

export async function getTasksCompletedToday() {
  await loadCache();
  const today = todayPT();
  return cache.tasks.filter(t => {
    if (t.status !== 'completed' || !t.completed_at) return false;
    const completedDate = new Date(t.completed_at).toLocaleDateString('en-CA', { timeZone: TZ });
    return completedDate === today;
  });
}

export async function getAllCompletedTasks() {
  await loadCache();
  return cache.tasks
    .filter(t => t.status === 'completed')
    .sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
}

export async function getCompletedTasksInRange(startDate, endDate) {
  await loadCache();
  return cache.tasks.filter(t => {
    if (t.status !== 'completed' || !t.completed_at) return false;
    const completedDate = new Date(t.completed_at).toLocaleDateString('en-CA', { timeZone: TZ });
    return completedDate >= startDate && completedDate <= endDate;
  }).sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
}

export async function searchTasks(query, statusFilter = 'all') {
  await loadCache();
  const q = String(query || '').toLowerCase();
  let results = cache.tasks.filter(t => {
    const text = `${t.description || ''} ${t.notes || ''} ${t.assigned_to || ''} ${t.category || ''}`.toLowerCase();
    return text.includes(q);
  });
  if (statusFilter === 'open') results = results.filter(t => t.status === 'open');
  else if (statusFilter === 'completed') results = results.filter(t => t.status === 'completed');
  return sortByPriority(results);
}

export async function getMorningBriefingData() {
  const open = await getOpenTasks();
  const overdue = await getOverdueTasks();
  const today = todayPT();
  const dueToday = open.filter(t => t.due_date === today);
  const delegated = open.filter(t => t.assigned_to === 'aria');
  const topFollowUps = [
    ...overdue,
    ...dueToday.filter(t => !overdue.includes(t)),
    ...open.filter(t => !overdue.includes(t) && !dueToday.includes(t))
  ].slice(0, 5);
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
  const completedToday = await getTasksCompletedToday();
  const open = await getOpenTasks();
  const today = todayPT();
  const weekAgo = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = weekAgo.toLocaleDateString('en-CA', { timeZone: TZ });
  const recentCompleted = await getCompletedTasksInRange(weekAgoStr, today);
  const tomorrowPriorities = open.slice(0, 10);
  const estimatedMinutes = completedToday.reduce((sum, t) => sum + (t.estimated_time_minutes || 15), 0);
  return {
    completedToday,
    completedThisWeek: recentCompleted,
    stillOpen: open,
    tomorrowPriorities,
    estimatedMinutesSaved: estimatedMinutes
  };
}

export async function logAriaAction({ description, category = 'admin', time_saved_minutes = 5, source_message = 'Auto — Aria' }) {
  return saveTask({
    description,
    priority: 'normal',
    category,
    assigned_to: 'aria',
    aria_auto: true,
    time_saved_minutes,
    estimated_time_minutes: time_saved_minutes,
    source_message,
    notes: `Aria auto-logged at ${new Date().toLocaleTimeString('en-CA', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })}`
  });
}
