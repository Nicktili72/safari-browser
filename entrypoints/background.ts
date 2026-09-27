import { defineBackground } from '#imports';

export default defineBackground(() => {
  const DAEMON_WS = 'ws://127.0.0.1:52800/extension';
  const RECONNECT_BASE_MS = 500;
  let ws = null;
  let reconnectDelay = RECONNECT_BASE_MS;

  // Store tabId/WS id mapping for tab borrow/return
  const tabIdMap = new Map(); // tabId -> ws.id
  const wsIdMap = new Map(); // ws.id -> tabId

  // State persistence
  let pendingTab = null;

  async function connect() {
    ws = new WebSocket(DAEMON_WS);
    ws.onopen = () => {
      reconnectDelay = RECONNECT_BASE_MS;
      browser.runtime.sendMessage({ __sbf: 'connected', tabs: tabIdMap });
    };
    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      await handleMessage(msg);
    };
    ws.onclose = () => {
      browser.runtime.sendMessage({ __sbf: 'disconnected' });
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
    };
  }

  async function handleMessage(msg) {
    const { id, cmd, ...args } = msg;
    let result = {};
    let error = null;
    try {
      switch (cmd) {
        case 'navigate':
          await navigate(args);
          break;
        case 'read': {
          const t = await findTab(args.target);
          const snap = await contentCall(t.id, { __sbf: 'cmd', op: 'snapshot', maxChars: args.maxChars || 12000 });
          result = snap;
          break;
        }
        case 'click': {
          const t = await findTab(args.target);
          const res = await contentCall(t.id, { __sbf: 'cmd', op: 'click', ref: args.ref });
          result = res;
          break;
        }
        case 'fill': {
          const t = await findTab(args.target);
          const res = await contentCall(t.id, { __sbf: 'cmd', op: 'fill', ref: args.ref, value: args.value ?? '' });
          result = res;
          break;
        }
        case 'select': {
          const t = await findTab(args.target);
          const res = await contentCall(t.id, { __sbf: 'cmd', op: 'select', ref: args.ref, value: args.value });
          result = res;
          break;
        }
        case 'press': {
          const t = await findTab(args.target);
          const res = await contentCall(t.id, { __sbf: 'cmd', op: 'press', key: args.key, ref: args.ref });
          result = res;
          break;
        }
        case 'scroll': {
          const t = await findTab(args.target);
          const res = await contentCall(t.id, { __sbf: 'cmd', op: 'scroll', ref: args.ref, dx: args.dx || 0, dy: args.dy || 0, target: args.target });
          result = res;
          break;
        }
        case 'value': {
          const t = await findTab(args.target);
          const res = await contentCall(t.id, { __sbf: 'cmd', op: 'value', ref: args.ref });
          result = res;
          break;
        }
        case 'screenshot': {
          const t = await findTab(args.target);
          const tabId = args.target?.tabId ?? t.id;
          await browser.tabs.update(tabId, { active: true });
          await new Promise((r) => setTimeout(r, 150));
          const dataUrl = await browser.tabs.captureVisibleTab(t.windowId, { format: 'png' });
          const b64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
          result = { tabId, dataUrl, b64Length: b64.length };
          break;
        }
        case 'tab_list': {
          const tabs = await browser.tabs.query({});
          result = tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, windowId: t.windowId, active: t.active }));
          break;
        }
        case 'tab_new':
          await browser.tabs.create({ url: args.url });
          break;
        case 'tab_close':
          await browser.tabs.remove(args.tabId);
          break;
        case 'tab_borrow':
          tabIdMap.set(args.tabId, ws.id);
          wsIdMap.set(ws.id, args.tabId);
          result = { tabId: args.tabId };
          break;
        case 'tab_return':
          tabIdMap.delete(args.tabId);
          wsIdMap.delete(ws.id);
          result = {};
          break;
        default:
          error = `unknown cmd: ${cmd}`;
      }
    } catch (e) {
      error = e.message;
    }
    ws.send(JSON.stringify({ id, ok: !error, result, error }));
  }

  async function navigate(args) {
    if (args.url) {
      await browser.tabs.update(args.target?.tabId, { url: args.url });
    }
  }

  async function contentCall(tabId, msg) {
    const resp = await browser.tabs.sendMessage(tabId, msg, { frameId: 0 });
    return resp;
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
