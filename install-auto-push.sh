#!/bin/bash
# 安装自动推送服务
# 每5分钟检查一次，有改动就自动提交并推送到GitHub

echo "🔧 安装 Moka CSS System 自动推送服务..."

REPO_DIR="/Users/moka/Desktop/moka-css-system"
PLIST_PATH="$HOME/Library/LaunchAgents/com.moka.css-auto-push.plist"

# 创建 launchd plist
cat > "$PLIST_PATH" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.moka.css-auto-push</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/moka/Desktop/moka-css-system/auto-push.sh</string>
        <string>auto: 自动定时推送</string>
    </array>
    <key>StartInterval</key>
    <integer>300</integer>
    <key>RunAtLoad</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/moka-css-auto-push.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/moka-css-auto-push.err</string>
</dict>
</plist>
PLIST

# 加载服务
launchctl unload "$PLIST_PATH" 2>/dev/null
launchctl load "$PLIST_PATH"

echo "✅ 安装完成！"
echo ""
echo "📋 服务详情："
echo "   - 每5分钟自动检查并推送改动"
echo "   - 日志: /tmp/moka-css-auto-push.log"
echo "   - 错误: /tmp/moka-css-auto-push.err"
echo ""
echo "🛑 停止服务: launchctl unload $PLIST_PATH"
echo "🔄 重启服务: launchctl load $PLIST_PATH"
echo "👀 查看状态: launchctl list | grep moka.css"
echo ""
echo "💡 也可以手动运行: cd /Users/moka/Desktop/moka-css-system && ./auto-push.sh"
