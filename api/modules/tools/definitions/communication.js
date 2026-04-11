// Tool definitions: communication — 3 tools
// Extracted from incoming-sms.js lines 971–1025

import { registerTool } from '../registry.js';

// 1. send_email
registerTool('send_email', {
  name: 'send_email',
  description: 'Send or draft an email on Karen\'s behalf. Use when Karen says "email [client] about [topic]" or "send an email to [person]". For routine emails (confirmations, reminders, scheduling updates) — sends automatically. For sensitive topics (complaints, pricing, cancellations) — saves as draft for Karen to review.',
  input_schema: {
    type: 'object',
    properties: {
      client_name: { type: 'string', description: 'Client or recipient name to look up email from HCP' },
      to_email: { type: 'string', description: 'Email address if known (overrides client lookup)' },
      subject: { type: 'string', description: 'Email subject line' },
      body: { type: 'string', description: 'Email body — write in Karen\'s warm professional voice' },
      force_draft: { type: 'boolean', description: 'Set true to force save as draft even if topic seems routine' }
    },
    required: ['subject', 'body']
  }
}, null); // Handler wired in Phase 5

// 2. call_client
registerTool('call_client', {
  name: 'call_client',
  description: 'Make an outbound phone call to a client or cleaner. Aria calls them, delivers the message via voice AI, and leaves a voicemail if no answer. Use when Karen says "call [person]" or "leave a voicemail for [person]".',
  input_schema: {
    type: 'object',
    properties: {
      client_name: { type: 'string', description: 'Name of the person to call — will look up phone from HCP' },
      message: { type: 'string', description: 'The message to deliver — natural conversational tone' }
    },
    required: ['client_name', 'message']
  }
}, null);

// 3. report_sick_day
registerTool('report_sick_day', {
  name: 'report_sick_day',
  description: 'Process a sick day report. Use when ANY cleaner (not Karen) texts that they are sick, can\'t come in, not feeling well, calling in sick, or similar. This triggers the full cascade: find affected jobs, suggest replacements, notify Karen, log the sick day.',
  input_schema: {
    type: 'object',
    properties: {
      cleaner_name: { type: 'string', description: 'Name of the cleaner who is sick' }
    },
    required: ['cleaner_name']
  }
}, null);
