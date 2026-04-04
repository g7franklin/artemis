/**
 * Inspect Pinecone data for one Firebase user (namespace = uid).
 *
 *   cd backend && node scripts/inspect-pinecone-user.mjs <firebase_uid>
 *   # or: ARTEMIS_DEBUG_USER_ID=<uid> node scripts/inspect-pinecone-user.mjs
 *
 * Needs PINECONE_* and OPENAI_* in .env (same as the app).
 */
import 'dotenv/config';
import { Pinecone } from '@pinecone-database/pinecone';
import {
  retrieveMemories,
  retrieveMemoriesForSession,
} from '../src/memory/pinecone.js';

const userId =
  process.argv[2]?.trim() || process.env.ARTEMIS_DEBUG_USER_ID?.trim();

if (!userId) {
  console.error(`
Usage:
  node scripts/inspect-pinecone-user.mjs <firebase_uid>

Your Firebase uid is shown in the Firebase console (Authentication → user),
or add temporarily in the app: console.log(user.uid) after sign-in.

Or set ARTEMIS_DEBUG_USER_ID in the environment.
`);
  process.exit(1);
}

const indexName = process.env.PINECONE_INDEX_NAME || 'artemis-memory';

async function main() {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) {
    throw new Error('Missing PINECONE_API_KEY');
  }

  const pc = new Pinecone({ apiKey });
  const index = pc.index(indexName);
  const ns = index.namespace(userId);

  console.log('\n=== describeIndexStats (all namespaces) ===\n');
  const stats = await index.describeIndexStats();
  const namespaces = stats.namespaces ?? {};
  const mine = namespaces[userId];
  console.log(`Your namespace "${userId}":`, mine ?? '(missing — 0 vectors in this namespace)');
  const nsKeys = Object.keys(namespaces).filter(
    (k) => k && k !== '__vector_smoke_test__'
  );
  console.log(
    'Other namespaces (sample):',
    nsKeys.slice(0, 15),
    nsKeys.length > 15 ? '…' : ''
  );

  console.log('\n=== list vector IDs (serverless; may require no prefix) ===\n');
  const ids = [];
  try {
    let paginationToken;
    do {
      const page = await ns.listPaginated({
        limit: 100,
        ...(paginationToken ? { paginationToken } : {}),
      });
      for (const row of page.vectors ?? []) {
        if (row?.id) ids.push(row.id);
      }
      paginationToken = page.pagination?.next;
    } while (paginationToken);
  } catch (e) {
    console.warn('listPaginated failed (some indexes need a prefix):', e?.message || e);
  }

  console.log(`Found ${ids.length} id(s) via listPaginated.`);

  if (ids.length > 0) {
    const slice = ids.slice(0, 40);
    const fetched = await ns.fetch(slice);
    const records = fetched.records ?? {};
    console.log('\n=== metadata (up to 40) ===\n');
    for (const id of slice) {
      const r = records[id];
      const meta = r?.metadata ?? {};
      console.log('---', id);
      console.log('    text:', meta.text ?? '(no text)');
      console.log('    category:', meta.category, '| status:', meta.status);
      console.log('    timestamp:', meta.timestamp);
    }
  }

  console.log('\n=== semantic search probes (what the app might retrieve) ===\n');
  const probes = [
    'guitar music instrument hobbies what Greg plays',
    'Greg preferences personality facts',
  ];
  for (const q of probes) {
    const hits = await retrieveMemories(q, userId, 8);
    console.log(`Query: "${q.slice(0, 60)}…" → ${hits.length} hit(s)`);
    for (const h of hits.slice(0, 5)) {
      console.log(
        `  ${(h.score ?? 0).toFixed(4)}  ${(h.text || '').slice(0, 140)}`
      );
    }
  }

  console.log('\n=== retrieveMemoriesForSession (session bootstrap merge) ===\n');
  const merged = await retrieveMemoriesForSession(
    userId,
    'Greg preferences goals projects relationships work life updates',
    16
  );
  console.log(`Merged top ${merged.length}:`);
  for (const h of merged) {
    console.log(
      `  ${(h.score ?? 0).toFixed(4)}  ${(h.text || '').slice(0, 140)}`
    );
  }

  if (ids.length === 0 && !mine?.recordCount) {
    console.log(`
NOTE: No vectors found for this uid. Common causes:
  • Session WebSocket closed before cleanup ran (use "End voice session" or close tab).
  • Transcript too short / empty → memory extractor skipped.
  • Extraction LLM returned [] or failed (check server logs for [memoryExtractor] / [agentLoop]).
  • Wrong Firebase uid (must match the account you use to sign in).
`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
