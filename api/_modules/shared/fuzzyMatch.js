// Fuzzy name matching — finds closest client or cleaner name from partial input
// Handles: first name only, partial last names, nicknames, case differences

const NICKNAMES = {
  mike: 'michael', michael: 'michael',
  kathy: 'kathy', kat: 'kathy', katherine: 'kathy',
  bec: 'rebecca', becky: 'rebecca', becca: 'rebecca',
  nic: 'nicole', nicky: 'nicole',
  gen: 'genevieve',
  dan: 'danielle', dani: 'danielle',
  van: 'vanessa',
  bran: 'brandi',
  hol: 'holly',
  kris: 'kristen',
  mar: 'margret',
  al: 'alissa',
};

export function fuzzyNameMatch(searchName, candidates) {
  if (!searchName || !candidates || candidates.length === 0) return [];

  const search = searchName.toLowerCase().trim().replace(/[^\w\s]/g, '');
  const searchParts = search.split(/\s+/).filter(p => p.length > 0);

  // Expand nicknames
  const expandedParts = searchParts.map(p => NICKNAMES[p] || p);

  const scored = candidates.map(candidate => {
    const name = (typeof candidate === 'string' ? candidate : candidate.name || '').toLowerCase().trim();
    const nameParts = name.split(/\s+/);

    let score = 0;

    // Exact match
    if (name === search) return { candidate, score: 100 };

    // Full search contained in name ("jenna braich" in "jenna braich mcrae")
    if (name.includes(search)) score += 80;

    // Name contained in search
    if (search.includes(name)) score += 70;

    // Score each search word against name parts
    for (const sp of expandedParts) {
      if (sp.length < 2) continue;

      // Word found anywhere in name
      if (name.includes(sp)) score += 30;

      for (const np of nameParts) {
        // Name part starts with search part ("nic" matches "nicole")
        if (np.startsWith(sp)) score += 25;
        // Search part starts with name part ("nicole" matches "nic")
        if (sp.startsWith(np) && np.length >= 3) score += 20;
        // Exact word match
        if (np === sp) score += 35;
      }
    }

    // Bonus: first name exact match is very strong signal
    if (nameParts[0] && expandedParts[0] && nameParts[0] === expandedParts[0]) score += 15;

    return { candidate, score };
  });

  return scored
    .filter(s => s.score > 20)
    .sort((a, b) => b.score - a.score)
    .map(s => typeof s.candidate === 'string' ? s.candidate : s.candidate.name || s.candidate);
}

// Convenience: find best single match
export function bestMatch(searchName, candidates) {
  const matches = fuzzyNameMatch(searchName, candidates);
  return matches.length > 0 ? matches[0] : null;
}
