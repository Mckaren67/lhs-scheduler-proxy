export const config = { api: { bodyParser: true } };

import { saveTask, completeTask, updateTask, getOpenTasks, searchTasks } from './task-store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth — same pattern as bulk-job-notes.js
  const authHeader = req.headers.authorization || '';
  const expectedToken = process.env.INTERNAL_SECRET;
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // GET — list or search tasks
    if (req.method === 'GET') {
      const { search, status, due } = req.query;

      if (search) {
        const results = await searchTasks(search, status || 'all');
        return res.status(200).json({ total: results.length, tasks: results });
      }

      const open = await getOpenTasks();
      if (status === 'completed') {
        const { getTasksCompletedToday } = await import('./task-store.js');
        const completed = await getTasksCompletedToday();
        return res.status(200).json({ total: completed.length, tasks: completed });
      }

      return res.status(200).json({ total: open.length, tasks: open });
    }

    // POST — create task
    if (req.method === 'POST') {
      const task = await saveTask(req.body || {});
      return res.status(201).json(task);
    }

    // PATCH — update task
    if (req.method === 'PATCH') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing id query parameter' });
      const updated = await updateTask(id, req.body || {});
      if (!updated) return res.status(404).json({ error: 'Task not found' });
      return res.status(200).json(updated);
    }

    // DELETE — complete task
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing id query parameter' });
      const completed = await completeTask(id);
      if (!completed) return res.status(404).json({ error: 'Task not found' });
      return res.status(200).json(completed);
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[TASKS-API] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
