// Persona store — loads client, cleaner, and management personas from KB
// Used by voice-brain.js and incoming-sms.js for contextually aware answers

const KB_SAVE_URL = 'https://lhs-knowledge-base.vercel.app/api/save';

// In-memory cache
let clientPersonas = null;
let cleanerPersonas = null;
let mgmtPersonas = null;
let cacheAge = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 min

async function loadAll() {
  if (clientPersonas && (Date.now() - cacheAge) < CACHE_TTL) return;
  try {
    const [cr, er, mr] = await Promise.all([
      fetch(`${KB_SAVE_URL}?key=aria_client_personas`).then(r => r.json()),
      fetch(`${KB_SAVE_URL}?key=aria_employee_personas`).then(r => r.json()),
      fetch(`${KB_SAVE_URL}?key=aria_management_personas`).then(r => r.json())
    ]);
    clientPersonas = cr.value || [];
    cleanerPersonas = er.value || [];
    mgmtPersonas = mr.value || [];
    cacheAge = Date.now();
  } catch (e) {
    if (!clientPersonas) clientPersonas = [];
    if (!cleanerPersonas) cleanerPersonas = [];
    if (!mgmtPersonas) mgmtPersonas = [];
  }
}

export async function getClientPersona(name) {
  await loadAll();
  const q = name.toLowerCase();
  return clientPersonas.find(p => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase()));
}

export async function getCleanerPersona(name) {
  await loadAll();
  const q = name.toLowerCase();
  return cleanerPersonas.find(p => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase()));
}

export async function getManagementPersonas() {
  await loadAll();
  return mgmtPersonas;
}

// Build a context string for a specific person mentioned in conversation
export async function getPersonaContext(query) {
  await loadAll();
  const q = query.toLowerCase();
  const parts = [];

  // Check clients
  const client = clientPersonas.find(p => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase().split(' ')[0]));
  if (client) {
    let ctx = `CLIENT PERSONA — ${client.name}:`;
    if (client.priority) ctx += ` ${client.priority} priority.`;
    if (client.client_type) ctx += ` ${client.client_type}.`;
    if (client.communication_preference) ctx += ` Communication: ${client.communication_preference}.`;
    if (client.scheduling_rhythm) ctx += ` Schedule: ${client.scheduling_rhythm}.`;
    if (client.preferred_cleaner) ctx += ` Preferred cleaner: ${client.preferred_cleaner}.`;
    if (client.personality_notes?.length) ctx += ` Notes: ${client.personality_notes.join('. ')}.`;
    if (client.special_considerations?.length) ctx += ` Special: ${client.special_considerations.join('. ')}.`;
    if (client.payment_behaviour) ctx += ` Payment: ${client.payment_behaviour}.`;
    parts.push(ctx);
  }

  // Check cleaners
  const cleaner = cleanerPersonas.find(p => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase().split(' ')[0]));
  if (cleaner) {
    let ctx = `CLEANER PERSONA — ${cleaner.name}:`;
    if (cleaner.scheduling_patterns?.length) ctx += ` ${cleaner.scheduling_patterns.join('. ')}.`;
    if (cleaner.availability_note) ctx += ` ${cleaner.availability_note}.`;
    if (cleaner.strengths?.length) ctx += ` Strengths: ${cleaner.strengths.join(', ')}.`;
    if (cleaner.reliability_notes?.length) ctx += ` Reliability: ${cleaner.reliability_notes.join(', ')}.`;
    if (cleaner.personality_notes?.length) ctx += ` Notes: ${cleaner.personality_notes.join('. ')}.`;
    parts.push(ctx);
  }

  return parts.join('\n');
}

// Look up a persona by phone number — checks clients then HCP customers API
export async function getPersonaByPhone(phone) {
  if (!phone) return '';
  await loadAll();
  const digits = phone.replace(/\D/g, '');

  // Check client personas for phone match (if they have phone fields)
  if (clientPersonas) {
    for (const p of clientPersonas) {
      const pStr = JSON.stringify(p).replace(/\D/g, '');
      if (digits.length >= 7 && pStr.includes(digits.slice(-7))) {
        let ctx = `CALLER MATCHED CLIENT — ${p.name}:`;
        if (p.priority) ctx += ` ${p.priority} priority.`;
        if (p.client_type) ctx += ` ${p.client_type}.`;
        if (p.scheduling_rhythm) ctx += ` Schedule: ${p.scheduling_rhythm}.`;
        if (p.preferred_cleaner) ctx += ` Preferred cleaner: ${p.preferred_cleaner}.`;
        if (p.personality_notes?.length) ctx += ` Notes: ${p.personality_notes.join('. ')}.`;
        return ctx;
      }
    }
  }

  // Check cleaner personas
  if (cleanerPersonas) {
    for (const p of cleanerPersonas) {
      const pStr = JSON.stringify(p).replace(/\D/g, '');
      if (digits.length >= 7 && pStr.includes(digits.slice(-7))) {
        let ctx = `CALLER MATCHED CLEANER — ${p.name}:`;
        if (p.scheduling_patterns?.length) ctx += ` ${p.scheduling_patterns.join('. ')}.`;
        if (p.strengths?.length) ctx += ` Strengths: ${p.strengths.join(', ')}.`;
        return ctx;
      }
    }
  }

  // Try HCP customers API for real-time phone lookup
  try {
    const apiKey = process.env.HCP_API_KEY;
    if (apiKey && digits.length >= 10) {
      const resp = await fetch(`https://api.housecallpro.com/customers?phone_number=${digits.slice(-10)}&page_size=1`, {
        headers: { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' }
      });
      if (resp.ok) {
        const data = await resp.json();
        const customer = data.customers?.[0];
        if (customer) {
          return `CALLER MATCHED HCP CLIENT — ${customer.first_name} ${customer.last_name}: ${customer.email || 'no email'}. Address: ${customer.addresses?.[0]?.street || 'unknown'}.`;
        }
      }
    }
  } catch (e) {}

  return '';
}

// Get all management context (always loaded)
export async function getManagementContext() {
  await loadAll();
  return mgmtPersonas.map(m => {
    let ctx = `${m.name} (${m.role}): ${m.decision_style}. Communication: ${m.communication_preference}.`;
    if (m.scheduling_philosophy) ctx += ` Philosophy: ${m.scheduling_philosophy}.`;
    if (m.pet_peeves?.length) ctx += ` Pet peeves: ${m.pet_peeves.join(', ')}.`;
    return ctx;
  }).join('\n');
}
