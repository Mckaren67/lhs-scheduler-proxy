// Dialpad Learning Cron — runs hourly, processes new call recaps into Aria's knowledge base
// Fetches Dialpad AI recaps, extracts learnings via Claude, creates tasks, updates profiles

export const config = { api: { bodyParser: false }, maxDuration: 60 };

import { getRecentCalls, getCallRecap, getProcessedCallIds, markCallProcessed, identifyLhsPerson } from './_dialpad-client.js';
import { extractLearnings, applyLearnings, buildLearningSummary } from './_dialpad-learner.js';

const KB_SAVE_URL = 'https://lhs-knowledge-base.vercel.app/api/save';
const TZ = 'America/Vancouver';

export default async function handler(req, res) {
  // Accept Vercel cron or auth
  const isCron = req.headers['x-vercel-cron'] === '1';
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (!isCron && auth !== process.env.INTERNAL_SECRET && auth !== 'lhs-aria-internal-2026-secret-key') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startTime = Date.now();
  const results = { callsFound: 0, callsProcessed: 0, callsSkipped: 0, totalLearnings: 0, totalTasks: 0, errors: [] };

  try {
    // 1. Fetch recent calls (last 25 hours — 1 hour overlap for safety)
    const calls = await getRecentCalls(25);
    results.callsFound = calls.length;
    console.log(`[DIALPAD-LEARNER] Found ${calls.length} recent calls`);

    // 2. Get already-processed call IDs
    const processed = await getProcessedCallIds();
    const processedSet = new Set(processed);

    // 3. Process each unprocessed call
    for (const call of calls) {
      if (processedSet.has(call.call_id)) {
        results.callsSkipped++;
        continue;
      }

      try {
        // Get AI recap from Dialpad
        const recap = await getCallRecap(call.call_id);
        if (!recap || (!recap.summary && recap.actionItems.length === 0)) {
          results.callsSkipped++;
          await markCallProcessed(call.call_id);
          continue;
        }

        // Build call metadata
        const callMeta = {
          callId: call.call_id,
          date: new Date(parseInt(call.date_started)).toLocaleDateString('en-CA', { timeZone: TZ }),
          duration: Math.round((call.duration || 0) / 1000) + 's',
          lhsPerson: identifyLhsPerson(call.internal_number),
          contactName: call.contact?.name || 'Unknown',
          contactPhone: call.external_number || '',
          direction: call.direction || 'unknown'
        };

        console.log(`[DIALPAD-LEARNER] Processing: ${callMeta.lhsPerson} ↔ ${callMeta.contactName} (${callMeta.duration})`);

        // Extract learnings via Claude
        const learnings = await extractLearnings(recap, callMeta);

        // Apply learnings (create tasks, update profiles, add to daily queue)
        const applyResult = await applyLearnings(learnings, callMeta);

        // Mark as processed
        await markCallProcessed(call.call_id);

        results.callsProcessed++;
        results.totalLearnings += applyResult.learningsSaved;
        results.totalTasks += applyResult.tasksCreated;

        const summary = buildLearningSummary(callMeta, learnings, applyResult);
        if (summary) console.log(`[DIALPAD-LEARNER] ${summary}`);

      } catch (err) {
        console.error(`[DIALPAD-LEARNER] Error processing call ${call.call_id}:`, err.message);
        results.errors.push({ callId: call.call_id, error: err.message });
        // Still mark as processed to avoid retrying broken calls forever
        await markCallProcessed(call.call_id);
      }
    }

    // 4. Update last run timestamp
    await fetch(KB_SAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'dialpad_learner_status',
        value: {
          lastRun: new Date().toISOString(),
          ...results,
          durationMs: Date.now() - startTime
        }
      })
    });

    console.log(`[DIALPAD-LEARNER] Done: ${results.callsProcessed} processed, ${results.totalLearnings} learnings, ${results.totalTasks} tasks in ${Date.now() - startTime}ms`);
    return res.status(200).json(results);

  } catch (err) {
    console.error('[DIALPAD-LEARNER] Fatal error:', err.message);
    return res.status(500).json({ error: err.message, results });
  }
}
