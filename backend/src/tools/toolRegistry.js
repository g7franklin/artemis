import {
  executeSearchFlights,
  searchFlightsTool,
} from './flightSearch.js';
import {
  executeGetNotionContent,
  getNotionContentTool,
} from './notionReader.js';

const registry = [
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
 */
export async function executeTool(name, params) {
  const entry = registry.find((r) => r.definition.name === name);
  if (!entry) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return entry.execute(params);
}
