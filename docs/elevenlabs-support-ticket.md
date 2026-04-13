# ElevenLabs Support Ticket

## Subject
Custom LLM returns 200 but Twilio calls fail with error 1002 "custom_llm generation failed"

## Agent ID
agent_5301knm3eyy7en7snw8gf72ht8eh

## Issue
Our custom LLM endpoint works perfectly when called from the ElevenLabs web widget. When the same agent receives calls via Twilio phone integration — every call fails with termination_reason: "custom_llm generation failed", error code 1002.

## Confirmed Working
- Web widget calls — all succeed — status "done"
- Direct API test of our endpoint returns 200
- Streaming response with correct OpenAI format
- First token delivered in under 1500ms

## Confirmed Failing
- All Twilio inbound phone calls — 7 calls tested
- All fail with error 1002 within 7-14 seconds
- Twilio webhook set to: api.elevenlabs.io/twilio/inbound_call
- Custom LLM URL: lhs-scheduler-proxy.vercel.app/api/voice-brain
- api_type: chat_completions
- This means ElevenLabs calls our endpoint at: lhs-scheduler-proxy.vercel.app/api/voice-brain/v1/chat/completions

## Our Endpoint Response Format
We return OpenAI compatible streaming format:

```
data: {"id":"msg","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"text"},"finish_reason":null}]}
```

Final chunk:
```
data: {"id":"msg","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}
data: [DONE]
```

## What We Need To Know
1. Does the Twilio integration require a different request format than the widget integration?
2. Are there specific headers required for Twilio path that are not needed for widget?
3. Is there a different timeout threshold for Twilio calls vs widget calls?
4. Does the Twilio integration require any specific ElevenLabs dashboard configuration that cannot be done via API?
5. Are there any logs on your end showing what our endpoint is returning when the Twilio call fails?

## Environment
- Node.js on Vercel serverless functions
- Streaming response using res.write()
- Content-Type: text/event-stream
- Transfer-Encoding: chunked

Please advise on the correct configuration for Twilio custom LLM integration.

---
