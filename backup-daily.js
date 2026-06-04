#!/usr/bin/env node
/**
 * Moka CSS System - Daily Backup Script
 * 备份 index.html 中的 EMBEDDED_DATA 到 COS，带时间戳
 * 用法: node backup-daily.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

// ===== 读取 COS 配置 =====
const CONF_PATH = path.join(__dirname, '.cos.conf');
const COS_CONFIG = {
    SecretId: process.env.COS_SECRET_ID || '',
    SecretKey: process.env.COS_SECRET_KEY || '',
    Bucket: process.env.COS_BUCKET || 'moka-css-system-1428834627',
    Region: process.env.COS_REGION || 'ap-chengdu',
};

// 尝试从 .cos.conf 读取
if (fs.existsSync(CONF_PATH)) {
    const conf = fs.readFileSync(CONF_PATH, 'utf8');
    conf.split('\n').forEach(line => {
        const kv = line.trim().split('=');
        if (kv.length >= 2) {
            const k = kv[0].trim();
            const v = kv.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
            if (k === 'COS_REGION') COS_CONFIG.Region = v;
            if (k === 'COS_BUCKET') COS_CONFIG.Bucket = v;
            if (k === 'COS_SECRET_ID') COS_CONFIG.SecretId = v;
            if (k === 'COS_SECRET_KEY') COS_CONFIG.SecretKey = v;
        }
    });
}

if (!COS_CONFIG.SecretId || !COS_CONFIG.SecretKey) {
    console.error('❌ COS 密钥未配置，请检查 .cos.conf 或环境变量');
    process.exit(1);
}

// ===== 解析 EMBEDDED_DATA =====
const INDEX_PATH = path.join(__dirname, 'index.html');
const html = fs.readFileSync(INDEX_PATH, 'utf8');
const match = html.match(/const\s+EMBEDDED_DATA\s*=\s*(\{[\s\S]*?\n\}\s*);/);
if (!match) {
    console.error('❌ 未找到 EMBEDDED_DATA');
    process.exit(1);
}

let data;
try {
    data = eval('(' + match[1] + ')');
} catch (e) {
    console.error('❌ 解析 EMBEDDED_DATA 失败:', e.message);
    process.exit(1);
}

// ===== 生成备份文件名 =====
const now = new Date();
const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
const timeStr = now.toTimeString().slice(0, 5).replace(':', '-'); // HH-MM
const backupKey = `backups/${dateStr}/embedded-data-${timeStr}.json`;

const body = JSON.stringify(data, null, 2);

// ===== COS REST API 签名（与 playwright-health-score.js 一致）=====
function cosSign(method, key) {
    const host = `${COS_CONFIG.Bucket}.cos.${COS_CONFIG.Region}.myqcloud.com`;
    const pathname = `/${key}`;
    const signTime = `${Math.floor(Date.now()/1000)-60};${Math.floor(Date.now()/1000)+3600}`;
    const httpString = `${method.toLowerCase()}\n${pathname}\n\nhost=${host}\n`;
    const sha1Http = crypto.createHash('sha1').update(httpString).digest('hex');
    const stringToSign = `sha1\n${signTime}\n${sha1Http}\n`;
    const signKey = crypto.createHmac('sha1', COS_CONFIG.SecretKey).update(signTime).digest('hex');
    const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');
    const auth = `q-sign-algorithm=sha1&q-ak=${COS_CONFIG.SecretId}&q-sign-time=${signTime}&q-key-time=${signTime}&q-header-list=host&q-url-param-list=&q-signature=${signature}`;
    return auth;
}

function cosRequest(method, key, body) {
    return new Promise((resolve, reject) => {
        const host = `${COS_CONFIG.Bucket}.cos.${COS_CONFIG.Region}.myqcloud.com`;
        const headers = { 'Host': host, 'Content-Type': 'application/json' };
        if (body) headers['Content-Length'] = Buffer.byteLength(body);
        headers['Authorization'] = cosSign(method, key);

        const req = https.request({
            hostname: host, path: `/${key}`, method, headers,
            timeout: 30000
        }, res => {
            let resp = '';
            res.on('data', chunk => resp += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({ ok: true, status: res.statusCode });
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${resp}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        if (body) req.write(body);
        req.end();
    });
}

// ===== 执行备份 =====
(async () => {
    try {
        console.log(`📦 正在备份 EMBEDDED_DATA...`);
        console.log(`   文件大小: ${(body.length / 1024).toFixed(1)} KB`);
        console.log(`   备份路径: ${backupKey}`);
        await cosRequest('PUT', backupKey, body);
        console.log(`✅ 备份成功!`);
        console.log(`   日期: ${dateStr} ${timeStr}`);
        console.log(`   访问: https://${COS_CONFIG.Bucket}.cos.${COS_CONFIG.Region}.myqcloud.com/${backupKey}`);
    } catch (e) {
        console.error(`❌ 备份失败: ${e.message}`);
        process.exit(1);
    }
})();
