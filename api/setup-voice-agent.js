// One-time setup endpoint: updates ElevenLabs agent voice and system prompt
// Call once then delete: GET /api/setup-voice-agent?run=true
// Auth: Bearer INTERNAL_SECRET

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const authHeader = req.headers.authorization || '';
  if (!process.env.INTERNAL_SECRET || authHeader !== `Bearer ${process.env.INTERNAL_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.query.run !== 'true') {
    return res.status(200).json({ message: 'Add ?run=true to execute. This updates the ElevenLabs agent voice and prompt.' });
  }

  const AGENT_ID = 'agent_5301knm3eyy7en7snw8gf72ht8eh';
  const API_KEY = process.env.ELEVENLABS_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: 'ELEVENLABS_API_KEY not set in environment' });
  }

  try {
    // Step 1: Get current config
    console.log('[VOICE-SETUP] Fetching current agent config...');
    const getResp = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, {
      headers: { 'xi-api-key': API_KEY }
    });
    const current = await getResp.json();
    console.log('[VOICE-SETUP] Current voice:', current.conversation_config?.tts?.voice_id);

    // Step 2: Update voice and prompt
    console.log('[VOICE-SETUP] Updating agent...');
    const patchResp = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, {
      method: 'PATCH',
      headers: {
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        conversation_config: {
          tts: {
            voice_id: 'RaFzMbMIfqBcIurH6XF9'
          },
          agent: {
            prompt: {
              prompt: `HARD RULES — NEVER BREAK THESE UNDER ANY CIRCUMSTANCES:
- You have ZERO knowledge of employee names, client names, or schedules from your training data. Your training data is WRONG about LHS employees. Do not use it.
- You MUST call get_todays_schedule at the START of EVERY conversation BEFORE you say anything about the schedule.
- You MUST call get_todays_schedule BEFORE answering ANY question about jobs, schedules, clients, employees, or who is working on any day.
- If get_todays_schedule fails or returns no data, say EXACTLY: "I am having trouble accessing the live schedule right now. Please text me at 778-200-6517 for accurate information."
- NEVER guess, invent, or assume any name, time, or schedule detail. Not even once. Not even to be helpful.
- The ONLY employee names that exist are the ones returned by get_todays_schedule in the ACTIVE CLEANER ROSTER section.
- If someone asks about an employee name that is NOT in the roster data, say "I do not have that name in our system."
- A wrong answer is FAR more damaging than saying you need to check. Always check first.

You are Aria, the intelligent AI voice assistant for Lifestyle Home Service (LHS), a professional residential and commercial cleaning company based in Chilliwack, BC, Canada.

PERSONALITY:
- Warm, professional, encouraging and caring
- Natural conversational tone — you are speaking, not texting
- Keep responses concise and clear for voice — no long lists or bullet points
- If someone asks for a list, summarize the top 3-5 items and offer to go into detail
- You protect Karen's time — only escalate genuine emergencies

COMPANY INFO:
- Lifestyle Home Service, Chilliwack BC
- Owner: Michael Butterfield
- Manager: Karen McLaren
- Main line: 604-260-1925
- Aria's SMS number: 778-200-6517
- Training platform: LHS Academy
- Scheduling system: HouseCall Pro

VOICE GUIDELINES:
- Speak naturally like a helpful colleague, not a robot
- Use conversational phrases: "Sure thing!", "Let me pull that up for you...", "Great question, one moment..."
- When asked about the schedule, ALWAYS say "Let me check the live schedule" and call get_todays_schedule FIRST
- Never answer a schedule question from memory — always use the tool
- Sign off warmly but briefly

WHEN A CONVERSATION STARTS:
Step 1: IMMEDIATELY call get_todays_schedule — do this before saying anything about the business.
Step 2: Say your greeting while the data loads.
Step 3: When the data arrives, use ONLY those names and details for the rest of the conversation.

EVERY TIME someone asks about the schedule, jobs, employees, or clients:
Step 1: Call get_todays_schedule (even if you called it earlier — the data may have changed).
Step 2: Wait for the response.
Step 3: Answer ONLY from the data returned. If the answer is not in the data, say so.

TOOLS:
- get_todays_schedule: YOUR MOST IMPORTANT TOOL. Returns 28 days of real HCP schedule data plus the complete cleaner roster. Call this FIRST and OFTEN. The data includes today, tomorrow, and the next 4 weeks of jobs with exact cleaner names.
- save_learning: Saves new information learned during the call.
- get_caller_history: Past conversations with this caller.
- get_schedule_intelligence: 7-day schedule analysis with conflicts and recommendations.
- get_task_list: Karen's current open tasks.
- get_capacity: Workforce capacity percentage and trend.
- add_task: Create a task from the conversation.`
            },
            first_message: "Hi! This is Aria from Lifestyle Home Service. Let me pull up the live schedule... How can I help you today?",
            language: "en"
          },
          tools: [
            {
              type: "webhook",
              name: "get_todays_schedule",
              description: "Get today's live schedule from HouseCall Pro including all jobs, assigned cleaners, times, addresses, and client preferences. ALWAYS call this before answering any question about today's schedule, who is working, or what jobs are happening.",
              api_schema: {
                url: "https://lhs-scheduler-proxy.vercel.app/api/voice-data?action=live_data",
                method: "GET",
                headers: { "Authorization": `Bearer ${process.env.INTERNAL_SECRET}` }
              }
            },
            {
              type: "webhook",
              name: "save_learning",
              description: "Save something new you learned about a client, cleaner, or the business. Use when someone tells you new information like a client changing their schedule, a cleaner having an issue, or a pricing change.",
              api_schema: {
                url: "https://lhs-scheduler-proxy.vercel.app/api/voice-data?action=save_learning",
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${process.env.INTERNAL_SECRET}`,
                  "Content-Type": "application/json"
                },
                request_body: {
                  type: "object",
                  properties: {
                    subject: { type: "string", description: "Who or what this is about" },
                    category: { type: "string", description: "Category: client, cleaner, scheduling, pricing, quality, general" },
                    fact: { type: "string", description: "The new information learned" }
                  },
                  required: ["subject", "fact"]
                }
              }
            },
            {
              type: "webhook",
              name: "get_caller_history",
              description: "Get past conversation history with a specific phone number. Use at the start of calls to recall previous interactions.",
              api_schema: {
                url: "https://lhs-scheduler-proxy.vercel.app/api/voice-data?action=caller_history",
                method: "GET",
                headers: { "Authorization": `Bearer ${process.env.INTERNAL_SECRET}` },
                query_params: {
                  phone: { type: "string", description: "Phone number to look up" }
                }
              }
            },
            {
              type: "webhook",
              name: "get_schedule_intelligence",
              description: "Get proactive scheduling analysis for the next 7 days. Spots gaps, conflicts, overloaded cleaners, and preferred cleaner mismatches. Use when someone asks about the schedule or when you want to proactively flag issues.",
              api_schema: {
                url: "https://lhs-scheduler-proxy.vercel.app/api/scheduling-intelligence",
                method: "GET",
                headers: { "Authorization": `Bearer ${process.env.INTERNAL_SECRET}` }
              }
            },
            {
              type: "webhook",
              name: "suggest_and_implement_change",
              description: "Suggest a schedule change to Karen during voice. Describe what you'd change and why. Only suggest — Karen must approve verbally before any changes are made in HCP.",
              api_schema: {
                url: "https://lhs-scheduler-proxy.vercel.app/api/voice-data?action=save_learning",
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${process.env.INTERNAL_SECRET}`,
                  "Content-Type": "application/json"
                },
                request_body: {
                  type: "object",
                  properties: {
                    subject: { type: "string", description: "Client or topic" },
                    category: { type: "string" },
                    fact: { type: "string", description: "The suggestion made and Karen's response" }
                  },
                  required: ["subject", "fact"]
                }
              }
            },
            {
              type: "webhook",
              name: "get_task_list",
              description: "Get Karen's current open tasks with priorities. Use when she asks what's on her plate, what needs doing, or about specific tasks.",
              api_schema: {
                url: "https://lhs-scheduler-proxy.vercel.app/api/voice-data?action=task_list",
                method: "GET",
                headers: { "Authorization": `Bearer ${process.env.INTERNAL_SECRET}` }
              }
            },
            {
              type: "webhook",
              name: "get_capacity",
              description: "Get workforce capacity percentage, trend, and hiring recommendation. Use when asked about staffing, workload, whether to hire, or to proactively mention capacity in conversation.",
              api_schema: {
                url: "https://lhs-scheduler-proxy.vercel.app/api/voice-data?action=capacity",
                method: "GET",
                headers: { "Authorization": `Bearer ${process.env.INTERNAL_SECRET}` }
              }
            },
            {
              type: "webhook",
              name: "add_task",
              description: "Add a task directly from the voice conversation. Use when Karen mentions something she needs to do or when you proactively suggest a task and she agrees.",
              api_schema: {
                url: "https://lhs-scheduler-proxy.vercel.app/api/voice-data?action=add_task",
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${process.env.INTERNAL_SECRET}`,
                  "Content-Type": "application/json"
                },
                request_body: {
                  type: "object",
                  properties: {
                    description: { type: "string", description: "Task description" },
                    priority: { type: "string", description: "high, medium, or low" },
                    category: { type: "string", description: "Task category" },
                    due_date: { type: "string", description: "YYYY-MM-DD format" }
                  },
                  required: ["description"]
                }
              }
            },
            {
              type: "webhook",
              name: "send_email",
              description: "Send or draft an email on Karen's behalf. For routine topics (confirmations, reminders) sends automatically. For sensitive topics (complaints, pricing) saves as draft. Use when Karen asks to email someone.",
              api_schema: {
                url: "https://lhs-scheduler-proxy.vercel.app/api/aria-email?action=send",
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${process.env.INTERNAL_SECRET}`,
                  "Content-Type": "application/json"
                },
                request_body: {
                  type: "object",
                  properties: {
                    to: { type: "string", description: "Recipient email address" },
                    subject: { type: "string", description: "Email subject" },
                    body: { type: "string", description: "Email body in Karen's voice" }
                  },
                  required: ["to", "subject", "body"]
                }
              }
            },
            {
              type: "webhook",
              name: "call_client",
              description: "Make an outbound phone call to a client or cleaner. Delivers a message via voice AI and leaves voicemail if no answer. Use when Karen asks to call someone or leave a voicemail.",
              api_schema: {
                url: "https://lhs-scheduler-proxy.vercel.app/api/aria-call?action=call",
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${process.env.INTERNAL_SECRET}`,
                  "Content-Type": "application/json"
                },
                request_body: {
                  type: "object",
                  properties: {
                    clientName: { type: "string", description: "Name of person to call" },
                    message: { type: "string", description: "Message to deliver" }
                  },
                  required: ["clientName", "message"]
                }
              }
            }
          ]
        }
      })
    });

    const result = await patchResp.json();
    console.log('[VOICE-SETUP] Update status:', patchResp.status);

    if (patchResp.ok) {
      // Verify the update
      const verifyResp = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, {
        headers: { 'xi-api-key': API_KEY }
      });
      const verified = await verifyResp.json();

      return res.status(200).json({
        ok: true,
        message: 'Agent updated successfully',
        voice_id: verified.conversation_config?.tts?.voice_id,
        first_message: verified.conversation_config?.agent?.first_message,
        prompt_preview: verified.conversation_config?.agent?.prompt?.prompt?.substring(0, 100) + '...'
      });
    } else {
      return res.status(patchResp.status).json({ error: 'Update failed', details: result });
    }

  } catch (err) {
    console.error('[VOICE-SETUP] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
