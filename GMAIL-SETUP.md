# Gmail Integration for Aria — LHS

## Current Setup (Active)

Gmail monitoring and email sending run as **Claude Code scheduled tasks** using the Gmail MCP connector that's already authenticated in this session.

### Scheduled Tasks

| Task | Schedule | What it does |
|------|----------|-------------|
| `gmail-monitor` | Every 15 minutes | Checks Karen's inbox for new unread emails, drafts warm responses, texts Karen |
| `afternoon-email-briefing` | 3:30 PM PT daily | Sends Karen an evening agenda email with tomorrow's schedule and priorities |

### How it works
- Uses Gmail MCP tools (gmail_search_messages, gmail_read_message, gmail_create_draft)
- OAuth is managed by the MCP connector — no separate credentials needed
- Tasks only run while a Claude Code session is active

### Important Notes
- Tasks expire after 7 days of the session being active — recreate if needed
- Aria NEVER sends emails automatically — only creates drafts for Karen to review
- SMS notifications go to Karen at +16048009630 via the Twilio API

## Future Setup (When Google Cloud OAuth is needed)

If you want Gmail monitoring to run independently on Vercel (24/7, no Claude session needed):

### Step 1: Create Google Cloud Project
1. Go to https://console.cloud.google.com
2. Create new project: "LHS Aria"
3. Enable the Gmail API: APIs & Services → Library → Gmail API → Enable

### Step 2: Create OAuth Credentials
1. APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
2. Application type: Web application
3. Authorized redirect URIs: `https://lhs-scheduler-proxy.vercel.app/api/gmail-callback`
4. Save the Client ID and Client Secret

### Step 3: Get Refresh Token
1. Build a one-time auth flow to get Karen's consent
2. Exchange the authorization code for a refresh token
3. Store the refresh token securely

### Step 4: Add to Vercel Environment Variables
```
GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REFRESH_TOKEN=your-refresh-token
GMAIL_USER_EMAIL=karen@lifestylehomeservice.com
```

### Step 5: Build gmail-monitor.js endpoint
Use the refresh token to get access tokens on each request, then call Gmail API directly.
