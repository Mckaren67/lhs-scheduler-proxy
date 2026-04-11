// Shared Twilio SMS sending — single source of truth
// Replaces the identical sendSMS/sendSMSNotification duplicated across 16 files

const KAREN_PHONE = '+16048009630';
const MICHAEL_PHONE = '+16042601925';

export async function sendSMS(to, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const toPhone = to.startsWith('+') ? to : to.length === 10 ? `+1${to}` : `+${to}`;

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ To: toPhone, From: from, Body: message }).toString()
    }
  );
  return response.json();
}

export { KAREN_PHONE, MICHAEL_PHONE };
