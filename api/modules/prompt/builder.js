// System prompt builder — assembles the full prompt from section modules
// The assembled output must match the original inline prompt character-for-character

import { buildIdentitySection } from './sections/identity.js';
import { buildHolidaysSection } from './sections/holidays.js';
import { buildKnowledgeSection } from './sections/knowledge.js';
import { buildRulesSection } from './sections/rules.js';
import { buildAdminSection } from './sections/admin.js';

/**
 * Build the complete system prompt for Claude.
 *
 * @param {Object} params
 * @param {string} params.pacificDateTime — e.g. "Saturday, April 11, 2026, 10:46 AM"
 * @param {string} params.pacificTzAbbr — e.g. "PDT"
 * @param {string} params.tomorrowDate — e.g. "Sunday, April 12, 2026"
 * @param {string} params.callerContext — caller memory string or empty
 * @param {string} params.scheduleContext — merged schedule + client prefs string
 * @param {boolean} params.isAdmin — whether the caller is an admin
 * @returns {string} The full system prompt
 */
export function buildSystemPrompt({
  pacificDateTime,
  pacificTzAbbr,
  tomorrowDate,
  callerContext,
  scheduleContext,
  isAdmin
}) {
  const base =
    buildIdentitySection({ pacificDateTime, pacificTzAbbr, tomorrowDate }) +
    buildHolidaysSection() +
    buildKnowledgeSection() +
    buildRulesSection({ callerContext, scheduleContext });

  return isAdmin ? base + buildAdminSection() : base;
}
