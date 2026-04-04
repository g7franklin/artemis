import OpenAI from 'openai';

let client = null;

/** Pinecone index dimension must match (text-embedding-3-small supports reduced dims, e.g. 512). */
function embeddingDimensions() {
  const raw = process.env.OPENAI_EMBEDDING_DIMENSIONS?.trim();
  if (!raw) return 1536;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error('OPENAI_EMBEDDING_DIMENSIONS must be a positive number');
  }
  return n;
}

function getClient() {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OPENAI_API_KEY');
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

/**
 * @param {string} text
 * @returns {Promise<number[]>} vector for text-embedding-3-small (length = OPENAI_EMBEDDING_DIMENSIONS or 1536)
 */
export async function generateEmbedding(text) {
  const input = text.trim() || ' ';
  const dimensions = embeddingDimensions();
  const res = await getClient().embeddings.create({
    model: 'text-embedding-3-small',
    input,
    ...(dimensions !== 1536 ? { dimensions } : {}),
  });
  const vec = res.data[0]?.embedding;
  if (!vec || vec.length !== dimensions) {
    throw new Error(
      `Unexpected embedding dimensions from OpenAI (got ${vec?.length}, expected ${dimensions})`
    );
  }
  return vec;
}
