// Shared HouseCall Pro API client — single source of truth
// Replaces the HCP header construction duplicated across 17 files

import { fetchWithTimeout } from './time.js';

const HCP_BASE = 'https://api.housecallpro.com';

export function hcpHeaders(writable = false) {
  const apiKey = process.env.HCP_API_KEY;
  const headers = { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' };
  if (writable) headers['Content-Type'] = 'application/json';
  return headers;
}

export async function fetchJobs({ startDate, endDate, pageSize = 200 } = {}) {
  const url = `${HCP_BASE}/jobs?scheduled_start_min=${startDate}&scheduled_start_max=${endDate}&page_size=${pageSize}`;
  const response = await fetchWithTimeout(url, { headers: hcpHeaders() }, 10000);
  if (!response.ok) return [];
  const data = await response.json();
  return (data.jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at);
}

export async function fetchJobById(jobId) {
  const url = `${HCP_BASE}/jobs/${jobId}`;
  const response = await fetchWithTimeout(url, { headers: hcpHeaders() });
  if (!response.ok) return null;
  return response.json();
}

export async function updateJobSchedule(jobId, { startTime, endTime }) {
  const body = { scheduled_start: startTime };
  if (endTime) body.scheduled_end = endTime;
  const response = await fetch(`${HCP_BASE}/jobs/${jobId}/schedule`, {
    method: 'PUT',
    headers: hcpHeaders(true),
    body: JSON.stringify(body)
  });
  return { ok: response.ok, status: response.status };
}

export async function fetchClientData() {
  try {
    const response = await fetchWithTimeout('https://lhs-knowledge-base.vercel.app/api/clients');
    if (!response.ok) return { clients: [], cleaners: [] };
    const data = await response.json();
    return { clients: data.clients || [], cleaners: data.cleaners || [] };
  } catch {
    return { clients: [], cleaners: [] };
  }
}

export { HCP_BASE };
