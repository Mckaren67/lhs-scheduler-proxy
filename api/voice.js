// Twilio → ElevenLabs voice bridge
// Returns TwiML that connects an incoming Twilio call to the ElevenLabs
// conversational AI agent via WebSocket <Connect><Stream>.
// Twilio webhook: POST /api/voice

const ELEVENLABS_AGENT_ID = 'agent_5301knm3eyy7en7snw8gf72ht8eh';

export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/xml');

  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${ELEVENLABS_AGENT_ID}" />
  </Connect>
</Response>`);
}
