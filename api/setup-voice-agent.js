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
              prompt: `You are Aria, the intelligent AI voice assistant for Lifestyle Home Service (LHS), a professional residential and commercial cleaning company based in Chilliwack, BC, Canada.

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

YOUR KNOWLEDGE:
- You know 177 clients and their preferences, preferred cleaners, and scheduling patterns
- You know 20 active cleaners and their availability, specialties, and work days
- You can answer questions about today's schedule, who is working where, and client details
- You know LHS cleaning procedures, safety protocols, and training requirements
- You know BC statutory holidays and their impact on scheduling

VOICE GUIDELINES:
- Speak naturally like a helpful colleague, not a robot
- Use conversational phrases: "Sure thing!", "Great question!", "Let me think about that..."
- When you don't know something specific, say so honestly and offer to have Karen follow up
- For complex scheduling questions, suggest texting Aria at 778-200-6517 for detailed data
- Sign off warmly but briefly — no need for "LHS" signature on voice calls

WHAT YOU CAN HELP WITH:
- Schedule questions: who is working today, what jobs are scheduled
- Client information: preferences, preferred cleaners, contact details
- Employee questions: availability, training status, time off
- Cleaning procedures: how to clean specific areas, safety protocols
- General LHS information: policies, contact numbers, training requirements

YOU ARE A LEARNING AGENT:
- You remember every conversation — use get_caller_history to check past interactions
- Always call get_live_data at the start of any schedule question to get real-time data
- When you learn something new about a client, cleaner, or the business, save it immediately with save_learning
- You proactively share patterns you notice: "I've noticed Brandi has called in sick 3 times this month"
- If someone tells you something that changes a client's preference or a cleaner's availability, save it
- Reference past conversations naturally: "Last time we talked you mentioned the Tannis pricing update"

TOOLS AVAILABLE:
- get_live_data: Fetches real-time schedule, task list, and urgent flags. Call this BEFORE answering any schedule question.
- save_learning: Saves a new fact about a client, cleaner, or the business. Use proactively when you discover new information.
- get_caller_history: Retrieves past conversation history. Use at the start of conversations to personalize your response.`
            },
            first_message: "Hi! This is Aria from Lifestyle Home Service. How can I help you today?",
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
