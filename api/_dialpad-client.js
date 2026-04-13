// Dialpad API client — fetches calls, AI recaps, and manages processed call tracking
// Used by dialpad-learner-cron.js and incoming-sms.js

const DIALPAD_BASE = 'https://dialpad.com/api/v2';
const KB_SAVE_URL = 'https://lhs-knowledge-base.vercel.app/api/save';
const PROCESSED_KEY = 'dialpad_processed_calls';

// LHS staff phone numbers
const LHS_PHONES = ['+16048009630', '+16046180336', '+16048005749', '+16042601925', '+16043349514'];

function getKey() { return process.env.DIALPAD_API_KEY; }

async function dialpadGet(path) {
  const r = await fetch(`${DIALPAD_BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${getKey()}`, 'Accept': 'application/json' }
  });
  if (!r.ok) return null;
  return r.json();
}

// ─── Fetch recent calls ────────────────────────────────────────────────────
export async function getRecentCalls(hoursBack = 25) {
  try {
    const data = await dialpadGet('/call?limit=50');
    if (!data?.items) return [];

    const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;
    return data.items.filter(c => {
      const started = parseInt(c.date_started || '0');
      const dur = (c.duration || 0) / 1000; // convert ms to seconds
      return started > cutoff && dur > 30; // only calls over 30 seconds
    });
  } catch (e) {
    console.error('[DIALPAD] getRecentCalls error:', e.message);
    return [];
  }
}

// ─── Get AI recap for a call ────────────────────────────────────────────────
export async function getCallRecap(callId) {
  try {
    const data = await dialpadGet(`/call/${callId}/ai_recap`);
    if (!data) return null;
    return {
      callId,
      summary: data.summary?.content || '',
      actionItems: (data.action_items || []).map(a => a.content),
      purposes: (data.purposes || []).map(p => p.content || p.format),
      isInternal: data.is_internal_call || false
    };
  } catch (e) {
    console.error(`[DIALPAD] getCallRecap error for ${callId}:`, e.message);
    return null;
  }
}

// ─── Get full call detail ───────────────────────────────────────────────────
export async function getCallDetail(callId) {
  return dialpadGet(`/call/${callId}`);
}

// ─── Processed call tracking (Redis) ────────────────────────────────────────
export async function getProcessedCallIds() {
  try {
    const r = await fetch(`${KB_SAVE_URL}?key=${PROCESSED_KEY}`);
    const d = await r.json();
    return d.value || [];
  } catch { return []; }
}

export async function markCallProcessed(callId) {
  try {
    const existing = await getProcessedCallIds();
    // Keep last 200 entries, add new one
    const updated = [...existing.slice(-199), callId];
    await fetch(KB_SAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: PROCESSED_KEY, value: updated })
    });
  } catch (e) {
    console.error('[DIALPAD] markCallProcessed error:', e.message);
  }
}

// ─── Identify LHS person from phone number ──────────────────────────────────
export function identifyLhsPerson(internalNumber) {
  if (internalNumber?.includes('6048009630')) return 'Karen';
  if (internalNumber?.includes('6042601925')) return 'Michael';
  if (internalNumber?.includes('6046180336')) return 'Michael';
  if (internalNumber?.includes('6048005749')) return 'Michael';
  return 'LHS Staff';
}
