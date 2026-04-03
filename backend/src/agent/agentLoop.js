import WebSocket from 'ws';
import { buildSystemPrompt } from './systemPrompt.js';
import { extractAndStoreMemories } from './memoryExtractor.js';
import { getUserProfile, logConversation } from '../db/firestore.js';
import { retrieveMemories } from '../memory/pinecone.js';
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
    memories = await retrieveMemories(queryText, userId, 10);
  } catch (e) {
    console.error('[agentLoop] retrieveMemories failed', e);
  }

  const memorySlices = memories.map((m) => ({
    text: m.text,
    category: m.category,
  }));

  const instructions = buildSystemPrompt(memorySlices);
  const bridge = await createGrokVoiceBridge(clientWs, instructions);

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
    await bridge.shutdown();
    const transcript = bridge.getTranscript();
    let extracted = [];
    try {
      extracted = await extractAndStoreMemories(transcript, userId);
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
