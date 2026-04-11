// Shared Knowledge Base read/write — single source of truth
// Replaces the identical kbRead/kbWrite duplicated across 12 files

const KB_URL = 'https://lhs-knowledge-base.vercel.app/api/save';

export async function kbRead(key) {
  try {
    const res = await fetch(`${KB_URL}?key=${key}`);
    const data = await res.json();
    return data.value || [];
  } catch (err) {
    console.error(`[KB] Read failed for ${key}:`, err.message);
    return [];
  }
}

export async function kbWrite(key, value) {
  try {
    await fetch(KB_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value })
    });
  } catch (err) {
    console.error(`[KB] Write failed for ${key}:`, err.message);
  }
}

export async function kbReadRaw(key) {
  try {
    const res = await fetch(`${KB_URL}?key=${key}`);
    const data = await res.json();
    return data.value;
  } catch (err) {
    console.error(`[KB] ReadRaw failed for ${key}:`, err.message);
    return null;
  }
}

export { KB_URL };
