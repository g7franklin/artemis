import 'dotenv/config';
import http from 'http';
import { parse } from 'url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { logEnvStatus } from './config/env.js';
import { verifyFirebaseIdToken } from './db/firestore.js';
import { startAgentSession } from './agent/agentLoop.js';

logEnvStatus();

const PORT = Number(process.env.PORT || 8080);

const app = express();
{
  const raw = process.env.TRUST_PROXY_HOPS;
  const hops =
    raw === undefined || raw === '' ? 1 : Number(raw);
  app.set('trust proxy', hops === 0 ? false : hops);
}

app.get('/health', (_req, res) => {
  res.status(200).type('text/plain').send('OK');
});

/** Optional readiness probe: 200 when core voice + auth env present. */
app.get('/ready', (_req, res) => {
  const voiceReady = Boolean(
    process.env.XAI_API_KEY?.trim() &&
      process.env.FIREBASE_PROJECT_ID?.trim() &&
      process.env.FIREBASE_CLIENT_EMAIL?.trim() &&
      process.env.FIREBASE_PRIVATE_KEY?.trim()
  );
  res.status(voiceReady ? 200 : 503).type('application/json').send(
    JSON.stringify({ ok: voiceReady })
  );
});

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (request, socket, head) => {
  const { pathname, query } = parse(request.url || '/', true);
  if (pathname !== '/voice') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const rawToken = query.token;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  if (!token || typeof token !== 'string') {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  let decoded;
  try {
    decoded = await verifyFirebaseIdToken(token);
  } catch (e) {
    console.error('[server] auth failed', e?.message || e);
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  const userId = decoded.uid;
  wss.handleUpgrade(request, socket, head, (ws) => {
    ws.userId = userId;
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws) => {
  const userId = ws.userId;
  if (!userId) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  void (async () => {
    try {
      await startAgentSession(ws, userId);
    } catch (e) {
      console.error('[server] agent session failed', e);
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: e instanceof Error ? e.message : String(e),
          })
        );
      } catch {
        /* ignore */
      }
      ws.close(1011, 'Agent failed');
    }
  })();
});

server.listen(PORT, () => {
  console.log(`Artemis backend listening on ${PORT} (ws path /voice?token=…)`);
});
