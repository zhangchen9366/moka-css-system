#!/bin/bash
# Moka CSS 系统本地服务器启动脚本
# 自动检测IP地址并启动HTTP服务

PORT=8899
DIR="$(cd "$(dirname "$0")" && pwd)"

# 清理旧进程
lsof -ti :$PORT 2>/dev/null | xargs kill -9 2>/dev/null

# 启动服务
cd "$DIR"
python3 -m http.server $PORT &
PID=$!

sleep 1

# 获取当前IP
IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)

echo ""
echo "✅ Moka CSS 系统已启动"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PID:  $PID"
echo "  PORT: $PORT"
echo "  URL:  http://$IP:$PORT/"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "按 Ctrl+C 停止服务"
echo ""

# 保持运行
wait $PID 2>/dev/null
