// api/dialpad-transcripts.js
// Fetches recent Dialpad call transcripts and makes them searchable by Aria
// Deploy to: Mckaren67/lhs-scheduler-proxy/api/dialpad-transcripts.js

export const config = { api: { bodyParser: true } };

const DIALPAD_API_KEY = process.env.DIALPAD_API_KEY;
const DIALPAD_BASE = 'https://dialpad.com/api/v2';

// ─── Helper: call the Dialpad API ────────────────────────────────────────────
async function dialpad(path, params = {}) {
  const url = new URL(`${DIALPAD_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${DIALPAD_API_KEY}`,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Dialpad API ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

// ─── Helper: format a transcript into clean readable text ────────────────────
function formatTranscript(data) {
  if (!data || !data.lines) return null;

  const lines = data.lines
    .filter(l => l.content && l.content.trim())
    .map(l => {
      const speaker = l.speaker_name || (l.is_dialpad_user ? 'LHS' : 'Caller');
      return `${speaker}: ${l.content.trim()}`;
    })
    .join('\n');

  return lines || null;
}

// ─── Helper: format a phone number for display ───────────────────────────────
function fmtPhone(num) {
  if (!num) return 'unknown';
  const d = num.replace(/\D/g, '').slice(-10);
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  return num;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { action, call_id, limit = 20, phone, search } = req.query;

  try {

    // ── ACTION: fetch a single transcript by call_id ──────────────────────────
    if (action === 'transcript' && call_id) {
      const data = await dialpad(`/transcripts/${call_id}`);
      const text = formatTranscript(data);
      return res.status(200).json({
        call_id,
        transcript: text,
        raw: data,
      });
    }

    // ── ACTION: list recent calls (with optional phone filter) ────────────────
    if (action === 'calls' || !action) {
      const params = { limit: Math.min(parseInt(limit), 50) };
      const data = await dialpad('/calls', params);
      const calls = (data.items || data.calls || []).map(c => ({
        call_id: c.id,
        date: c.date_started ? new Date(c.date_started * 1000).toLocaleDateString('en-CA') : 'unknown',
        time: c.date_started ? new Date(c.date_started * 1000).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) : '',
        direction: c.direction || 'unknown',
        duration_min: c.duration ? Math.round(c.duration / 60) : 0,
        from: fmtPhone(c.contact?.phone || c.caller_id),
        to: fmtPhone(c.target?.phone),
        contact_name: c.contact?.name || c.caller_name || null,
        has_transcript: !!c.transcription_available,
        recording_url: c.recording_url || null,
      }));

      // filter by phone number if requested
      const filtered = phone
        ? calls.filter(c => c.from.replace(/\D/g,'').includes(phone.replace(/\D/g,'')) ||
                             c.to.replace(/\D/g,'').includes(phone.replace(/\D/g,'')))
        : calls;

      return res.status(200).json({ total: filtered.length, calls: filtered });
    }

    // ── ACTION: get transcripts for recent calls (bulk) ───────────────────────
    if (action === 'recent_transcripts') {
      const n = Math.min(parseInt(limit), 20);
      const data = await dialpad('/call', { limit: n });
      const calls = data.items || data.calls || [];

      const results = [];
      for (const c of calls) {
        if (!c.transcription_available) continue;
        try {
          const txData = await dialpad(`/transcripts/${c.id}`);
          const text = formatTranscript(txData);
          if (!text) continue;

          // Search filter
          if (search && !text.toLowerCase().includes(search.toLowerCase()) &&
              !(c.contact?.name || '').toLowerCase().includes(search.toLowerCase())) {
            continue;
          }

          results.push({
            call_id: c.id,
            date: c.date_started ? new Date(c.date_started * 1000).toLocaleDateString('en-CA') : 'unknown',
            duration_min: c.duration ? Math.round(c.duration / 60) : 0,
            contact_name: c.contact?.name || c.caller_name || 'Unknown',
            from: fmtPhone(c.contact?.phone || c.caller_id),
            direction: c.direction,
            transcript: text,
          });
        } catch (e) {
          // transcript not available for this call — skip
        }
      }

      return res.status(200).json({ total: results.length, transcripts: results });
    }

    // ── ACTION: ai_recap — get Dialpad AI summary of a call ──────────────────
    if (action === 'recap' && call_id) {
      const data = await dialpad(`/calls/${call_id}/ai_recap`);
      return res.status(200).json({ call_id, recap: data });
    }

    return res.status(400).json({
      error: 'Unknown action',
      usage: 'Use ?action=calls, ?action=transcript&call_id=X, ?action=recent_transcripts&limit=10&search=keyword, ?action=recap&call_id=X',
    });

  } catch (err) {
    console.error('Dialpad error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
