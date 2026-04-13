// Tool definitions: operations — 5 tools
// Extracted from incoming-sms.js lines 919–947 and 996–1025

import { registerTool } from '../registry.js';

// 1. build_stat_holiday_plan
registerTool('build_stat_holiday_plan', {
  name: 'build_stat_holiday_plan',
  description: 'Build a rescheduling plan for a stat holiday. Use when Karen says "yes build the plan" or "build the rescheduling plan" for a stat holiday.',
  input_schema: {
    type: 'object',
    properties: {
      holiday_date: { type: 'string', description: 'The stat holiday date in YYYY-MM-DD format. 2026 BC holidays: Victoria Day=2026-05-18, Indigenous Peoples Day=2026-06-21, Canada Day=2026-07-01, BC Day=2026-08-03, Labour Day=2026-09-07, Truth & Reconciliation=2026-09-30, Thanksgiving=2026-10-12, Remembrance Day=2026-11-11, Christmas=2026-12-25, Boxing Day=2026-12-26' },
      holiday_name: { type: 'string', description: 'Name of the holiday (e.g. "Victoria Day")' }
    },
    required: ['holiday_date', 'holiday_name']
  }
}, null); // Handler wired in Phase 5

// 2. approve_stat_holiday_plan
registerTool('approve_stat_holiday_plan', {
  name: 'approve_stat_holiday_plan',
  description: 'Execute the approved stat holiday rescheduling plan. Use when Karen says "approve the plan", "go ahead and reschedule", or "yes do it" after seeing a rescheduling plan. This will update flexible client jobs in HCP, notify affected clients by SMS, and notify assigned cleaners.',
  input_schema: {
    type: 'object',
    properties: {
      holiday_date: { type: 'string', description: 'The stat holiday date in YYYY-MM-DD format' },
      holiday_name: { type: 'string', description: 'Name of the holiday' }
    },
    required: ['holiday_date', 'holiday_name']
  }
}, null);

// 3. check_capacity
registerTool('check_capacity', {
  name: 'check_capacity',
  description: 'Check workforce capacity. Use when Karen asks "what is our capacity?", "how busy are we?", "do we need to hire?", or anything about staffing levels, workload, or capacity.',
  input_schema: {
    type: 'object',
    properties: {},
    required: []
  }
}, null);

// 4. offboard_employee
registerTool('offboard_employee', {
  name: 'offboard_employee',
  description: 'Start employee offboarding. Use when Karen says "[name] last day was [date]", "offboard [name]", or "[name] is leaving". This sends ROE email to Bill Gee, updates KB, and sends Karen a checklist.',
  input_schema: {
    type: 'object',
    properties: {
      employee_name: { type: 'string', description: 'Full name of the employee leaving (e.g. "Emily F")' },
      last_day: { type: 'string', description: 'Last day worked in YYYY-MM-DD format' }
    },
    required: ['employee_name']
  }
}, null);

// 5. save_tmor
registerTool('save_tmor', {
  name: 'save_tmor',
  description: 'Save a TMOR (The Morning Opportunity Report). Use when Karen says "TMOR", "morning opportunity report", or "end TMOR". When Karen says TMOR, ask her to describe what happened. When she says "end TMOR" or finishes describing, save the full report using this tool.',
  input_schema: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'Full description of what Karen reported in her morning opportunity report' }
    },
    required: ['description']
  }
}, null);
