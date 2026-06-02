#!/bin/bash
# Moka CSS System - 自动提交并推送到 GitHub
# 用法: ./auto-push.sh [commit message]

REPO_DIR="/Users/moka/Desktop/moka-css-system"
cd "$REPO_DIR" || exit 1

MSG="${1:-auto: $(date '+%Y-%m-%d %H:%M') 自动推送}"

# 检查是否有未提交的改动
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
    echo "✅ 没有需要推送的改动"
    exit 0
fi

echo "📦 提交改动..."
git add -A
git commit -m "$MSG"

echo "🚀 推送到 GitHub..."
git push origin main

echo "✅ 推送完成！"
echo "📍 访问: https://zhangchen9366.github.io/moka-css-system/"
echo "⏳ GitHub Pages 部署需要约 1-2 分钟生效"
