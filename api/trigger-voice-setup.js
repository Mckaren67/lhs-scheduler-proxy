// One-shot trigger: calls setup-voice-agent internally using server-side env vars
// DELETE THIS FILE after successful run
// Usage: GET /api/trigger-voice-setup?confirm=yes

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.query.confirm !== 'yes') {
    return res.status(200).json({
      message: 'Add ?confirm=yes to trigger voice agent setup.',
      warning: 'Delete this file after use.'
    });
  }

  const secret = process.env.INTERNAL_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'INTERNAL_SECRET not configured' });
  }

  try {
    // Call setup-voice-agent internally with the server-side secret
    const baseUrl = `https://${req.headers.host}`;
    const resp = await fetch(`${baseUrl}/api/setup-voice-agent?run=true`, {
      headers: { 'Authorization': `Bearer ${secret}` }
    });
    const result = await resp.json();

    return res.status(resp.status).json({
      trigger: 'voice-setup',
      status: resp.status,
      result,
      note: 'DELETE api/trigger-voice-setup.js after confirming success'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
