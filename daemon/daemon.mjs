// Hermes Safari Bridge daemon.
// - WS server on 127.0.0.1:52800
//   /extension  — the Safari extension background connects here (persistent)
//   /cli        — one-shot CLI commands
//
// CLI exit codes (bsk-style contract):
//   0 success | 1 usage/args | 2 extension offline | 3 daemon unreachable | 4 internal error

import http from 'node:http';
import { WebSocketServer } from 'ws';
import { URL } from 'node:url';

const PORT = 52800;
const LOG = '/tmp/safari-browser-daemon.log';

let extWs = null;
let extSeenAt = 0;
let pendingTabRestored = false;
let nextId = 1;

// HTTP server for health checks
const httpServer = http.createServer((req, res) => {
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    // Pass WebSocket upgrade through to ws library
    return;
  }
  // Handle HTTP health check
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'running', extConnected: !!extWs, lastSeenMs: extSeenAt }));
});

// Handle WebSocket upgrades
httpServer.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname !== '/extension' && pathname !== '/cli') {
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
    return;
  }
  // Let WebSocketServer handle the upgrade
  socket.destroy();
});

const wss = new WebSocketServer({ server: httpServer, path: '/extension' });
wss.on('connection', (ws) => {
  if (extWs && extWs.readyState === 1) {
    // Close previous extension connection (only one allowed)
    extWs.close();
  }
  extWs = ws;
  extSeenAt = Date.now();
  console.log(`[extension] connected id=${ws.id}`);

  // Restore pending tab if we had one
  if (!pendingTabRestored && pendingTab) {
    console.log(`[extension] restoring tab ${pendingTab} on connect`);
    // This will be handled by the extension sending its state
  }

  ws.on('message', (data) => {
    extSeenAt = Date.now();
    try {
      const msg = JSON.parse(data.toString());
      if (msg.__sbf === 'connected') {
        console.log(`[extension] registered ${msg.tabs?.length || 0} tabs`);
      }
    } catch (e) {
      console.error(`[extension] parse error:`, e.message);
    }
  });

  ws.on('close', () => {
    console.log('[extension] disconnected');
    extWs = null;
    extSeenAt = 0;
  });

  ws.on('error', (err) => {
    console.error('[extension] error:', err.message);
  });
});

const cliWss = new WebSocketServer({ server: httpServer, path: '/cli' });
cliWss.on('connection', (ws) => {
  console.log('[cli] connected');

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const { cmd, args } = msg;
      let result = {};
      let error = null;

      try {
        switch (cmd) {
          case 'status':
            result = {
              connected: !!extWs,
              daemon: true,
              extensionConnected: !!extWs && extWs.readyState === 1,
              lastSeenMs: extSeenAt,
            };
            break;
          case 'tabs': {
            if (!extWs || extWs.readyState !== 1) {
              error = 'extension not connected';
              break;
            }
            nextId++;
            ws.send(JSON.stringify({ id: msg.id, ok: true, type: 'tabs_list', result: [/* we'll get this from the extension */] }));
            extWs.send(JSON.stringify({ id: nextId, cmd: 'tab_list' }));
            break;
          }
          case 'navigate': {
            if (!extWs || extWs.readyState !== 1) {
              error = 'extension not connected';
              break;
            }
            nextId++;
            ws.send(JSON.stringify({ id: msg.id, ok: true, type: 'navigate', result: {} }));
            extWs.send(JSON.stringify({ id: nextId, cmd: 'navigate', args }));
            break;
          }
          default:
            error = `unknown CLI cmd: ${cmd}`;
        }
      } catch (e) {
        error = e.message;
      }

      ws.send(JSON.stringify({ id: msg.id, ok: !error, result, error }));
    } catch (e) {
      ws.send(JSON.stringify({ id: msg.id, ok: false, error: e.message }));
    }
  });

  ws.on('close', () => {
    console.log('[cli] disconnected');
  });
});

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`daemon listening on ws://127.0.0.1:${PORT}`);
});

process.on('SIGINT', () => {
  console.log('shutting down daemon');
  httpServer.close();
  wss.close();
  cliWss.close();
  process.exit(0);
});
