import OpenAI from 'openai';

let client = null;

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
 * @returns {Promise<number[]>} 1536-dim vector for text-embedding-3-small
 */
export async function generateEmbedding(text) {
  const input = text.trim() || ' ';
  const res = await getClient().embeddings.create({
    model: 'text-embedding-3-small',
    input,
  });
  const vec = res.data[0]?.embedding;
  if (!vec || vec.length !== 1536) {
    throw new Error('Unexpected embedding dimensions from OpenAI');
  }
  return vec;
}
