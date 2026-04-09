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
