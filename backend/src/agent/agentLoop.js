import WebSocket from 'ws';
import { buildSystemPrompt } from './systemPrompt.js';
import { extractAndStoreMemories } from './memoryExtractor.js';
import { getUserProfile, logConversation } from '../db/firestore.js';
import { retrieveMemoriesForSession } from '../memory/pinecone.js';
import { createGrokVoiceBridge } from '../voice/grokSession.js';

/**
 * Pinecone query text for session bootstrap (refined further when you add live context).
 * @param {Record<string, unknown> | null} profile
 */
function memoryQueryForSession(profile) {
  const hint =
    profile && typeof profile.memoryQueryHint === 'string'
      ? profile.memoryQueryHint.trim()
      : '';
  if (hint.length > 0) return hint;
  return 'Greg preferences goals projects relationships work life updates';
}

/**
 * Start the voice agent for an authenticated WebSocket client.
 * @param {import('ws').WebSocket} clientWs
 * @param {string} userId Firebase uid
 */
export async function startAgentSession(clientWs, userId) {
  let profile = null;
  try {
    profile = await getUserProfile(userId);
  } catch (e) {
    console.error('[agentLoop] getUserProfile failed', e);
  }

  const queryText = memoryQueryForSession(profile);
  let memories = [];
  try {
    memories = await retrieveMemoriesForSession(userId, queryText, 28);
  } catch (e) {
    console.error('[agentLoop] retrieveMemoriesForSession failed', e);
  }

  const memorySlices = memories.map((m) => ({
    text: m.text,
    category: m.category,
  }));

  const instructions = buildSystemPrompt(memorySlices);
  const bridge = await createGrokVoiceBridge(clientWs, instructions, {
    userId,
    async onFlushMemories(transcript) {
      const t = transcript?.trim() ?? '';
      console.log(`[agentLoop] flush_memories transcriptLen=${t.length}`);
      if (t.length < 10) {
        console.warn('[agentLoop] flush_memories: transcript very short, skipping extraction');
        return { stored: 0 };
      }
      const extracted = await extractAndStoreMemories(transcript, userId);
      const stored = extracted.filter((e) => e.storedId).length;
      if (stored > 0) {
        console.log(
          `[agentLoop] flush_memories stored ${stored} new vector(s) for ${userId}`
        );
      } else {
        console.log(
          `[agentLoop] flush_memories: 0 new vectors (extracted ${extracted.length} row(s), may be skips/duplicates)`
        );
      }
      return { stored };
    },
  });

  const pingMs = Number(process.env.WS_PING_INTERVAL_MS ?? 30000);
  /** @type {ReturnType<typeof setInterval> | null} */
  let pingInterval = null;
  if (pingMs > 0) {
    pingInterval = setInterval(() => {
      if (clientWs.readyState === WebSocket.OPEN) {
        try {
          clientWs.ping();
        } catch (e) {
          console.warn('[agentLoop] WebSocket ping failed', e);
        }
      }
    }, pingMs);
  }

  let cleaned = false;

  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    clientWs.removeListener('close', onClientClose);
    clientWs.removeListener('error', onClientClose);
    const transcriptBefore = bridge.getTranscript();
    await bridge.shutdown();
    const transcriptAfter = bridge.getTranscript();
    const transcript =
      transcriptAfter.length >= transcriptBefore.length
        ? transcriptAfter
        : transcriptBefore;
    console.log(
      `[agentLoop] cleanup transcriptLen=${transcript.length} (beforeShutdown=${transcriptBefore.length})`
    );
    let extracted = [];
    try {
      extracted = await extractAndStoreMemories(transcript, userId);
      const stored = extracted.filter((e) => e.storedId).length;
      if (stored > 0) {
        console.log(
          `[agentLoop] cleanup stored ${stored} new vector(s) for ${userId}`
        );
      } else if (transcript.trim().length >= 10) {
        console.log(
          `[agentLoop] cleanup: 0 new vectors from extraction (${extracted.length} row(s))`
        );
      }
    } catch (e) {
      console.error('[agentLoop] memory extraction failed', e);
    }
    try {
      await logConversation(userId, transcript, extracted);
    } catch (e) {
      console.error('[agentLoop] logConversation failed', e);
    }
  }

  function onClientClose() {
    void cleanup();
  }

  clientWs.once('close', onClientClose);
  clientWs.once('error', onClientClose);
}
