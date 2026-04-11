// Tool registry — central registration point for all tool definitions and handlers
// Replaces the 17-deep if/else-if dispatch chain in incoming-sms.js

const tools = new Map();

/**
 * Register a tool with its definition and handler.
 * Called at module load time by each definition file.
 *
 * @param {string} name — tool name (e.g. 'save_task')
 * @param {Object} definition — Claude tool schema { name, description, input_schema }
 * @param {Function} handler — async (input, ctx) => string (the reply text)
 */
export function registerTool(name, definition, handler) {
  tools.set(name, { definition, handler });
}

/**
 * Get all registered tool definitions for Claude's tools array.
 * @returns {Array} Array of tool definition objects
 */
export function getToolDefinitions() {
  return Array.from(tools.values()).map(t => t.definition);
}

/**
 * Get the handler function for a named tool.
 * @param {string} name — tool name
 * @returns {Function|null} The handler function or null
 */
export function getToolHandler(name) {
  return tools.get(name)?.handler || null;
}

/**
 * Check if a tool is registered.
 * @param {string} name — tool name
 * @returns {boolean}
 */
export function hasHandler(name) {
  return tools.has(name);
}

/**
 * Get count of registered tools (for verification).
 * @returns {number}
 */
export function getToolCount() {
  return tools.size;
}

/**
 * Get all registered tool names (for verification).
 * @returns {string[]}
 */
export function getToolNames() {
  return Array.from(tools.keys());
}
