export const config = { api: { bodyParser: true } };

import { saveTask, completeTask, deleteTask, updateTask, getOpenTasks, getAllCompletedTasks, getCompletedTasksInRange, searchTasks, forceHydrate } from './task-store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  const expectedToken = process.env.INTERNAL_SECRET;
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // GET — always re-read from KB for fresh data
    if (req.method === 'GET') {
      await forceHydrate();
      const { search, status, from, to, action } = req.query;

      if (search) {
        const results = await searchTasks(search, status || 'all');
        return res.status(200).json({ total: results.length, tasks: results });
      }

      // All completed tasks (permanent archive)
      if (status === 'completed') {
        if (from && to) {
          const results = await getCompletedTasksInRange(from, to);
          return res.status(200).json({ total: results.length, tasks: results });
        }
        const all = await getAllCompletedTasks();
        return res.status(200).json({ total: all.length, tasks: all });
      }

      // Default: open tasks
      const open = await getOpenTasks();
      return res.status(200).json({ total: open.length, tasks: open });
    }

    // POST — create task
    if (req.method === 'POST') {
      const task = await saveTask(req.body || {});
      return res.status(201).json(task);
    }

    // PATCH — update task
    if (req.method === 'PATCH') {
      const { id, action } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing id query parameter' });

      // PATCH ?id=X&action=complete — mark as done (stays in archive)
      if (action === 'complete') {
        const completed = await completeTask(id);
        if (!completed) return res.status(404).json({ error: 'Task not found' });
        return res.status(200).json(completed);
      }

      const updated = await updateTask(id, req.body || {});
      if (!updated) return res.status(404).json({ error: 'Task not found' });
      return res.status(200).json(updated);
    }

    // DELETE ?id=X&action=complete — mark as done (backward compat with tasks.html)
    // DELETE ?id=X&action=delete — permanently remove (only when Karen says "delete this")
    if (req.method === 'DELETE') {
      const { id, action } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing id query parameter' });

      if (action === 'delete') {
        const deleted = await deleteTask(id);
        if (!deleted) return res.status(404).json({ error: 'Task not found' });
        return res.status(200).json({ deleted: true, task: deleted });
      }

      // Default DELETE = complete (not remove)
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
