// Twilio → ElevenLabs voice bridge
// Gets a signed WebSocket URL from ElevenLabs, then returns TwiML
// that connects the incoming Twilio call via <Connect><Stream>.
// Twilio webhook: POST /api/voice

const ELEVENLABS_AGENT_ID = 'agent_5301knm3eyy7en7snw8gf72ht8eh';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/xml');

  try {
    // Get a signed WebSocket URL from ElevenLabs (includes auth)
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${ELEVENLABS_AGENT_ID}`,
      { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } }
    );

    if (!resp.ok) {
      console.error('[VOICE] ElevenLabs signed URL failed:', resp.status, await resp.text());
      // Fallback: answer with a spoken apology
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Thank you for calling Lifestyle Home Service. Our voice assistant is temporarily unavailable. Please text Aria at 778-200-6517 or call Karen at 604-260-1925. Thank you!</Say>
</Response>`);
    }

    const { signed_url } = await resp.json();
    console.log('[VOICE] Got signed URL, connecting caller to ElevenLabs');

    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${signed_url}" />
  </Connect>
</Response>`);
  } catch (err) {
    console.error('[VOICE] Error:', err.message);
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Thank you for calling Lifestyle Home Service. Our voice assistant is temporarily unavailable. Please text Aria at 778-200-6517 or call Karen at 604-260-1925. Thank you!</Say>
</Response>`);
  }
}
