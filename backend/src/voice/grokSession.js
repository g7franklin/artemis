import WebSocket from 'ws';
import { executeTool, getGrokToolDefinitions } from '../tools/toolRegistry.js';

const GROK_REALTIME_URL = 'wss://api.x.ai/v1/realtime';

/**
 * @param {import('ws').WebSocket} clientWs
 * @param {string} instructions System / voice instructions (Artemis prompt)
 * @param {{ onFlushMemories?: (transcript: string) => Promise<unknown> }} [options]
 * @returns {Promise<{ shutdown: () => Promise<void>, getTranscript: () => string }>}
 */
export async function createGrokVoiceBridge(clientWs, instructions, options = {}) {
  const { onFlushMemories } = options;
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing XAI_API_KEY');
  }

  const transcriptParts = [];
  /** Dedupe user lines when both item.added and transcription.completed fire. */
  function appendUserTranscriptLine(text) {
    const t = text.trim();
    if (!t) return;
    const line = `User: ${t}`;
    if (transcriptParts.includes(line)) return;
    transcriptParts.push(line);
    sendClient({ type: 'transcript', role: 'user', text: t });
  }
  let assistantBuf = '';
  /** Assistant plain-text stream when session uses text modality (e.g. typed user messages). */
  let assistantTextBuf = '';
  let toolBatch = [];
  /** @type {ReturnType<typeof setTimeout> | null} */
  let toolFlushTimer = null;
  let flushingTools = false;

  const grokWs = new WebSocket(GROK_REALTIME_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  function sendClient(obj) {
    if (clientWs.readyState !== WebSocket.OPEN) return;
    try {
      clientWs.send(JSON.stringify(obj));
    } catch {
      /* ignore */
    }
  }

  function getTranscript() {
    const parts = [...transcriptParts];
    const tailText = assistantTextBuf.trim();
    const tailAudio = assistantBuf.trim();
    if (tailText) {
      parts.push(`Assistant: ${tailText}`);
    }
    if (tailAudio) {
      parts.push(`Assistant: ${tailAudio}`);
    }
    return parts.join('\n');
  }

  async function flushToolBatch() {
    if (flushingTools || toolBatch.length === 0) return;
    flushingTools = true;
    const batch = toolBatch.splice(0);
    try {
      await Promise.all(
        batch.map(async (ev) => {
          let args = {};
          try {
            args = JSON.parse(ev.arguments ?? '{}');
          } catch {
            args = {};
          }
          let result;
          try {
            result = await executeTool(ev.name, args);
          } catch (err) {
            result = {
              error: err instanceof Error ? err.message : String(err),
            };
          }
          if (grokWs.readyState === WebSocket.OPEN) {
            grokWs.send(
              JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: ev.call_id,
                  output: JSON.stringify(result),
                },
              })
            );
          }
        })
      );
      if (grokWs.readyState === WebSocket.OPEN) {
        grokWs.send(JSON.stringify({ type: 'response.create' }));
      }
    } finally {
      flushingTools = false;
      if (toolBatch.length > 0) {
        scheduleToolFlush();
      }
    }
  }

  function scheduleToolFlush() {
    if (toolFlushTimer) clearTimeout(toolFlushTimer);
    toolFlushTimer = setTimeout(() => {
      toolFlushTimer = null;
      void flushToolBatch();
    }, 60);
  }

  /** Resolves once Grok acknowledges session.update (must receive messages before sending update). */
  let sessionConfiguredResolve = /** @type {(() => void) | null} */ (null);
  const sessionConfiguredPromise = new Promise((resolve) => {
    sessionConfiguredResolve = resolve;
  });

  function handleGrokMessage(data) {
    let event;
    try {
      event = JSON.parse(data.toString());
    } catch {
      return;
    }

    const { type } = event;

    if (type === 'session.updated' && sessionConfiguredResolve) {
      sessionConfiguredResolve();
      sessionConfiguredResolve = null;
    }

    switch (type) {
      case 'response.function_call_arguments.done':
        toolBatch.push(event);
        scheduleToolFlush();
        sendClient({ type: 'status', state: 'thinking' });
        break;

      case 'input_audio_buffer.speech_started':
        sendClient({ type: 'vad', phase: 'start' });
        sendClient({ type: 'status', state: 'listening' });
        break;

      case 'input_audio_buffer.speech_stopped':
        sendClient({ type: 'vad', phase: 'stop' });
        break;

      case 'input_audio_buffer.committed':
        if (grokWs.readyState === WebSocket.OPEN) {
          grokWs.send(JSON.stringify({ type: 'response.create' }));
        }
        break;

      case 'response.output_audio.delta':
        sendClient({
          type: 'audio',
          role: 'assistant',
          payload: event.delta,
        });
        sendClient({ type: 'status', state: 'speaking' });
        break;

      case 'response.output_audio_transcript.delta':
        assistantBuf += event.delta ?? '';
        break;

      case 'response.text.delta':
        assistantTextBuf += event.delta ?? '';
        break;

      case 'response.output_audio_transcript.done': {
        const line = assistantBuf.trim();
        assistantBuf = '';
        if (line) {
          transcriptParts.push(`Assistant: ${line}`);
          sendClient({ type: 'transcript', role: 'assistant', text: line });
        }
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        const t = event.transcript?.trim();
        if (t) {
          appendUserTranscriptLine(t);
        }
        sendClient({ type: 'status', state: 'listening' });
        break;
      }

      case 'conversation.item.added': {
        const item = event.item;
        if (item?.role === 'user' && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (
              part?.type === 'input_audio' &&
              typeof part.transcript === 'string' &&
              part.transcript.trim()
            ) {
              appendUserTranscriptLine(part.transcript);
            }
          }
        }
        break;
      }

      case 'response.done': {
        const textOut = assistantTextBuf.trim();
        assistantTextBuf = '';
        if (textOut) {
          const line = `Assistant: ${textOut}`;
          if (!transcriptParts.includes(line)) {
            transcriptParts.push(line);
            sendClient({ type: 'transcript', role: 'assistant', text: textOut });
          }
        }
        sendClient({ type: 'status', state: 'listening' });
        break;
      }

      case 'error':
        sendClient({
          type: 'error',
          message: event.error?.message ?? event.message ?? 'Grok error',
          code: event.error?.code,
        });
        break;

      default:
        break;
    }
  }

  /** @param {import('ws').RawData} raw */
  function handleClientMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'flush_memories') {
      void (async () => {
        try {
          if (typeof onFlushMemories !== 'function') {
            sendClient({
              type: 'memories_flushed',
              ok: false,
              error: 'no_handler',
            });
            return;
          }
          const transcript = getTranscript();
          const r = await onFlushMemories(transcript);
          const stored =
            r && typeof r === 'object' && 'stored' in r ? Number(r.stored) : 0;
          sendClient({
            type: 'memories_flushed',
            ok: true,
            stored: Number.isFinite(stored) ? stored : 0,
            transcriptLen: transcript.length,
          });
        } catch (e) {
          sendClient({
            type: 'memories_flushed',
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      return;
    }

    if (grokWs.readyState !== WebSocket.OPEN) return;

    if (msg.type === 'audio' && typeof msg.payload === 'string') {
      grokWs.send(
        JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: msg.payload,
        })
      );
      sendClient({ type: 'status', state: 'listening' });
    } else if (msg.type === 'end_turn') {
      grokWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      sendClient({ type: 'status', state: 'thinking' });
    } else if (msg.type === 'user_text' && typeof msg.text === 'string') {
      const text = msg.text.trim().slice(0, 16000);
      if (!text) return;
      appendUserTranscriptLine(text);
      grokWs.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
      grokWs.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text }],
          },
        })
      );
      grokWs.send(JSON.stringify({ type: 'response.create' }));
      sendClient({ type: 'status', state: 'thinking' });
    } else if (msg.type === 'ping') {
      sendClient({ type: 'pong' });
    }
  }

  await new Promise((resolve, reject) => {
    grokWs.once('open', resolve);
    grokWs.once('error', reject);
  });

  grokWs.on('message', handleGrokMessage);
  grokWs.on('close', () => {
    sendClient({ type: 'status', state: 'idle' });
  });

  const transcriptionModel =
    process.env.XAI_VOICE_TRANSCRIPTION_MODEL?.trim() || 'whisper-1';
  const sessionPayload = {
    voice: 'Eve',
    instructions,
    /** Push-to-talk: client commits buffer + response.create on release (see handleClientMessage). */
    turn_detection: null,
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
      },
      output: {
        format: { type: 'audio/pcm', rate: 24000 },
      },
    },
    tools: getGrokToolDefinitions(),
  };
  if (process.env.XAI_VOICE_MODALITIES?.trim() !== 'off') {
    sessionPayload.modalities = ['audio', 'text'];
  }
  if (transcriptionModel !== 'off' && transcriptionModel !== 'false') {
    sessionPayload.input_audio_transcription = { model: transcriptionModel };
  }

  grokWs.send(
    JSON.stringify({
      type: 'session.update',
      session: sessionPayload,
    })
  );

  await Promise.race([
    sessionConfiguredPromise,
    new Promise((_, rej) =>
      setTimeout(
        () => rej(new Error('Grok session.update was not acknowledged in time')),
        20000
      )
    ),
  ]);

  clientWs.on('message', handleClientMessage);

  sendClient({ type: 'session_ready' });
  sendClient({ type: 'status', state: 'listening' });

  async function shutdown() {
    clientWs.off('message', handleClientMessage);
    grokWs.off('message', handleGrokMessage);
    if (toolFlushTimer) {
      clearTimeout(toolFlushTimer);
      toolFlushTimer = null;
    }
    await flushToolBatch();
    if (
      grokWs.readyState === WebSocket.OPEN ||
      grokWs.readyState === WebSocket.CONNECTING
    ) {
      grokWs.close();
    }
  }

  return { shutdown, getTranscript };
}
