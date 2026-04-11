// Tool definitions: scheduling — 4 tools
// Extracted from incoming-sms.js lines 960–1058

import { registerTool } from '../registry.js';

// 1. fetch_day_schedule
registerTool('fetch_day_schedule', {
  name: 'fetch_day_schedule',
  description: 'Fetch the schedule for a SPECIFIC date from HouseCall Pro. Use when Karen asks about a specific day like "Monday April 13", "next Tuesday", "how does Friday look". Returns all jobs for that exact date with times, clients, and assigned cleaners.',
  input_schema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Date in YYYY-MM-DD format (e.g. 2026-04-13). Parse from Karen\'s message — "Monday April 13" = 2026-04-13, "next Tuesday" = calculate the date, "tomorrow" = tomorrow\'s date.' }
    },
    required: ['date']
  }
}, null); // Handler wired in Phase 5

// 2. get_schedule_intelligence
registerTool('get_schedule_intelligence', {
  name: 'get_schedule_intelligence',
  description: 'Get proactive scheduling analysis for the next 7 days. Spots gaps, conflicts, overloaded cleaners, preferred cleaner mismatches, and cleaners booked on unavailable days. Use when Karen asks about the schedule, staffing, or when you want to proactively flag issues.',
  input_schema: { type: 'object', properties: {}, required: [] }
}, null);

// 3. suggest_schedule_change
registerTool('suggest_schedule_change', {
  name: 'suggest_schedule_change',
  description: 'Propose a specific schedule change for Karen to approve. Use after identifying an issue via schedule intelligence. Present the change clearly and wait for Karen to say yes before implementing.',
  input_schema: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'The HCP job ID to change' },
      client_name: { type: 'string', description: 'Client name for the job' },
      change_type: { type: 'string', enum: ['reschedule', 'reassign', 'cancel'], description: 'Type of change' },
      current_state: { type: 'string', description: 'Current assignment/date (e.g. "Monday April 7, assigned to Holly")' },
      proposed_state: { type: 'string', description: 'Proposed new assignment/date (e.g. "Tuesday April 8, assigned to April W")' },
      reason: { type: 'string', description: 'Why this change is recommended' }
    },
    required: ['client_name', 'change_type', 'current_state', 'proposed_state', 'reason']
  }
}, null);

// 4. implement_schedule_change
registerTool('implement_schedule_change', {
  name: 'implement_schedule_change',
  description: 'Execute an approved schedule change in HCP. ONLY use after Karen has explicitly approved the change. Updates the job in HCP and notifies the affected cleaner.',
  input_schema: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'The HCP job ID to update' },
      new_date: { type: 'string', description: 'New date in YYYY-MM-DD format' },
      new_start_time: { type: 'string', description: 'New start time in HH:MM format (24h, Pacific)' },
      new_end_time: { type: 'string', description: 'New end time in HH:MM format (24h, Pacific)' }
    },
    required: ['job_id', 'new_date']
  }
}, null);
