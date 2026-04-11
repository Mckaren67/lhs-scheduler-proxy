// Tool definitions: notes & learning — 2 tools
// Extracted from incoming-sms.js lines 869–881 and 949–959

import { registerTool } from '../registry.js';

// 1. add_job_note
registerTool('add_job_note', {
  name: 'add_job_note',
  description: 'Add a note to a client\'s jobs in HouseCall Pro. Use when Karen asks to add a note, update instructions, or leave a message on a client\'s jobs.',
  input_schema: {
    type: 'object',
    properties: {
      client: { type: 'string', description: 'Client name exactly as it appears in the schedule (e.g. "Hans Claus", "Valley Toyota")' },
      note: { type: 'string', description: 'The note content to add to the job(s)' },
      range_days: { type: 'number', description: 'How many days of jobs to update: 1 for today only, 7 for this week, 90 for all future jobs. Default 90.' }
    },
    required: ['client', 'note']
  }
}, null); // Handler wired in Phase 5

// 2. save_learning
registerTool('save_learning', {
  name: 'save_learning',
  description: 'Save something new Aria learned about a client, cleaner, or the business. Use proactively when you discover new information during a conversation — client changed their preferred day, cleaner has a health issue, pricing changed, etc.',
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Who or what this is about (e.g. "Hans Claus", "Holly D", "Valley Toyota pricing")' },
      category: { type: 'string', enum: ['client', 'cleaner', 'scheduling', 'pricing', 'quality', 'general'], description: 'Category of the learning' },
      fact: { type: 'string', description: 'The new fact or information learned' }
    },
    required: ['subject', 'category', 'fact']
  }
}, null);
