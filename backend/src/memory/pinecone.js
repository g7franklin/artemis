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
