import {
  executeSearchFlights,
  searchFlightsTool,
} from './flightSearch.js';
import {
  executeGetNotionContent,
  getNotionContentTool,
} from './notionReader.js';
import {
  executeSearchSavedMemories,
  searchSavedMemoriesTool,
} from './memorySearch.js';

const registry = [
  { definition: searchSavedMemoriesTool, execute: executeSearchSavedMemories },
  { definition: searchFlightsTool, execute: executeSearchFlights },
  { definition: getNotionContentTool, execute: executeGetNotionContent },
];

/**
 * Tool definitions for Grok Voice `session.update` (type: function).
 */
export function getGrokToolDefinitions() {
  return registry.map(({ definition: d }) => ({
    type: 'function',
    name: d.name,
    description: d.description,
    parameters: d.parameters,
  }));
}

/**
 * Plain-text list for the system prompt.
 */
export function getToolDescriptionsForPrompt() {
  return registry
    .map(({ definition: d }) => `- ${d.name}: ${d.description}`)
    .join('\n');
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} params
 * @param {{ userId?: string }} [ctx] session context (e.g. Firebase uid for memory search)
 */
export async function executeTool(name, params, ctx = {}) {
  const entry = registry.find((r) => r.definition.name === name);
  if (!entry) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return entry.execute(params, ctx);
}
