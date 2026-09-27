#!/bin/bash
# Start the Hermes Safari Bridge daemon (background process).
# Usage: ./daemon.sh [--stop] [--status]
set -e

PIDFILE="/tmp/safari-browser-daemon.pid"
DAEMON="daemon/daemon.mjs"
PORT=52800

case "${1:-start}" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "Daemon already running (PID $(cat "$PIDFILE"), port $PORT)"
      exit 0
    fi
    echo "Starting daemon on ws://127.0.0.1:$PORT ..."
    nohup node "$DAEMON" > /tmp/safari-browser-daemon.log 2>&1 &
    echo $! > "$PIDFILE"
    sleep 1
    if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "Daemon running (PID $(cat "$PIDFILE"))"
    else
      echo "Daemon failed to start. Check /tmp/safari-browser-daemon.log"
      cat /tmp/safari-browser-daemon.log
      exit 1
    fi
    ;;
  stop)
    if [ -f "$PIDFILE" ]; then
      kill "$(cat "$PIDFILE")" 2>/dev/null || true
      rm -f "$PIDFILE"
      echo "Daemon stopped"
    else
      echo "Daemon not running"
    fi
    ;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "Daemon running (PID $(cat "$PIDFILE"), port $PORT)"
      curl -s http://127.0.0.1:$PORT/ 2>/dev/null | python3 -m json.tool 2>/dev/null || true
    else
      echo "Daemon not running"
      [ -f "$PIDFILE" ] && rm -f "$PIDFILE"
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|status}"
    exit 1
    ;;
esac
