// sbf — Hermes Safari Bridge CLI.
// One-shot command client for the local daemon (ws://127.0.0.1:52800/cli).
//
// Exit codes (bsk-style contract):
//   0 success | 1 usage/args | 2 extension offline | 3 daemon unreachable | 4 internal error

import { WebSocket } from 'ws';
import { exit } from 'node:process';

const DAEMON_URL = 'ws://127.0.0.1:52800/cli';

const help = `Usage: sbf <command> [args...]

Commands:
  status                                    Show daemon & extension status
  tabs list                                 List browser tabs
  tabs new [url]                            Open new tab
  tabs close [tabId]                        Close tab
  tabs borrow <tabId>                       Borrow tab for exclusive control
  tabs return <tabId>                       Return borrowed tab
  navigate <url>                            Navigate current tab
  read [options]                            Read page snapshot
    --max-chars <n>                         Max snapshot chars (default 12000)
  click @eN [options]                       Click element by ref
    --target '{"tabId":123}'                Target tab
  fill @eN <value> [options]                Fill form field
  select @eN <value> [options]              Select option
  press <key> [options]                     Press key
  scroll <dy> [ref] [options]               Scroll page
  value @eN [options]                       Get element value
  shot [options]                            Take screenshot
    --output <path>                         Save to file

Exit codes: 0=success 1=usage 2=extension offline 3=daemon unreachable 4=internal error`;

const usage = 'usage: sbf <command> [args...]\n' + help;

async function run() {
  if (process.argv.length < 3 || process.argv[2] === 'help' || process.argv[2] === '--help' || process.argv[2] === '-h') {
    console.log(help);
    exit(0);
  }

  const cmd = process.argv[2];
  const rest = process.argv.slice(3);
  let args = {};
  let target = null;

  // Parse options
  const targetIdx = rest.findIndex((x) => x.startsWith('--target='));
  if (targetIdx >= 0) {
    try {
      target = JSON.parse(rest.splice(targetIdx, 1)[0].replace('--target=', ''));
    } catch {}
  }

  switch (cmd) {
    case 'status': {
      await doRpc({ id: 1, cmd: 'status', args: {} });
      break;
    }
    case 'tabs': {
      const sub = rest[0];
      if (!sub) {
        console.log(JSON.stringify({ ok: false, error: 'usage: sbf tabs list|new [url]|close|focus|borrow|return <tabId>' }, null, 2));
        exit(1);
      }
      switch (sub) {
        case 'list': await doRpc({ cmd: 'tabs', args: { op: 'list' } }); break;
        case 'new': args.url = rest[1]; await doRpc({ cmd: 'tab_new', args: { url: args.url } }); break;
        case 'close': args.tabId = parseInt(rest[1], 10); await doRpc({ cmd: 'tab_close', args: { tabId: args.tabId } }); break;
        case 'borrow': args.tabId = parseInt(rest[1], 10); await doRpc({ cmd: 'tab_borrow', args: { tabId: args.tabId } }); break;
        case 'return': args.tabId = parseInt(rest[1], 10); await doRpc({ cmd: 'tab_return', args: { tabId: args.tabId } }); break;
        default: console.log(JSON.stringify({ ok: false, error: `unknown tabs sub: ${sub}` })); exit(1);
      }
      break;
    }
    case 'navigate':
      args.url = rest[0];
      args.target = target;
      await doRpc({ cmd: 'navigate', args });
      break;
    case 'read':
      args.maxChars = parseInt(rest.find((x) => x.startsWith('--max-chars='))?.split('=')[1] || '12000', 10);
      args.target = target;
      await doRpc({ cmd: 'read', args });
      break;
    case 'click': {
      const refTok = rest.find((x) => /^@?e\d+$/.test(x));
      if (refTok) args.ref = refTok;
      args.target = target;
      await doRpc({ cmd: 'click', args });
      break;
    }
    case 'fill': {
      const refTok = rest.find((x) => /^@?e\d+$/.test(x));
      const valIdx = refTok ? rest.indexOf(refTok) + 1 : 0;
      if (refTok) args.ref = refTok;
      if (rest[valIdx]) args.value = rest.slice(valIdx, rest.indexOf('--')).join(' ');
      else if (rest.length > (refTok ? rest.indexOf(refTok) + 1 : 0)) args.value = rest[rest.length - 1];
      else { console.log(JSON.stringify({ ok: false, error: 'usage: sbf fill @eN <value>' })); exit(1); }
      args.target = target;
      await doRpc({ cmd: 'fill', args });
      break;
    }
    case 'select': {
      const refTok = rest.find((x) => /^@?e\d+$/.test(x));
      if (refTok) args.ref = refTok;
      args.value = rest.find((x) => !/^@?e\d+$/.test(x));
      args.target = target;
      await doRpc({ cmd: 'select', args });
      break;
    }
    case 'press':
      args.key = rest[0];
      args.ref = rest.find((x) => /^@?e\d+$/.test(x)) || undefined;
      args.target = target;
      await doRpc({ cmd: 'press', args });
      break;
    case 'scroll':
      args.dy = parseInt(rest[0], 10) || 0;
      const refTok = rest.find((x) => /^@?e\d+$/.test(x));
      if (refTok) args.ref = refTok;
      args.target = target;
      await doRpc({ cmd: 'scroll', args });
      break;
    case 'value': {
      const refTok = rest.find((x) => /^@?e\d+$/.test(x));
      if (refTok) args.ref = refTok;
      args.target = target;
      await doRpc({ cmd: 'value', args });
      break;
    }
    case 'shot': {
      args.output = rest.find((x) => x.startsWith('--output='))?.split('=')[1];
      args.target = target;
      await doRpc({ cmd: 'screenshot', args });
      break;
    }
    default:
      console.log(JSON.stringify({ ok: false, error: `unknown command: ${cmd}` }));
      exit(1);
  }
}

async function doRpc(msg) {
  const ws = new WebSocket(DAEMON_URL);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    ws.on('close', () => reject(new Error('connection closed')));
    ws.on('message', (data) => {
      const resp = JSON.parse(data.toString());
      if (resp.id === msg.id) {
        console.log(JSON.stringify(resp, null, 2));
        exit(resp.ok ? 0 : (resp.error === 'extension not connected' ? 2 : 4));
      }
    });
  });
  ws.on('message', () => {}); // ignore extra messages
  try {
    ws.send(JSON.stringify(msg));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: `send failed: ${e.message}` }));
    exit(3);
  }
  // timeout
  setTimeout(() => {
    ws.send(JSON.stringify({ cmd: 'timeout' }));
    ws.close();
  }, 10000);
}

run().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  exit(4);
});
