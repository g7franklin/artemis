import { useCallback, useEffect, useRef, useState } from 'react';

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

/**
 * @param {{ getIdToken: () => Promise<string> }} authUser Firebase user
 */
export function useVoiceSession(authUser) {
  const [connectionState, setConnectionState] = useState('disconnected');
  const [voiceState, setVoiceState] = useState('idle');
  const [lastError, setLastError] = useState(null);
  const [logLines, setLogLines] = useState([]);
  const [textSending, setTextSending] = useState(false);

  const wsRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const intentionalCloseRef = useRef(false);

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
  /** True from pointer-down until pointer-up; used to abort in-flight connect if user releases early. */
  const isPushIntendedRef = useRef(false);
  /** Fires once backend sends session_ready (Grok configured). */
  const pendingSessionReadyRef = useRef(null);
  /** True after `session_ready` for the current socket; cleared on close. */
  const sessionReadyReceivedRef = useRef(false);
  /** Deduplicates concurrent connectWs while handshake is in flight. */
  const connectInFlightRef = useRef(null);
  /** @type {React.MutableRefObject<(() => Promise<unknown>) | null>} */
  const connectWsRef = useRef(null);

  const appendLog = useCallback((line) => {
    setLogLines((prev) => [...prev.slice(-200), line]);
  }, []);

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

  /** Await inside the user gesture that starts push-to-talk (Safari / iOS). */
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

  const disconnectWs = useCallback(() => {
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
            if (msg.type === 'audio' && msg.payload) {
              playPcmBase64(msg.payload);
            } else if (msg.type === 'status' && msg.state) {
              setVoiceState(msg.state);
            } else if (msg.type === 'error') {
              setLastError(msg.message || 'Server error');
              appendLog(`Error: ${msg.message || 'unknown'}`);
            } else if (msg.type === 'pong') {
              /* ignore */
            } else if (msg.type === 'transcript' && typeof msg.text === 'string') {
              const who = msg.role === 'user' ? 'You' : 'Artemis';
              appendLog(`${who}: ${msg.text}`);
            } else if (msg.type === 'vad' && msg.phase === 'start') {
              setVoiceState('listening');
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
          sessionReadyReceivedRef.current = false;

          if (wsRef.current === ws) {
            wsRef.current = null;
          }
          stopCapture();
          pushActiveRef.current = false;
          setVoiceState('idle');

          if (intentionalCloseRef.current) {
            setConnectionState('disconnected');
            appendLog('Disconnected');
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
  }, [authUser, appendLog, playPcmBase64, stopCapture, clearReconnectTimer]);

  connectWsRef.current = connectWs;

  /** Open the voice WebSocket as soon as the user is signed in so the first hold is not stuck in handshake. */
  useEffect(() => {
    const uid = authUser?.uid;
    if (!uid) return;
    void connectWsRef.current?.().catch(() => {});
  }, [authUser?.uid]);

  const startMicStreaming = useCallback(async (existingStream = null) => {
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
  }, [connectWs, stopCapture]);

  const beginPushToTalk = useCallback(async () => {
    setLastError(null);
    isPushIntendedRef.current = true;
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
      if (!isPushIntendedRef.current) {
        earlyStream = await micPromise.catch(() => null);
        earlyStream?.getTracks().forEach((t) => t.stop());
        return;
      }
      earlyStream = await micPromise;
      if (!isPushIntendedRef.current) {
        earlyStream.getTracks().forEach((t) => t.stop());
        earlyStream = null;
        return;
      }
      pushActiveRef.current = false;
      await startMicStreaming(earlyStream);
      earlyStream = null;
      if (!isPushIntendedRef.current) {
        stopCapture();
        return;
      }
      pushActiveRef.current = true;
      setVoiceState('listening');
      appendLog('Listening…');
    } catch (e) {
      earlyStream?.getTracks().forEach((t) => t.stop());
      const msg = e instanceof Error ? e.message : String(e);
      setLastError(msg);
      appendLog(`Mic / connect: ${msg}`);
      pushActiveRef.current = false;
    } finally {
      if (!pushActiveRef.current) {
        isPushIntendedRef.current = false;
      }
    }
  }, [
    unlockPlaybackForUserGesture,
    connectWs,
    startMicStreaming,
    appendLog,
    stopCapture,
  ]);

  const endPushToTalk = useCallback(() => {
    isPushIntendedRef.current = false;
    const ws = wsRef.current;
    setVoiceState((s) => (s === 'speaking' || s === 'thinking' ? s : 'idle'));
    requestAnimationFrame(() => {
      pushActiveRef.current = false;
      requestAnimationFrame(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'end_turn' }));
        }
        stopCapture();
      });
    });
  }, [stopCapture]);

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

  const endSession = useCallback(() => {
    disconnectWs();
    stopCapture();
    const p = playbackRef.current.ctx;
    if (p && p.state !== 'closed') {
      void p.close().catch(() => {});
    }
    playbackRef.current.ctx = null;
    playbackRef.current.nextTime = 0;
  }, [disconnectWs, stopCapture]);

  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      clearReconnectTimer();
      stopCapture();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [clearReconnectTimer, stopCapture]);

  return {
    connectionState,
    voiceState,
    lastError,
    logLines,
    beginPushToTalk,
    endPushToTalk,
    endSession,
    connectWs,
    sendTextMessage,
    textSending,
  };
}
