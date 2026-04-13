// Proxy: ElevenLabs calls /api/voice-brain/v1/chat/completions
// This forwards to the actual voice-brain handler at /api/voice-brain
// ElevenLabs appends /v1/chat/completions to the configured custom LLM URL

import handler from '../../../voice-brain.js';
export const config = { api: { bodyParser: true }, maxDuration: 30 };
export default handler;
