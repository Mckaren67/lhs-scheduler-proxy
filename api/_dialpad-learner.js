// Dialpad Learning Engine — extracts learnings from call recaps using Claude
// Then applies them to the knowledge base (tasks, client/cleaner profiles, daily learnings)

const KB_TASK_API = 'https://lhs-knowledge-base.vercel.app/api/tasks';
const KB_SAVE_URL = 'https://lhs-knowledge-base.vercel.app/api/save';
const TASK_TOKEN = process.env.INTERNAL_SECRET || 'lhs-aria-internal-2026-secret-key';
const TZ = 'America/Vancouver';

// ─── Extract learnings via Claude ───────────────────────────────────────────
export async function extractLearnings(recap, callMeta) {
  const prompt = `You are Aria's learning system for Lifestyle Home Service in Chilliwack BC.

A phone call just completed. Dialpad AI has already summarized it. Extract learnings for Aria's knowledge base.

CALL DETAILS:
Date: ${callMeta.date}
Duration: ${callMeta.duration}
LHS person: ${callMeta.lhsPerson}
Other party: ${callMeta.contactName} (${callMeta.contactPhone})
Direction: ${callMeta.direction}

DIALPAD AI SUMMARY:
${recap.summary}

DIALPAD ACTION ITEMS:
${recap.actionItems.map(a => '- ' + a).join('\n') || 'None'}

Extract learnings in these categories. Return ONLY valid JSON — no other text.
{
  "clientPreferences": [{ "clientName": "string or null", "learning": "string", "confidence": "high|medium|low" }],
  "clientAccountUpdates": [{ "clientName": "string or null", "update": "string", "confidence": "high|medium|low" }],
  "cleanerUpdates": [{ "cleanerName": "string or null", "update": "string", "confidence": "high|medium|low" }],
  "actionItems": [{ "title": "string", "assignee": "karen|aria|michael", "priority": "urgent|important|normal", "category": "scheduling|client|staff|ar|operations|admin|communications|urgent" }],
  "generalLearnings": [{ "learning": "string", "confidence": "high|medium|low" }]
}
Return empty arrays for categories with no learnings.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await r.json();
    const text = data.content?.[0]?.text || '{}';
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('[LEARNER] extractLearnings error:', e.message);
    return null;
  }
}

// ─── Apply learnings to knowledge base ──────────────────────────────────────
export async function applyLearnings(learnings, callMeta) {
  if (!learnings) return { tasksCreated: 0, learningsSaved: 0 };

  let tasksCreated = 0;
  let learningsSaved = 0;

  try {
    // Create tasks from action items
    for (const item of (learnings.actionItems || [])) {
      await fetch(KB_TASK_API, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TASK_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: item.title,
          assigned_to: item.assignee || 'karen',
          priority: item.priority || 'normal',
          category: item.category || 'admin',
          source_message: `Auto-created from Dialpad call with ${callMeta.contactName} on ${callMeta.date}`,
          notes: `From ${callMeta.lhsPerson}'s call with ${callMeta.contactName}`
        })
      });
      tasksCreated++;
    }

    // Save all learnings to daily learning queue
    const allLearnings = [
      ...(learnings.clientPreferences || []).map(l => ({ type: 'client_preference', ...l })),
      ...(learnings.clientAccountUpdates || []).map(l => ({ type: 'client_account', ...l })),
      ...(learnings.cleanerUpdates || []).map(l => ({ type: 'cleaner_update', ...l })),
      ...(learnings.generalLearnings || []).map(l => ({ type: 'general', ...l }))
    ];

    if (allLearnings.length > 0) {
      // Add to daily learnings for 7pm review
      const key = 'aria_daily_learnings';
      const existing = await fetch(`${KB_SAVE_URL}?key=${key}`).then(r => r.json()).then(d => d.value || []).catch(() => []);
      const entry = {
        source: 'dialpad_call',
        callId: callMeta.callId,
        date: callMeta.date,
        lhsPerson: callMeta.lhsPerson,
        contactName: callMeta.contactName,
        learnings: allLearnings,
        summary: `From ${callMeta.lhsPerson}'s call with ${callMeta.contactName}: ${allLearnings.length} learnings, ${tasksCreated} tasks created`,
        createdAt: new Date().toISOString()
      };
      existing.push(entry);
      // Keep last 100 entries
      await fetch(KB_SAVE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: existing.slice(-100) })
      });
      learningsSaved = allLearnings.length;
    }

    // Log the processing
    const logKey = 'dialpad_learning_log';
    const logExisting = await fetch(`${KB_SAVE_URL}?key=${logKey}`).then(r => r.json()).then(d => d.value || []).catch(() => []);
    logExisting.push({
      callId: callMeta.callId,
      date: callMeta.date,
      contactName: callMeta.contactName,
      lhsPerson: callMeta.lhsPerson,
      tasksCreated,
      learningsSaved,
      processedAt: new Date().toISOString()
    });
    await fetch(KB_SAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: logKey, value: logExisting.slice(-200) })
    });

  } catch (e) {
    console.error('[LEARNER] applyLearnings error:', e.message);
  }

  return { tasksCreated, learningsSaved };
}

// ─── Build summary for evening review ───────────────────────────────────────
export function buildLearningSummary(callMeta, learnings, results) {
  if (!learnings) return null;
  const total = (learnings.clientPreferences?.length || 0) +
    (learnings.clientAccountUpdates?.length || 0) +
    (learnings.cleanerUpdates?.length || 0) +
    (learnings.generalLearnings?.length || 0);

  if (total === 0 && results.tasksCreated === 0) return null;

  let summary = `From ${callMeta.lhsPerson}'s call with ${callMeta.contactName} on ${callMeta.date} — ${total} learnings captured`;
  if (results.tasksCreated > 0) summary += `, ${results.tasksCreated} tasks created`;

  const highlights = [];
  for (const l of (learnings.clientPreferences || []).slice(0, 2)) highlights.push(l.learning);
  for (const l of (learnings.cleanerUpdates || []).slice(0, 2)) highlights.push(l.update);
  for (const l of (learnings.generalLearnings || []).slice(0, 2)) highlights.push(l.learning);

  if (highlights.length > 0) summary += ':\n' + highlights.map(h => '- ' + h).join('\n');
  return summary;
}
