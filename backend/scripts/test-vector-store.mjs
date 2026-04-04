/**
 * Smoke test: OpenAI embeddings + Pinecone upsert/query/delete.
 * Run from backend/:  npm run test:vector
 *
 * Requires: OPENAI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX_NAME (optional)
 */
import 'dotenv/config';
import { Pinecone } from '@pinecone-database/pinecone';
import { storeMemory, retrieveMemories } from '../src/memory/pinecone.js';

const TEST_NS = '__vector_smoke_test__';

async function main() {
  const marker = `smoke-${Date.now()}`;
  const text = `Artemis vector test ${marker}. User likes testing Pinecone and oat milk.`;

  console.log('1) Storing memory in namespace:', TEST_NS);
  const { id } = await storeMemory(text, {
    userId: TEST_NS,
    category: 'smoke',
    timestamp: new Date().toISOString(),
  });
  console.log('   upsert ok, id:', id);

  console.log('2) Querying with related text…');
  const hits = await retrieveMemories('oat milk pinecone test', TEST_NS, 5);
  const found = hits.some((h) => h.id === id || h.text.includes(marker));
  if (!found) {
    console.error('FAIL: stored vector not in top results:', hits);
    process.exit(1);
  }
  console.log('   top match score:', hits[0]?.score?.toFixed(4), '| text snippet:', hits[0]?.text?.slice(0, 80) + '…');

  console.log('3) Cleaning up test vector…');
  const apiKey = process.env.PINECONE_API_KEY;
  const indexName = process.env.PINECONE_INDEX_NAME || 'artemis-memory';
  const pc = new Pinecone({ apiKey });
  await pc.index(indexName).namespace(TEST_NS).deleteMany([id]);
  console.log('   deleted');

  console.log('\nVector store OK (embeddings + Pinecone read/write).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
