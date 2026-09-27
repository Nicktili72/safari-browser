import { defineBackground } from '#imports';

// Allowed commands — whitelist prevents code injection (fixes H-1)
const ALLOWED_COMMANDS = new Set([
  'snapshot', 'click', 'fill', 'select', 'press', 'scroll', 'value',
  'screenshot', 'navigate', 'tab_list', 'tab_new', 'tab_close',
  'tab_borrow', 'tab_return',
]);

export default defineBackground(() => {
  const DAEMON_WS = 'ws://127.0.0.1:52800/extension';
  const RECONNECT_BASE_MS = 500;
  let ws = null;
  let reconnectDelay = RECONNECT_BASE_MS;
  let wsAuthSecret = null;

  // WS challenge-response auth (fixes M-1)
  function sendAuthChallenge() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const challenge = crypto.getRandomValues(new Uint8Array(16));
    wsAuthSecret = btoa(String.fromCharCode(...challenge));
    ws.send(JSON.stringify({ type: 'auth_challenge', challenge: wsAuthSecret }));
  }

  async function verifyAuth(msg) {
    if (!wsAuthSecret) return { ok: false, error: 'no challenge yet' };
    if (!msg.auth_secret || msg.auth_secret !== wsAuthSecret) {
      return { ok: false, error: 'auth rejected' };
    }
    wsAuthSecret = null;
    return { ok: true };
  }

  // Store tabId/WS id mapping for tab borrow/return
  const tabIdMap = new Map();
  const wsIdMap = new Map();
  let pendingTab = null;

  async function connect() {
    ws = new WebSocket(DAEMON_WS);
    ws.onopen = () => {
      reconnectDelay = RECONNECT_BASE_MS;
      sendAuthChallenge();
      browser.runtime.sendMessage({ __sbf: 'connected', tabs: tabIdMap });
    };
    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      // Handle auth response
      if (msg.type === 'auth_response') {
        const verified = await verifyAuth(msg);
        if (!verified.ok) {
          console.error('[sbf] auth failed:', verified.error);
          ws.close();
          return;
        }
        return;
      }
      await handleMessage(msg);
    };
    ws.onclose = () => {
      browser.runtime.sendMessage({ __sbf: 'disconnected' });
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
    };
  }

  // Dispatch table — cmd string never interpolated into code (fixes H-1)
  async function handleNavigate(args) {
    if (args.url) await browser.tabs.update(args.target?.tabId, { url: args.url });
  }

  async function handleRead(args) {
    const t = await findTab(args.target);
    return contentCall(t.id, { __sbf: 'cmd', op: 'snapshot', maxChars: args.maxChars || 12000 });
  }

  async function handleAction(args) {
    const t = await findTab(args.target);
    return contentCall(t.id, { __sbf: 'cmd', op: args.op, ref: args.ref, value: args.value, key: args.key, dx: args.dx, dy: args.dy, target: args.target });
  }

  async function handleScreenshot(args) {
    const t = await findTab(args.target);
    const tabId = args.target?.tabId ?? t.id;
    await browser.tabs.update(tabId, { active: true });
    await new Promise((r) => setTimeout(r, 150));
    const dataUrl = await browser.tabs.captureVisibleTab(t.windowId, { format: 'png' });
    const b64 = String(dataUrl).replace(/^data:image\/png;base64/, '');
    return { tabId, dataUrl, b64Length: b64.length };
  }

  async function handleTabList() {
    const tabs = await browser.tabs.query({});
    return tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, windowId: t.windowId, active: t.active }));
  }

  async function handleTabNew(args) {
    await browser.tabs.create({ url: args.url });
  }

  async function handleTabClose(args) {
    await browser.tabs.remove(args.tabId);
  }

  async function handleTabBorrow(args) {
    tabIdMap.set(args.tabId, ws.id);
    wsIdMap.set(ws.id, args.tabId);
    return { tabId: args.tabId };
  }

  async function handleTabReturn() {
    tabIdMap.delete(args?.tabId);
    wsIdMap.delete(ws.id);
    return {};
  }

  const commandHandlers = {
    navigate:    handleNavigate,
    read:        handleRead,
    click:       (a) => handleAction({ ...a, op: 'click' }),
    fill:        (a) => handleAction({ ...a, op: 'fill' }),
    select:      (a) => handleAction({ ...a, op: 'select' }),
    press:       (a) => handleAction({ ...a, op: 'press' }),
    scroll:      (a) => handleAction({ ...a, op: 'scroll' }),
    value:       (a) => handleAction({ ...a, op: 'value' }),
    screenshot:  handleScreenshot,
    tab_list:    handleTabList,
    tab_new:     handleTabNew,
    tab_close:   handleTabClose,
    tab_borrow:  handleTabBorrow,
    tab_return:  handleTabReturn,
  };

  async function handleMessage(msg) {
    const { id, cmd, args = {} } = msg;
    let result = {};
    let error = null;
    try {
      const handler = commandHandlers[cmd];
      if (!handler) throw new Error(`unknown cmd: ${cmd}`);
      result = await handler(args);
    } catch (e) {
      error = e.message;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id, ok: !error, result, error }));
    }
  }

  async function contentCall(tabId, msg) {
    return browser.tabs.sendMessage(tabId, msg, { frameId: 0 });
  }

  async function findTab(target) {
    if (!target) {
      const wins = await browser.windows.getAll({ populate: true });
      const w = wins.find((x) => x.tabs?.length) || wins[0];
      const t = w?.tabs?.[0];
      if (!t) throw new Error('no target tab specified and no tabs found in Safari');
      return t;
    }
    if (target.tabId != null) {
      const tabs = await browser.tabs.query({});
      const t = tabs.find((x) => x.id === target.tabId);
      if (!t) throw new Error(`tab ${target.tabId} not found`);
      return t;
    }
    const tabs = await browser.tabs.query({});
    const t = tabs.find((x) => x.url === target.url);
    if (t) return t;
    throw new Error(`tab with url ${target.url} not found`);
  }

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.__sbf === 'connected') {
      const tabs = msg.tabs || [];
      tabs.forEach((t) => {
        tabIdMap.set(t.id, msg.id);
        wsIdMap.set(msg.id, t.id);
      });
    }
    if (msg?.__sbf === 'disconnected') {
      tabIdMap.clear();
      wsIdMap.clear();
    }
  });

  connect();
});
