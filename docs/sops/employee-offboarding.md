# Employee Offboarding SOP — Lifestyle Home Service

**Version:** 1.0
**Last Updated:** April 10, 2026
**Status:** Active

## Trigger

Karen or Michael texts Aria: "[Name] last day was [date]" or "Offboard [name] — last day [date]"

## Automated Steps (Aria handles)

### Step 1 — Record Last Day
- Mark employee as inactive in knowledge base
- Set last_day field
- Clear their days array to remove from active roster

### Step 2 — Email Bill Gee for ROE
- **To:** bill@canaccess.one
- **CC:** karen@lifestylehomeservice.com
- **Subject:** ROE Request — [Employee Name] — Last Day [Date]
- Bill Gee is Principal at CanAccess Accounting & Business Services Inc, Vernon BC

### Step 6 — Remove from Active Roster
- Clear days array in cleaner profile
- Voice cache automatically excludes them (days.length filter)
- Remove from voice-brain.js active roster

### Step 7 — Reassign Clients
- Identify all clients with this cleaner as preferred
- Clear preferred_cleaner field
- Send Karen list of affected clients for reassignment

## Manual Steps (Karen/Michael via HCP)

### Step 3 — Remote Logout from HCP
- Log into HCP admin
- Find employee profile
- Remote logout all sessions

### Step 4 — Change HCP Password
- Change to standard offboarding password
- Prevents re-login

### Step 5 — Archive Employee in HCP
- Archive (not delete) the employee profile
- Preserves job history and records

## Checklist SMS Sent to Karen

After automated steps complete, Karen receives:

```
Offboarding started for [name]. Last day: [date].

✅ ROE email sent to Bill Gee at bill@canaccess.one
✅ Last day recorded in knowledge base

⚠️ Manual steps still needed:
1. Remote logout [name] from HCP
2. Change HCP password to offboarding standard
3. Archive [name] in HCP

[Name] had [X] clients that need reassignment:
  • [Client 1]
  • [Client 2]
  ...

Reply REASSIGN for Karen to review client list. — Aria
```

## Contacts

- **ROE Processing:** Bill Gee — bill@canaccess.one — CanAccess Accounting, Vernon BC
- **Manager:** Karen McLaren — 604-800-9630
- **Owner:** Michael Butterfield — 604-260-1925
