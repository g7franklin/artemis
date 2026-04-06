import { retrieveMemories } from '../memory/pinecone.js';

/**
 * @param {{ query?: string }} params
 * @param {{ userId?: string }} [ctx]
 */
export async function executeSearchSavedMemories(params, ctx = {}) {
  const uid = ctx.userId;
  if (!uid || typeof uid !== 'string') {
    return { error: 'internal_error', memories: [] };
  }
  const q = typeof params.query === 'string' ? params.query.trim() : '';
  if (!q) {
    return { memories: [], message: 'Provide a non-empty search query.' };
  }

  const topK = Math.min(
    25,
    Math.max(8, Number(process.env.MEMORY_TOOL_TOP_K) || 18)
  );
  const hits = await retrieveMemories(q, uid, topK);

  return {
    memories: hits.map((h) => ({
      text: h.text,
      category: h.category || undefined,
      score: Math.round((h.score ?? 0) * 1000) / 1000,
    })),
    count: hits.length,
  };
}

export const searchSavedMemoriesTool = {
  name: 'search_saved_memories',
  description:
    "Search Greg's long-term saved memories from past conversations (Pinecone). " +
    'Use this when Greg asks what you remember about him, who someone is (partner, friend, family, coworker), ' +
    'past events, preferences, or any fact that might have been stored earlier. ' +
    'Call before answering if unsure — pass a short natural-language query (e.g. "girlfriend partner relationship", "mother family", "job employer"). ' +
    'Higher score means closer semantic match.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Natural language search: people, topics, or facts to find in saved memory',
      },
    },
    required: ['query'],
  },
};
