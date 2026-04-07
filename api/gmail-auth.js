// One-time Gmail OAuth flow
// Step 1: Visit /api/gmail-auth → redirects to Google consent screen
// Step 2: Google redirects back to /api/gmail-auth?code=XXX → exchanges for tokens
// Step 3: Displays the refresh token — copy it to Vercel as GMAIL_REFRESH_TOKEN
// Delete this file after setup is complete.

export default async function handler(req, res) {
  const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
  const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).send('Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in Vercel environment variables.');
  }

  const REDIRECT_URI = 'https://lhs-scheduler-proxy.vercel.app/api/gmail-auth';

  const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.modify'
  ].join(' ');

  // Step 2: Google redirected back with a code — exchange for tokens
  if (req.query.code) {
    try {
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: req.query.code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code'
        }).toString()
      });

      const tokens = await tokenResp.json();

      if (tokens.error) {
        return res.status(400).send(`
          <html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:20px">
          <h2 style="color:#c0392b">OAuth Error</h2>
          <p><strong>${tokens.error}</strong>: ${tokens.error_description || 'Unknown error'}</p>
          <p><a href="/api/gmail-auth">Try again</a></p>
          </body></html>
        `);
      }

      const refreshToken = tokens.refresh_token;
      const accessToken = tokens.access_token;

      // Verify by fetching profile
      let email = 'unknown';
      try {
        const profileResp = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const profile = await profileResp.json();
        email = profile.emailAddress || 'unknown';
      } catch (e) {}

      return res.status(200).send(`
        <html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:20px">
        <h2 style="color:#2d6a4f">Gmail OAuth — Success!</h2>
        <p>Authorized as: <strong>${email}</strong></p>

        ${refreshToken ? `
        <h3>Refresh Token</h3>
        <p style="background:#f5f5f3;padding:12px;border-radius:8px;word-break:break-all;font-family:monospace;font-size:13px">${refreshToken}</p>

        <h3>Next Steps</h3>
        <ol>
          <li>Copy the refresh token above</li>
          <li>Go to <a href="https://vercel.com/Mckaren67/lhs-scheduler-proxy/settings/environment-variables" target="_blank">Vercel Environment Variables</a></li>
          <li>Add: <strong>GMAIL_REFRESH_TOKEN</strong> = the token above</li>
          <li>Add: <strong>GMAIL_USER_EMAIL</strong> = ${email}</li>
          <li>Redeploy the project</li>
          <li>Delete this file (api/gmail-auth.js) — it is no longer needed</li>
        </ol>
        ` : `
        <p style="color:#b5631a"><strong>No refresh token returned.</strong> This usually means you have already authorized this app before.
        To get a new refresh token, <a href="https://myaccount.google.com/permissions" target="_blank">revoke access here</a>,
        then <a href="/api/gmail-auth">try again</a>.</p>
        `}

        <h3>Tokens Received</h3>
        <pre style="background:#f5f5f3;padding:12px;border-radius:8px;font-size:12px;overflow-x:auto">${JSON.stringify({
          access_token: accessToken ? accessToken.substring(0, 20) + '...' : null,
          refresh_token: refreshToken ? refreshToken.substring(0, 20) + '...' : null,
          expires_in: tokens.expires_in,
          token_type: tokens.token_type,
          scope: tokens.scope
        }, null, 2)}</pre>
        </body></html>
      `);

    } catch (err) {
      return res.status(500).send(`
        <html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:20px">
        <h2 style="color:#c0392b">Token Exchange Failed</h2>
        <p>${err.message}</p>
        <p><a href="/api/gmail-auth">Try again</a></p>
        </body></html>
      `);
    }
  }

  // Step 1: Redirect to Google consent screen
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent'
  }).toString();

  return res.redirect(302, authUrl);
}
