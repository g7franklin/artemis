import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const TARGET_SAMPLE_RATE = 24000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;

/** @param {Float32Array} input @param {number} fromRate @param {number} toRate */
function resampleFloat32(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio;
    const j = Math.floor(srcPos);
    const f = srcPos - j;
    const a = input[j] ?? 0;
    const b = input[j + 1] ?? a;
    out[i] = a + (b - a) * f;
  }
  return out;
}

/** @param {Float32Array} float32 */
function floatTo16BitPCM(float32) {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Int16Array(buf);
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decodeBase64ToInt16(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

function buildWsUrl(baseUrl, token) {
  const u = new URL(
    baseUrl,
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
  );
  u.searchParams.set('token', token);
  return u.toString();
}

const OVER_AND_OUT = /\bover\s+and\s+out\b/i;
/**
 * End voice + disconnect WebSocket; keeps on-screen log. Matches what Greg says
 * ("stay smooth, Arty") and common STT ("stay smooth already").
 */
const STAY_SMOOTH_END_CHAT = /\bstay\s+smooth,?\s+(arty|already)\b/i;

/** Browser STT while mic is live — Grok user transcripts only arrive after buffer commit (end_turn). */
function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/**
 * @param {{ getIdToken: () => Promise<string> }} authUser Firebase user
 */
export function useVoiceSession(authUser) {
  const [connectionState, setConnectionState] = useState('disconnected');
  const [voiceState, setVoiceState] = useState('idle');
  const [micLive, setMicLive] = useState(false);
  const [lastError, setLastError] = useState(null);
  const [logLines, setLogLines] = useState([]);
  const [textSending, setTextSending] = useState(false);
  const [restartingSession, setRestartingSession] = useState(false);

  const wsRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const intentionalCloseRef = useRef(false);
  const skipDisconnectLogRef = useRef(false);

  const captureRef = useRef({
    stream: null,
    ctx: null,
    processor: null,
    mute: null,
    source: null,
  });

  const playbackRef = useRef({
    ctx: null,
    nextTime: 0,
  });

  const pushActiveRef = useRef(false);
  /** Conversation mode: auto-reopen mic after assistant; new chat / sign-out / refresh ends it. */
  const conversationActiveRef = useRef(false);
  /**
   * After auto-reopen, first mic tap dismisses to idle (no commit) unless the user
   * spoke (VAD) or ends with "over and out" (endUserTurn).
   */
  const micTapHangsUpRef = useRef(false);
  const userSpokeSinceReopenRef = useRef(false);
  const voiceStateRef = useRef('idle');
  const pendingSessionReadyRef = useRef(null);
  const sessionReadyReceivedRef = useRef(false);
  const connectInFlightRef = useRef(null);
  const connectWsRef = useRef(null);
  const pendingMemoriesFlushRef = useRef(null);
  const startNewSessionBusyRef = useRef(false);
  const reopenMicTimerRef = useRef(null);
  const phraseRecognitionRef = useRef(null);

  /** Latest handlers for WebSocket onmessage (avoids stale closures). */
  const handlersRef = useRef({
    onUserTranscriptForPhrase: () => {},
    onEndChatPhrase: () => {},
    onAssistantTranscriptDone: () => {},
  });

  const appendLog = useCallback((line) => {
    setLogLines((prev) => [...prev.slice(-200), line]);
  }, []);

  const stopPhraseWatch = useCallback(() => {
    const r = phraseRecognitionRef.current;
    phraseRecognitionRef.current = null;
    if (!r) return;
    try {
      r.onresult = null;
      r.onerror = null;
      r.onend = null;
    } catch {
      /* ignore */
    }
    try {
      r.stop();
    } catch {
      /* ignore */
    }
    try {
      r.abort();
    } catch {
      /* ignore */
    }
  }, []);

  const startPhraseWatch = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    stopPhraseWatch();
    const r = new Ctor();
    phraseRecognitionRef.current = r;
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';

    r.onresult = (event) => {
      if (!pushActiveRef.current || !conversationActiveRef.current) return;
      const vs = voiceStateRef.current;
      if (vs === 'speaking' || vs === 'thinking') return;
      let full = '';
      for (let i = 0; i < event.results.length; i++) {
        full += event.results[i][0].transcript;
      }
      if (STAY_SMOOTH_END_CHAT.test(full)) {
        handlersRef.current.onEndChatPhrase();
      } else if (OVER_AND_OUT.test(full)) {
        handlersRef.current.onUserTranscriptForPhrase();
      }
    };

    r.onerror = () => {};

    r.onend = () => {
      if (phraseRecognitionRef.current !== r) return;
      if (!pushActiveRef.current || !conversationActiveRef.current) return;
      const vs = voiceStateRef.current;
      if (vs === 'speaking' || vs === 'thinking') return;
      try {
        r.start();
      } catch {
        /* already started */
      }
    };

    try {
      r.start();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendLog(`Phrase listen: ${msg}`);
    }
  }, [stopPhraseWatch, appendLog]);

  const stopCapture = useCallback(() => {
    const c = captureRef.current;
    if (c.processor) {
      try {
        c.processor.disconnect();
      } catch {
        /* ignore */
      }
      c.processor = null;
    }
    if (c.mute) {
      try {
        c.mute.disconnect();
      } catch {
        /* ignore */
      }
      c.mute = null;
    }
    if (c.source) {
      try {
        c.source.disconnect();
      } catch {
        /* ignore */
      }
      c.source = null;
    }
    if (c.ctx) {
      void c.ctx.close().catch(() => {});
      c.ctx = null;
    }
    if (c.stream) {
      c.stream.getTracks().forEach((t) => t.stop());
      c.stream = null;
    }
  }, []);

  const ensurePlaybackContext = useCallback(() => {
    let ctx = playbackRef.current.ctx;
    if (!ctx || ctx.state === 'closed') {
      ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      playbackRef.current.ctx = ctx;
      playbackRef.current.nextTime = 0;
    }
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    return ctx;
  }, []);

  const unlockPlaybackForUserGesture = useCallback(async () => {
    const ctx = ensurePlaybackContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  }, [ensurePlaybackContext]);

  const playPcmBase64 = useCallback(
    (base64) => {
      const int16 = decodeBase64ToInt16(base64);
      const ctx = ensurePlaybackContext();
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }
      const buffer = ctx.createBuffer(1, float32.length, TARGET_SAMPLE_RATE);
      buffer.copyToChannel(float32, 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      const now = ctx.currentTime;
      let { nextTime } = playbackRef.current;
      if (nextTime < now) {
        nextTime = now;
      }
      src.start(nextTime);
      playbackRef.current.nextTime = nextTime + buffer.duration;
    },
    [ensurePlaybackContext]
  );

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const disconnectWs = useCallback((opts = {}) => {
    const { silentDisconnectLog = false } = opts;
    if (silentDisconnectLog) {
      skipDisconnectLogRef.current = true;
    }
    intentionalCloseRef.current = true;
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    sessionReadyReceivedRef.current = false;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionState('disconnected');
    setVoiceState('idle');
    voiceStateRef.current = 'idle';
  }, [clearReconnectTimer]);

  const connectWs = useCallback(async () => {
    if (!authUser) {
      throw new Error('Not signed in');
    }

    const base = import.meta.env.VITE_BACKEND_WS_URL;
    if (!base) {
      throw new Error('VITE_BACKEND_WS_URL is not set');
    }

    if (wsRef.current?.readyState === WebSocket.OPEN && sessionReadyReceivedRef.current) {
      return wsRef.current;
    }

    if (connectInFlightRef.current) {
      return connectInFlightRef.current;
    }

    intentionalCloseRef.current = false;
    setLastError(null);
    setConnectionState('connecting');

    const p = (async () => {
      const token = await authUser.getIdToken();
      const url = buildWsUrl(base, token);

      return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        wsRef.current = ws;
        sessionReadyReceivedRef.current = false;

        let settled = false;
        let socketOpened = false;
        let readyTimer = null;

        const finish = (fn) => {
          if (settled) return;
          settled = true;
          fn();
        };

        const timeout = setTimeout(() => {
          ws.close();
        }, 20000);

        ws.onopen = () => {
          clearTimeout(timeout);
          socketOpened = true;
          appendLog('Connected to Artemis');

          readyTimer = setTimeout(() => {
            readyTimer = null;
            pendingSessionReadyRef.current = null;
            finish(() =>
              reject(
                new Error(
                  'Voice session did not become ready. Check backend logs and XAI_API_KEY.'
                )
              )
            );
          }, 35000);

          pendingSessionReadyRef.current = () => {
            if (readyTimer) {
              clearTimeout(readyTimer);
              readyTimer = null;
            }
            pendingSessionReadyRef.current = null;
            finish(() => {
              sessionReadyReceivedRef.current = true;
              reconnectAttemptRef.current = 0;
              setConnectionState('connected');
              resolve(ws);
            });
          };
        };

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'session_ready') {
              pendingSessionReadyRef.current?.();
            }
            if (msg.type === 'memories_flushed') {
              const cb = pendingMemoriesFlushRef.current;
              pendingMemoriesFlushRef.current = null;
              cb?.(msg);
            }
            if (msg.type === 'audio' && msg.payload) {
              try {
                playPcmBase64(msg.payload);
              } catch {
                /* ignore */
              }
            } else if (msg.type === 'status' && msg.state) {
              setVoiceState(msg.state);
              voiceStateRef.current = msg.state;
            } else if (msg.type === 'error') {
              setLastError(msg.message || 'Server error');
              appendLog(`Error: ${msg.message || 'unknown'}`);
            } else if (msg.type === 'pong') {
              /* ignore */
            } else if (msg.type === 'transcript' && typeof msg.text === 'string') {
              const who = msg.role === 'user' ? 'You' : 'Artemis';
              appendLog(`${who}: ${msg.text}`);
              if (msg.role === 'user') {
                /* Phrase is handled live via Web Speech API; fallback if server sends text before commit. */
                if (
                  conversationActiveRef.current &&
                  pushActiveRef.current &&
                  STAY_SMOOTH_END_CHAT.test(msg.text)
                ) {
                  handlersRef.current.onEndChatPhrase();
                } else if (
                  conversationActiveRef.current &&
                  pushActiveRef.current &&
                  OVER_AND_OUT.test(msg.text)
                ) {
                  handlersRef.current.onUserTranscriptForPhrase();
                }
              } else if (msg.role === 'assistant') {
                handlersRef.current.onAssistantTranscriptDone();
              }
            } else if (msg.type === 'vad' && msg.phase === 'start') {
              setVoiceState('listening');
              voiceStateRef.current = 'listening';
              if (micTapHangsUpRef.current) {
                userSpokeSinceReopenRef.current = true;
              }
            }
          } catch {
            /* ignore non-json */
          }
        };

        ws.onerror = () => {
          setLastError('WebSocket error');
        };

        ws.onclose = () => {
          clearTimeout(timeout);
          if (readyTimer) {
            clearTimeout(readyTimer);
            readyTimer = null;
          }
          pendingSessionReadyRef.current = null;
          pendingMemoriesFlushRef.current = null;
          sessionReadyReceivedRef.current = false;

          if (wsRef.current === ws) {
            wsRef.current = null;
          }
          stopPhraseWatch();
          stopCapture();
          pushActiveRef.current = false;
          conversationActiveRef.current = false;
          micTapHangsUpRef.current = false;
          userSpokeSinceReopenRef.current = false;
          setMicLive(false);
          setVoiceState('idle');
          voiceStateRef.current = 'idle';
          if (reopenMicTimerRef.current) {
            clearTimeout(reopenMicTimerRef.current);
            reopenMicTimerRef.current = null;
          }

          if (intentionalCloseRef.current) {
            setConnectionState('disconnected');
            if (!skipDisconnectLogRef.current) {
              appendLog('Disconnected');
            }
            skipDisconnectLogRef.current = false;
            finish(() => reject(new Error('Disconnected')));
            return;
          }

          if (!socketOpened) {
            setConnectionState('disconnected');
            setLastError('Could not connect');
            finish(() => reject(new Error('WebSocket closed before connected')));
            return;
          }

          finish(() =>
            reject(new Error('WebSocket closed before voice session ready'))
          );

          setConnectionState('reconnecting');
          const attempt = reconnectAttemptRef.current + 1;
          reconnectAttemptRef.current = attempt;
          const delay = Math.min(
            BACKOFF_MAX_MS,
            BACKOFF_BASE_MS * 2 ** Math.min(attempt - 1, 8)
          );
          appendLog(`Reconnecting in ${Math.round(delay / 1000)}s…`);
          clearReconnectTimer();
          reconnectTimerRef.current = setTimeout(() => {
            void connectWsRef.current?.().catch(() => {});
          }, delay);
        };
      });
    })();

    connectInFlightRef.current = p;
    try {
      return await p;
    } finally {
      if (connectInFlightRef.current === p) {
        connectInFlightRef.current = null;
      }
    }
  }, [
    authUser,
    appendLog,
    playPcmBase64,
    stopCapture,
    clearReconnectTimer,
    stopPhraseWatch,
  ]);

  connectWsRef.current = connectWs;

  useEffect(() => {
    const uid = authUser?.uid;
    if (!uid) return;
    void connectWsRef.current?.().catch(() => {});
  }, [authUser?.uid]);

  const startMicStreaming = useCallback(
    async (existingStream = null) => {
      stopCapture();
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        await connectWs();
      }
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('Not connected');
      }

      try {
        const stream =
          existingStream ??
          (await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              channelCount: 1,
            },
          }));

        const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        const source = ctx.createMediaStreamSource(stream);
        const bufferSize = 4096;
        const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
        const mute = ctx.createGain();
        mute.gain.value = 0;

        processor.onaudioprocess = (e) => {
          if (!pushActiveRef.current) return;
          const input = e.inputBuffer.getChannelData(0);
          const rate = ctx.sampleRate;
          const resampled = resampleFloat32(input, rate, TARGET_SAMPLE_RATE);
          const pcm16 = floatTo16BitPCM(resampled);
          const b64 = arrayBufferToBase64(pcm16.buffer);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'audio', payload: b64 }));
          }
        };

        source.connect(processor);
        processor.connect(mute);
        mute.connect(ctx.destination);

        captureRef.current = { stream, ctx, processor, mute, source };
      } catch (e) {
        stopCapture();
        throw e;
      }
    },
    [connectWs, stopCapture]
  );

  const endUserTurn = useCallback(() => {
    if (!pushActiveRef.current) return;
    stopPhraseWatch();
    micTapHangsUpRef.current = false;
    userSpokeSinceReopenRef.current = false;
    const ws = wsRef.current;
    pushActiveRef.current = false;
    setMicLive(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'end_turn' }));
        }
        if (!conversationActiveRef.current) {
          stopCapture();
        }
        setVoiceState('thinking');
        voiceStateRef.current = 'thinking';
      });
    });
  }, [stopCapture, stopPhraseWatch]);

  const scheduleReopenMicAfterAssistant = useCallback(() => {
    if (!conversationActiveRef.current) return;
    if (pushActiveRef.current) return;
    if (reopenMicTimerRef.current) {
      clearTimeout(reopenMicTimerRef.current);
    }
    reopenMicTimerRef.current = setTimeout(() => {
      reopenMicTimerRef.current = null;
      if (!conversationActiveRef.current) return;
      if (pushActiveRef.current) return;
      /* Allow TTS to finish; skip only if a new user turn is being processed. */
      if (voiceStateRef.current === 'thinking') return;

      const resume = async () => {
        try {
          if (!captureRef.current.stream || !captureRef.current.processor) {
            await startMicStreaming();
          }
          if (!conversationActiveRef.current) return;
          pushActiveRef.current = true;
          setMicLive(true);
          setVoiceState('listening');
          voiceStateRef.current = 'listening';
          micTapHangsUpRef.current = true;
          userSpokeSinceReopenRef.current = false;
          startPhraseWatch();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setLastError(msg);
          appendLog(`Mic resume: ${msg}`);
        }
      };
      void resume();
    }, 1200);
  }, [startMicStreaming, appendLog, startPhraseWatch]);

  useLayoutEffect(() => {
    handlersRef.current.onUserTranscriptForPhrase = () => {
      endUserTurn();
    };
    handlersRef.current.onAssistantTranscriptDone = () => {
      scheduleReopenMicAfterAssistant();
    };
  }, [endUserTurn, scheduleReopenMicAfterAssistant]);

  const resetVoiceToIdle = useCallback(
    (logLine) => {
      if (reopenMicTimerRef.current) {
        clearTimeout(reopenMicTimerRef.current);
        reopenMicTimerRef.current = null;
      }
      micTapHangsUpRef.current = false;
      userSpokeSinceReopenRef.current = false;
      stopPhraseWatch();
      conversationActiveRef.current = false;
      pushActiveRef.current = false;
      setMicLive(false);
      stopCapture();
      setVoiceState('idle');
      voiceStateRef.current = 'idle';
      if (logLine) appendLog(logLine);
    },
    [stopCapture, appendLog, stopPhraseWatch]
  );

  const stopVoiceConversation = useCallback(() => {
    resetVoiceToIdle('Voice conversation stopped');
  }, [resetVoiceToIdle]);

  const toggleMic = useCallback(async () => {
    setLastError(null);

    if (voiceStateRef.current === 'speaking' || voiceStateRef.current === 'thinking') {
      return;
    }

    if (!conversationActiveRef.current) {
      micTapHangsUpRef.current = false;
      userSpokeSinceReopenRef.current = false;
      conversationActiveRef.current = true;
      let earlyStream = null;
      try {
        await unlockPlaybackForUserGesture();
        const micPromise = navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1,
          },
        });
        await connectWs();
        earlyStream = await micPromise;
        pushActiveRef.current = false;
        await startMicStreaming(earlyStream);
        earlyStream = null;
        pushActiveRef.current = true;
        setMicLive(true);
        setVoiceState('listening');
        voiceStateRef.current = 'listening';
        appendLog('Listening…');
        startPhraseWatch();
      } catch (e) {
        earlyStream?.getTracks().forEach((t) => t.stop());
        conversationActiveRef.current = false;
        pushActiveRef.current = false;
        setMicLive(false);
        const msg = e instanceof Error ? e.message : String(e);
        setLastError(msg);
        appendLog(`Mic / connect: ${msg}`);
      }
      return;
    }

    if (pushActiveRef.current) {
      if (micTapHangsUpRef.current && !userSpokeSinceReopenRef.current) {
        resetVoiceToIdle('Tap mic when you want to talk again');
        return;
      }
      endUserTurn();
      return;
    }

    try {
      micTapHangsUpRef.current = false;
      userSpokeSinceReopenRef.current = false;
      if (!captureRef.current.stream || !captureRef.current.processor) {
        await startMicStreaming();
      }
      pushActiveRef.current = true;
      setMicLive(true);
      setVoiceState('listening');
      voiceStateRef.current = 'listening';
      startPhraseWatch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastError(msg);
      appendLog(`Mic: ${msg}`);
    }
  }, [
    unlockPlaybackForUserGesture,
    connectWs,
    startMicStreaming,
    endUserTurn,
    appendLog,
    startPhraseWatch,
    resetVoiceToIdle,
  ]);

  const sendTextMessage = useCallback(
    async (text) => {
      const t = text.trim();
      if (!t) return;
      setLastError(null);
      setTextSending(true);
      try {
        await connectWs();
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          throw new Error('Not connected');
        }
        if (!sessionReadyReceivedRef.current) {
          throw new Error('Session not ready');
        }
        ws.send(JSON.stringify({ type: 'user_text', text: t }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setLastError(msg);
        appendLog(`Send text: ${msg}`);
      } finally {
        setTextSending(false);
      }
    },
    [connectWs, appendLog]
  );

  const endSession = useCallback(async () => {
    if (reopenMicTimerRef.current) {
      clearTimeout(reopenMicTimerRef.current);
      reopenMicTimerRef.current = null;
    }
    stopPhraseWatch();
    micTapHangsUpRef.current = false;
    userSpokeSinceReopenRef.current = false;
    conversationActiveRef.current = false;
    pushActiveRef.current = false;
    setMicLive(false);
    const ws = wsRef.current;
    if (
      ws?.readyState === WebSocket.OPEN &&
      sessionReadyReceivedRef.current
    ) {
      await new Promise((resolve) => {
        const finish = () => resolve();
        const timeout = setTimeout(() => {
          pendingMemoriesFlushRef.current = null;
          finish();
        }, 10000);
        pendingMemoriesFlushRef.current = (ack) => {
          clearTimeout(timeout);
          if (ack?.ok) {
            const n = Number(ack.stored) || 0;
            appendLog(
              n > 0
                ? `Saved ${n} memory update(s).`
                : 'Session saved (no new memories extracted).'
            );
          } else if (ack && !ack.ok) {
            appendLog(`Memory save: ${ack.error || 'failed'}`);
          }
          finish();
        };
        try {
          ws.send(JSON.stringify({ type: 'flush_memories' }));
        } catch {
          clearTimeout(timeout);
          pendingMemoriesFlushRef.current = null;
          finish();
        }
      });
    }
    disconnectWs();
    stopCapture();
    const p = playbackRef.current.ctx;
    if (p && p.state !== 'closed') {
      void p.close().catch(() => {});
    }
    playbackRef.current.ctx = null;
    playbackRef.current.nextTime = 0;
  }, [disconnectWs, stopCapture, appendLog, stopPhraseWatch]);

  /** Like hanging up: flush memories if possible, close WS, stop mic — keep chat log. */
  const endVoiceChatKeepLog = useCallback(async () => {
    if (reopenMicTimerRef.current) {
      clearTimeout(reopenMicTimerRef.current);
      reopenMicTimerRef.current = null;
    }
    stopPhraseWatch();
    micTapHangsUpRef.current = false;
    userSpokeSinceReopenRef.current = false;
    conversationActiveRef.current = false;
    pushActiveRef.current = false;
    setMicLive(false);

    const ws = wsRef.current;
    if (
      ws?.readyState === WebSocket.OPEN &&
      sessionReadyReceivedRef.current
    ) {
      await new Promise((resolve) => {
        const finish = () => resolve();
        const timeout = setTimeout(() => {
          pendingMemoriesFlushRef.current = null;
          finish();
        }, 10000);
        pendingMemoriesFlushRef.current = (ack) => {
          clearTimeout(timeout);
          if (ack?.ok) {
            const n = Number(ack.stored) || 0;
            appendLog(
              n > 0
                ? `Saved ${n} memory update(s).`
                : 'Session saved (no new memories extracted).'
            );
          } else if (ack && !ack.ok) {
            appendLog(`Memory save: ${ack.error || 'failed'}`);
          }
          finish();
        };
        try {
          ws.send(JSON.stringify({ type: 'flush_memories' }));
        } catch {
          clearTimeout(timeout);
          pendingMemoriesFlushRef.current = null;
          finish();
        }
      });
    }
    disconnectWs({ silentDisconnectLog: true });
    stopCapture();
    const p = playbackRef.current.ctx;
    if (p && p.state !== 'closed') {
      void p.close().catch(() => {});
    }
    playbackRef.current.ctx = null;
    playbackRef.current.nextTime = 0;
    appendLog(
      'Voice chat ended — mic off. Tap the mic or send text to reconnect.'
    );
  }, [disconnectWs, stopCapture, appendLog, stopPhraseWatch]);

  const startNewSession = useCallback(async () => {
    if (!authUser || startNewSessionBusyRef.current) return;
    startNewSessionBusyRef.current = true;
    setRestartingSession(true);
    setLastError(null);
    if (reopenMicTimerRef.current) {
      clearTimeout(reopenMicTimerRef.current);
      reopenMicTimerRef.current = null;
    }
    stopPhraseWatch();
    micTapHangsUpRef.current = false;
    userSpokeSinceReopenRef.current = false;
    conversationActiveRef.current = false;
    pushActiveRef.current = false;
    setMicLive(false);
    try {
      const ws = wsRef.current;
      if (
        ws?.readyState === WebSocket.OPEN &&
        sessionReadyReceivedRef.current
      ) {
        await new Promise((resolve) => {
          const finish = () => resolve();
          const timeout = setTimeout(() => {
            pendingMemoriesFlushRef.current = null;
            finish();
          }, 10000);
          pendingMemoriesFlushRef.current = () => {
            clearTimeout(timeout);
            finish();
          };
          try {
            ws.send(JSON.stringify({ type: 'flush_memories' }));
          } catch {
            clearTimeout(timeout);
            pendingMemoriesFlushRef.current = null;
            finish();
          }
        });
      }
      stopCapture();
      setVoiceState('idle');
      voiceStateRef.current = 'idle';
      disconnectWs({ silentDisconnectLog: true });
      setLogLines([]);
      await connectWs();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'Disconnected') {
        setLastError(msg);
        appendLog(`New session: ${msg}`);
      }
    } finally {
      startNewSessionBusyRef.current = false;
      setRestartingSession(false);
    }
  }, [authUser, appendLog, connectWs, disconnectWs, stopCapture, stopPhraseWatch]);

  useLayoutEffect(() => {
    handlersRef.current.onEndChatPhrase = () => {
      void endVoiceChatKeepLog();
    };
  }, [endVoiceChatKeepLog]);

  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      clearReconnectTimer();
      if (reopenMicTimerRef.current) {
        clearTimeout(reopenMicTimerRef.current);
      }
      stopPhraseWatch();
      stopCapture();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [clearReconnectTimer, stopCapture, stopPhraseWatch]);

  return {
    connectionState,
    voiceState,
    micLive,
    lastError,
    logLines,
    toggleMic,
    stopVoiceConversation,
    endSession,
    startNewSession,
    /** Hang up: flush if possible, close WS, stop mic; keep on-screen log (same as “stay smooth” phrase). */
    stopChat: endVoiceChatKeepLog,
    restartingSession,
    connectWs,
    sendTextMessage,
    textSending,
  };
}
