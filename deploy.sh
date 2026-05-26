#!/bin/bash
set -e

PROJECT_DIR="/Users/moka/Desktop/moka-css-system"
CONF="$PROJECT_DIR/.cos.conf"

source "$CONF"
cd "$PROJECT_DIR"

echo "🚀 开始部署..."
echo ""

# 1️⃣ GitHub 推送
echo "📦 推送到 GitHub..."
if [ -z "$(git status --porcelain)" ]; then
    echo "   ⚠️  没有文件改动，跳过 commit"
else
    git add -A
    git commit -m "deploy: $(date '+%m-%d %H:%M')" && echo "   ✅ 已提交"
fi
git push origin main && echo "   ✅ GitHub 已推送"

echo ""

# 2️⃣ Gitee 同步
echo "📦 推送到 Gitee..."
git push gitee main --force-with-lease 2>/dev/null && echo "   ✅ Gitee 已同步" || echo "   ⚠️  Gitee 推送失败（已跳过）"

echo ""

# 3️⃣ COS 上传
echo "☁️  同步到腾讯云 COS..."
python3 << PYEOF
from qcloud_cos import CosConfig, CosS3Client
import os

config = CosConfig(
    Region=os.environ.get('COS_REGION', '$COS_REGION'),
    SecretId=os.environ.get('COS_SECRET_ID', '$COS_SECRET_ID'),
    SecretKey=os.environ.get('COS_SECRET_KEY', '$COS_SECRET_KEY')
)
client = CosS3Client(config)
bucket = os.environ.get('COS_BUCKET', '$COS_BUCKET')

files = {
    'index.html': 'text/html; charset=utf-8',
    'vue.global.prod.js': 'application/javascript',
    'echarts.min.js': 'application/javascript',
    'xlsx.full.min.js': 'application/javascript',
    'cos-js-sdk-v5.min.js': 'application/javascript',
}

for filename, content_type in files.items():
    with open(f'$PROJECT_DIR/{filename}', 'rb') as f:
        client.put_object(
            Bucket=bucket,
            Key=filename,
            Body=f,
            ContentType=content_type,
            CacheControl='no-cache'
        )
    print(f"   ✅ {filename}")
PYEOF

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 部署完成！"
echo ""
echo "🌐 国内访问："
echo "   https://$COS_WEBSITE"
echo ""
echo "🌍 GitHub Pages："
echo "   https://zhangchen9366.github.io/moka-css-system/"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
