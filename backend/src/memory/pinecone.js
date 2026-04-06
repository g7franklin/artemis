import { Pinecone } from '@pinecone-database/pinecone';
import { randomUUID } from 'crypto';
import { generateEmbedding } from './embeddings.js';

let pinecone = null;

function getIndex() {
  const apiKey = process.env.PINECONE_API_KEY;
  const indexName = process.env.PINECONE_INDEX_NAME || 'artemis-memory';
  if (!apiKey) {
    throw new Error('Missing PINECONE_API_KEY');
  }
  if (!pinecone) {
    pinecone = new Pinecone({ apiKey });
  }
  return pinecone.index(indexName);
}

function ns(userId) {
  return getIndex().namespace(userId);
}

/**
 * @param {string} text
 * @param {{ userId: string, category: string, timestamp: string, status?: string }} metadata
 * @returns {Promise<{ id: string }>}
 */
export async function storeMemory(text, metadata) {
  const vector = await generateEmbedding(text);
  const id = randomUUID();
  const status = metadata.status ?? 'active';
  await ns(metadata.userId).upsert([
    {
      id,
      values: vector,
      metadata: {
        text,
        userId: metadata.userId,
        category: metadata.category,
        timestamp: metadata.timestamp,
        status,
      },
    },
  ]);
  return { id };
}

/**
 * @param {string} queryText
 * @param {string} userId
 * @param {number} topK
 * @returns {Promise<Array<{ text: string, category: string, timestamp: string, score: number, id: string }>>}
 */
export async function retrieveMemories(queryText, userId, topK = 10) {
  const vector = await generateEmbedding(queryText);
  const res = await ns(userId).query({
    vector,
    topK,
    includeMetadata: true,
    filter: { status: { $eq: 'active' } },
  });
  const out = [];
  for (const m of res.matches ?? []) {
    const meta = m.metadata ?? {};
    const text = typeof meta.text === 'string' ? meta.text : '';
    out.push({
      id: m.id,
      text,
      category: String(meta.category ?? ''),
      timestamp: String(meta.timestamp ?? ''),
      score: m.score ?? 0,
    });
  }
  return out;
}

/** Diverse queries so one embedding direction does not hide unrelated stored memories. */
const SESSION_MEMORY_QUERIES = [
  'Greg personal preferences family friends work hobbies pets health daily life',
  'things Greg asked to remember goals plans projects opinions background',
  'Greg identity relationships important facts names places events',
  'Greg romantic partner girlfriend boyfriend spouse dating marriage family members by name',
];

/**
 * Merge top hits from several semantic queries (same namespace) for session bootstrap.
 * @param {string} userId
 * @param {string} [profileHint] optional first query from Firestore profile
 * @param {number} topK cap after merge
 */
export async function retrieveMemoriesForSession(userId, profileHint, topK = 28) {
  const queries = [];
  const hint = profileHint?.trim();
  if (hint) queries.push(hint);
  for (const q of SESSION_MEMORY_QUERIES) {
    if (!queries.includes(q)) queries.push(q);
  }

  const perQuery = Math.max(10, Math.ceil((topK * 2) / queries.length));
  const byId = new Map();

  for (const q of queries) {
    try {
      const hits = await retrieveMemories(q, userId, perQuery);
      for (const hit of hits) {
        const prev = byId.get(hit.id);
        if (!prev || (hit.score ?? 0) > (prev.score ?? 0)) {
          byId.set(hit.id, hit);
        }
      }
    } catch (e) {
      console.error('[pinecone] retrieveMemoriesForSession query failed:', q, e);
    }
  }

  return [...byId.values()]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, topK);
}

/**
 * Mark a memory vector as superseded (no longer used in retrieval).
 * @param {string} userId
 * @param {string} id Pinecone vector id
 */
export async function supersedeMemory(userId, id) {
  await ns(userId).update({
    id,
    setMetadata: { status: 'superseded' },
  });
}

/** @deprecated typo alias */
export const supersedMemory = supersedeMemory;
