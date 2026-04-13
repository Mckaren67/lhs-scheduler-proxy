// Tool handlers: notes & learning — 2 handlers
// Extracted from incoming-sms.js lines 1085–1118 and 1411–1426

import { executeBulkNotes } from '../../../bulk-job-notes.js';
import { saveLearning } from '../../../aria-memory.js';
import { registerTool } from '../registry.js';

// ─── add_job_note ───────────────────────────────────────────────────────────

async function handleAddJobNote(input, ctx) {
  const { client, note, range_days } = input;
  console.log(`[BULK-NOTES] Tool call: client="${client}", note="${note}", range=${range_days || 90} days`);

  try {
    const result = await executeBulkNotes({
      clientName: client,
      noteContent: note,
      dateRangeStart: new Date().toISOString(),
      dateRangeEnd: new Date(Date.now() + (range_days || 90) * 86400000).toISOString(),
      adminPhone: ctx.from,
      timestamp: new Date().toISOString()
    });
    console.log(`[BULK-NOTES] Result:`, JSON.stringify(result));

    if (result.noted > 0) {
      let msg = `Done! Added note to ${result.noted} ${client} job${result.noted !== 1 ? 's' : ''}.`;
      if (result.notified?.length > 0) {
        msg += ` ${result.notified.join(' and ')} ${result.notified.length === 1 ? 'has' : 'have'} been notified.`;
      }
      if (result.failed > 0) msg += ` ${result.failed} failed.`;
      return msg + ' \u2014 LHS \ud83c\udfe0';
    } else if (result.matched === 0) {
      return `No upcoming jobs found for "${client}". Double-check the name? \u2014 LHS \ud83c\udfe0`;
    } else {
      return `On it! Adding "${note}" to ${client} jobs. \u2014 LHS \ud83c\udfe0`;
    }
  } catch (err) {
    console.error('[BULK-NOTES] Execution failed:', err.message);
    return `Sorry, something went wrong adding notes for ${client}. Please try again. \u2014 LHS \ud83c\udfe0`;
  }
}

// ─── save_learning ──────────────────────────────────────────────────────────

async function handleSaveLearning(input, ctx) {
  const { subject, category, fact } = input;
  console.log(`[MEMORY] Learning tool: ${subject} \u2014 ${fact.substring(0, 60)}`);

  try {
    await saveLearning({ subject, category: category || 'general', fact, source: 'sms_conversation' });
    return `Noted! I'll remember that about ${subject}. \u2014 LHS \ud83c\udfe0`;
  } catch (err) {
    console.error('[MEMORY] Save learning failed:', err.message);
    return `Got it, though I had trouble saving that note. I'll keep it in mind for this conversation. \u2014 LHS \ud83c\udfe0`;
  }
}

// Wire handlers into registry (definitions already registered by definitions/notes.js)
registerTool('add_job_note', null, handleAddJobNote);
registerTool('save_learning', null, handleSaveLearning);
