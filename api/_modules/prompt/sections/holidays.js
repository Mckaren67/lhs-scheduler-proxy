// Prompt section: BC statutory holidays — single source of truth
// Extracted from incoming-sms.js prompt lines 543–564
// Also usable by stat-holiday-check.js to avoid duplication

export const STAT_HOLIDAYS_2026 = [
  { date: '2026-01-01', name: "New Year's Day", day: 'Thursday' },
  { date: '2026-02-16', name: 'Family Day', day: 'Monday' },
  { date: '2026-04-03', name: 'Good Friday', day: 'Friday' },
  { date: '2026-04-06', name: 'Easter Monday', day: 'Monday' },
  { date: '2026-05-18', name: 'Victoria Day', day: 'Monday' },
  { date: '2026-06-21', name: 'National Indigenous Peoples Day', day: 'Sunday' },
  { date: '2026-07-01', name: 'Canada Day', day: 'Wednesday' },
  { date: '2026-08-03', name: 'BC Day', day: 'Monday' },
  { date: '2026-09-07', name: 'Labour Day', day: 'Monday' },
  { date: '2026-09-30', name: 'National Day for Truth and Reconciliation', day: 'Wednesday' },
  { date: '2026-10-12', name: 'Thanksgiving', day: 'Monday' },
  { date: '2026-11-11', name: 'Remembrance Day', day: 'Wednesday' },
  { date: '2026-12-25', name: 'Christmas Day', day: 'Friday' },
  { date: '2026-12-26', name: 'Boxing Day', day: 'Saturday' }
];

export function buildHolidaysSection() {
  return `BC STATUTORY HOLIDAYS 2026 (use these exact dates — never guess):
- New Year's Day — January 1 (passed)
- Family Day — February 16 (passed)
- Good Friday — April 3 (passed)
- Easter Monday — April 6 (TODAY)
- Victoria Day — May 18 (Monday)
- National Indigenous Peoples Day — June 21 (Sunday)
- Canada Day — July 1 (Wednesday)
- BC Day — August 3 (Monday)
- Labour Day — September 7 (Monday)
- National Day for Truth and Reconciliation — September 30 (Wednesday)
- Thanksgiving — October 12 (Monday)
- Remembrance Day — November 11 (Wednesday)
- Christmas Day — December 25 (Friday)
- Boxing Day — December 26 (Saturday)

STAT HOLIDAY RULES:
- When Karen asks about an upcoming stat holiday, always give the exact date from the list above
- If jobs are scheduled on a stat holiday, proactively flag them: "Heads up — [date] is [holiday]. There are [N] jobs scheduled that day. Want me to list them so you can decide what to reschedule?"
- Stat holidays may mean overtime pay for cleaners who work — mention this when relevant
- Commercial clients may have different holiday schedules — check with Karen before assuming they're closed
- Never guess stat holiday dates — only use the dates listed above

`;
}
