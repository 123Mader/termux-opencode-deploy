#!/system/bin/sh
# DeXRay AI MCP 服务器 管理脚本
# 用法: sh dexray.sh start|stop|status|restart
D=/storage/emulated/0/MT2/apks/dexray
LOG=/data/user/0/com.dsharnessmobile.shell/files/home/tmp/dexray.log
PORT=8791

is_running() {
  curl -s --max-time 2 "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"ok":true'
}

case "$1" in
  start)
    if is_running; then echo "✅ 已在运行 (端口 $PORT)"; else
      nohup node "$D/mcp_server.js" $PORT > "$LOG" 2>&1 &
      sleep 1.5
      is_running && echo "✅ DeXRay 已启动 (http://127.0.0.1:$PORT/mcp)" || echo "❌ 启动失败, 看日志: $LOG"
    fi
    ;;
  stop)
    PID=$(ss -tlnp 2>/dev/null | grep $PORT | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
    [ -n "$PID" ] && kill $PID 2>/dev/null && echo "🛑 已停止" || echo "未在运行"
    ;;
  status)
    is_running && echo "✅ 运行中" || echo "⏹️ 未运行 (用 sh dexray.sh start 启动)"
    ;;
  restart) "$0" stop; sleep 1; "$0" start ;;
  *) echo "用法: sh dexray.sh start|stop|status|restart" ;;
esac
