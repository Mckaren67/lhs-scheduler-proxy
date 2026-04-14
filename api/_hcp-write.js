// HCP Write Operations — reassign, reschedule, note, create customer, cancel
// All functions make real changes to HouseCall Pro via API

const HCP_BASE = 'https://api.housecallpro.com';
const TZ = 'America/Vancouver';

function getKey() { return process.env.HCP_API_KEY; }
function hcpHeaders() { return { 'Authorization': `Token ${getKey()}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }; }

// ─── Employee ID mapping (cached) ───────────────────────────────────────────
let employeeMap = null;
let employeeMapAge = 0;
const MAP_TTL = 60 * 60 * 1000; // 1 hour

export async function getEmployeeMap() {
  if (employeeMap && (Date.now() - employeeMapAge) < MAP_TTL) return employeeMap;
  try {
    const r = await fetch(`${HCP_BASE}/employees?page_size=50`, { headers: hcpHeaders() });
    if (!r.ok) return employeeMap || {};
    const d = await r.json();
    const map = {};
    for (const e of (d.employees || [])) {
      const name = `${e.first_name} ${e.last_name}`.trim();
      map[name.toLowerCase()] = e.id;
      map[e.first_name.toLowerCase()] = e.id; // first name only lookup
      map[e.id] = { id: e.id, name, firstName: e.first_name, lastName: e.last_name };
    }
    employeeMap = map;
    employeeMapAge = Date.now();
    return map;
  } catch (e) {
    console.error('[HCP-WRITE] Employee map error:', e.message);
    return employeeMap || {};
  }
}

// Resolve a cleaner name to HCP employee ID
export async function resolveEmployeeId(nameOrId) {
  if (nameOrId?.startsWith('pro_')) return nameOrId;
  const map = await getEmployeeMap();
  return map[nameOrId?.toLowerCase()] || null;
}

// ─── Reassign job to different cleaner(s) ───────────────────────────────────
export async function reassignJob(jobId, newEmployeeIds) {
  const ids = Array.isArray(newEmployeeIds) ? newEmployeeIds : [newEmployeeIds];
  const dispatched = ids.map(id => ({ employee_id: id }));
  const r = await fetch(`${HCP_BASE}/jobs/${jobId}/dispatch`, {
    method: 'PUT',
    headers: hcpHeaders(),
    body: JSON.stringify({ dispatched_employees: dispatched })
  });
  if (!r.ok) {
    const err = await r.text();
    console.error(`[HCP-WRITE] reassignJob failed: ${r.status} ${err.substring(0, 150)}`);
    return { ok: false, error: `HCP error ${r.status}` };
  }
  const d = await r.json();
  const names = (d.assigned_employees || []).map(e => `${e.first_name} ${e.last_name}`.trim());
  console.log(`[HCP-WRITE] Reassigned ${jobId} → ${names.join(', ')}`);
  return { ok: true, job: d, assignedTo: names };
}

// ─── Reschedule job to new date/time ────────────────────────────────────────
export async function rescheduleJob(jobId, newStartISO, newEndISO) {
  // If no end time, add 3 hours to start
  if (!newEndISO) {
    const start = new Date(newStartISO);
    start.setHours(start.getHours() + 3);
    newEndISO = start.toISOString();
  }
  const r = await fetch(`${HCP_BASE}/jobs/${jobId}/schedule`, {
    method: 'PUT',
    headers: hcpHeaders(),
    body: JSON.stringify({ start_time: newStartISO, end_time: newEndISO })
  });
  if (!r.ok) {
    const err = await r.text();
    console.error(`[HCP-WRITE] rescheduleJob failed: ${r.status} ${err.substring(0, 150)}`);
    return { ok: false, error: `HCP error ${r.status}` };
  }
  const d = await r.json();
  console.log(`[HCP-WRITE] Rescheduled ${jobId} → ${newStartISO}`);
  return { ok: true, job: d };
}

// ─── Add note to job ────────────────────────────────────────────────────────
export async function addJobNote(jobId, noteText) {
  const r = await fetch(`${HCP_BASE}/jobs/${jobId}/notes`, {
    method: 'POST',
    headers: hcpHeaders(),
    body: JSON.stringify({ content: noteText })
  });
  if (!r.ok) {
    const err = await r.text();
    console.error(`[HCP-WRITE] addJobNote failed: ${r.status} ${err.substring(0, 150)}`);
    return { ok: false, error: `HCP error ${r.status}` };
  }
  console.log(`[HCP-WRITE] Note added to ${jobId}`);
  return { ok: true };
}

// ─── Create customer ────────────────────────────────────────────────────────
export async function createCustomer(data) {
  const body = {
    first_name: data.firstName || data.first_name || '',
    last_name: data.lastName || data.last_name || '',
  };
  if (data.email) body.email = data.email;
  if (data.phone) body.mobile_number = data.phone;
  if (data.address) body.address = data.address;

  const r = await fetch(`${HCP_BASE}/customers`, {
    method: 'POST',
    headers: hcpHeaders(),
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const err = await r.text();
    console.error(`[HCP-WRITE] createCustomer failed: ${r.status} ${err.substring(0, 150)}`);
    return { ok: false, error: `HCP error ${r.status}` };
  }
  const d = await r.json();
  console.log(`[HCP-WRITE] Customer created: ${d.id} — ${body.first_name} ${body.last_name}`);
  return { ok: true, customer: d };
}

// ─── Get jobs for a specific cleaner on a date ──────────────────────────────
export async function getJobsForCleaner(cleanerName, dateStr) {
  try {
    const start = new Date(dateStr + 'T00:00:00').toISOString();
    const end = new Date(dateStr + 'T23:59:59').toISOString();
    const r = await fetch(`${HCP_BASE}/jobs?scheduled_start_min=${start}&scheduled_start_max=${end}&page_size=200`, { headers: hcpHeaders() });
    if (!r.ok) return [];
    const d = await r.json();
    const nameL = cleanerName.toLowerCase();
    return (d.jobs || []).filter(j => {
      if (j.work_status === 'pro canceled' || j.deleted_at) return false;
      return (j.assigned_employees || []).some(e =>
        `${e.first_name} ${e.last_name}`.toLowerCase().includes(nameL) ||
        e.first_name.toLowerCase().includes(nameL)
      );
    });
  } catch (e) {
    console.error('[HCP-WRITE] getJobsForCleaner error:', e.message);
    return [];
  }
}

// ─── Find available cleaners for a date ─────────────────────────────────────
export async function findAvailableCleaners(dateStr, excludeNames = []) {
  try {
    const start = new Date(dateStr + 'T00:00:00').toISOString();
    const end = new Date(dateStr + 'T23:59:59').toISOString();
    const r = await fetch(`${HCP_BASE}/jobs?scheduled_start_min=${start}&scheduled_start_max=${end}&page_size=200`, { headers: hcpHeaders() });
    if (!r.ok) return [];
    const d = await r.json();

    // Count jobs per cleaner
    const jobCounts = {};
    for (const j of (d.jobs || [])) {
      if (j.work_status === 'pro canceled' || j.deleted_at) continue;
      for (const e of (j.assigned_employees || [])) {
        const name = `${e.first_name} ${e.last_name}`.trim();
        jobCounts[name] = (jobCounts[name] || 0) + 1;
      }
    }

    // Get all employees
    const map = await getEmployeeMap();
    const allCleaners = Object.entries(map)
      .filter(([k, v]) => typeof v === 'object' && v.id)
      .map(([, v]) => v);

    // Find cleaners with capacity (fewer than 3 jobs) and not excluded
    const excludeSet = new Set(excludeNames.map(n => n.toLowerCase()));
    return allCleaners
      .filter(c => !excludeSet.has(c.name.toLowerCase()))
      .filter(c => (jobCounts[c.name] || 0) < 3)
      .sort((a, b) => (jobCounts[a.name] || 0) - (jobCounts[b.name] || 0))
      .map(c => ({ ...c, jobCount: jobCounts[c.name] || 0 }));
  } catch (e) {
    console.error('[HCP-WRITE] findAvailableCleaners error:', e.message);
    return [];
  }
}
