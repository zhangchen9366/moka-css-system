const { webkit } = require('playwright');
const fs = require('fs');
const path = require('path');

const COOKIE_FILE = path.join(__dirname, '.cookies.json');
const JSONBIN_API = 'https://api.jsonbin.io/v3';
const JSONBIN_KEY = '$2a$10$94MoVDNRO0bakGDYcTsN3.BEiTefnDwwkXGndi1VuAZqxhKHhggby';
const HEALTH_BIN_ID = '6a089ef2adc21f119aad2ceb';
const CRM_URL = 'https://crm.xiaoshouyi.com';

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// 从 JSONBin 读取现有数据
async function loadBin() {
    const res = await fetch(`${JSONBIN_API}/b/${HEALTH_BIN_ID}/latest`, {
        headers: { 'X-Master-Key': JSONBIN_KEY }
    });
    if (!res.ok) throw new Error(`读取Bin失败: ${res.status}`);
    return await res.json(); // { record: { snapshots: [...] } }
}

// 写入 JSONBin
async function saveBin(data) {
    const res = await fetch(`${JSONBIN_API}/b/${HEALTH_BIN_ID}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'X-Master-Key': JSONBIN_KEY
        },
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`写入Bin失败: ${res.status} ${await res.text()}`);
    return true;
}

// 获取当前周次（如 2026-W20）
function getWeekKey() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const diff = now - start;
    const oneWeek = 604800000;
    const weekNum = Math.ceil((diff / oneWeek) + 1);
    return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// 主函数
async function main() {
    const browser = await webkit.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    // 尝试加载已保存的 cookies
    if (fs.existsSync(COOKIE_FILE)) {
        try {
            const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
            await context.addCookies(cookies);
            console.log('✅ 已加载保存的登录状态');
        } catch (e) {
            console.log('⚠️  加载 cookies 失败，将重新登录:', e.message);
        }
    }

    console.log('🚀 正在打开销售易...');
    await page.goto(`${CRM_URL}/index.action`, { waitUntil: 'networkidle', timeout: 60000 });

    // 检查是否需要登录：判断是否在登录域名或存在登录表单
    const needLogin = await page.evaluate(() => {
        return window.location.href.includes('login') ||
               !!document.querySelector('input[type="password"]');
    }).catch(() => true);

    if (needLogin) {
        console.log('🔐 需要登录，请在浏览器中手动完成登录（含2FA/验证码）...');
        console.log('   登录成功后脚本将自动继续（等待跳转到CRM主页）');

        try {
            await page.waitForFunction(
                () => !window.location.href.includes('login'),
                { timeout: 300000 }
            );
            console.log('✅ 登录检测成功！');
        } catch (e) {
            console.log('⚠️  登录等待超时，尝试继续...');
        }

        // 保存 cookies
        const cookies = await context.cookies();
        fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
        console.log('✅ 登录状态已保存到', COOKIE_FILE);
    } else {
        console.log('✅ 使用已保存的登录状态');
    }

    // 跳转到客户列表页
    const accountUrl = `${CRM_URL}/bff/neoweb#/entityGrid/account?objectApiKey=account`;
    console.log('📋 正在跳转到客户列表页...');
    await page.goto(accountUrl);
    await sleep(5000);

    // 等待列表加载
    console.log('🔍 等待客户列表加载...');
    try {
        await page.waitForSelector('table, [class*="grid"], [class*="table"]', { timeout: 30000 });
        console.log('✅ 列表容器已加载');
    } catch (e) {
        console.log('⚠️  未检测到标准列表容器，尝试继续...');
    }
    await sleep(3000);

    // 检查「最新健康分」列
    const hasHealthCol = await page.evaluate(() => {
        const allText = document.body.innerText;
        return allText.includes('健康分');
    }).catch(() => false);

    if (!hasHealthCol) {
        console.log('⚠️  未检测到「最新健康分」列');
        console.log('   请在浏览器中确认该列在列表视图中可见，按回车继续...');
        await new Promise(resolve => {
            process.stdin.once('data', () => resolve());
        });
    }

    // 抓取数据
    console.log('📊 开始抓取客户数据...');
    const allData = [];
    let pageNum = 1;
    let hasNext = true;

    while (hasNext && pageNum <= 50) {
        console.log(`   正在抓取第 ${pageNum} 页...`);

        const pageData = await page.evaluate(() => {
            const results = [];
            // 尝试找到表格行
            const rows = Array.from(document.querySelectorAll('tbody tr, [class*="row"]:not([class*="header"])'));

            if (rows.length === 0) {
                // 备用：取所有 tr
                const allRows = document.querySelectorAll('tr');
                if (allRows.length <= 1) return [];
            }

            // 先获取表头，确定各列索引
            const headerCells = document.querySelectorAll('thead th, [class*="header-cell"]');
            const headers = Array.from(headerCells).map(h => h.innerText.trim());
            const nameIdx = headers.findIndex(h => h.includes('客户') || h.includes('名称'));
            const healthIdx = headers.findIndex(h => h.includes('健康分'));
            const cssIdx = headers.findIndex(h => h.includes('CSS') || h.includes('负责'));

            const dataRows = Array.from(document.querySelectorAll('tbody tr')).filter(tr => {
                const cells = tr.querySelectorAll('td');
                return cells.length >= 2;
            });

            dataRows.forEach(row => {
                try {
                    const cells = row.querySelectorAll('td');
                    const name = nameIdx >= 0 ? (cells[nameIdx] || {}).innerText || '' : (cells[1] || {}).innerText || '';
                    const healthScore = healthIdx >= 0 ? parseFloat((cells[healthIdx] || {}).innerText) || 0 : 0;
                    const css = cssIdx >= 0 ? ((cells[cssIdx] || {}).innerText || '').trim() : '';

                    // 获取详情链接
                    let crmUrl = '';
                    const nameCell = nameIdx >= 0 ? cells[nameIdx] : cells[1];
                    if (nameCell) {
                        const link = nameCell.querySelector('a');
                        if (link && link.href) crmUrl = link.href;
                    }

                    if (name && name.length > 0 && name.length < 100) {
                        results.push({
                            customerName: name.trim(),
                            healthScore: healthScore,
                            css: css,
                            crmUrl: crmUrl
                        });
                    }
                } catch (e) { /* 忽略单行错误 */ }
            });
            return results;
        }).catch(e => { console.log('   页面解析出错:', e.message); return []; });

        if (pageData.length > 0) {
            console.log(`   第 ${pageNum} 页：抓取到 ${pageData.length} 条`);
            allData.push(...pageData);
        } else {
            console.log(`   第 ${pageNum} 页：未抓取到数据`);
        }

        // 检查是否有下一页
        hasNext = await page.evaluate(() => {
            const nextBtn = document.querySelector('[class*="next"], button:has-text("下一页"), li:has-text("下一页")');
            if (nextBtn && !nextBtn.disabled && !nextBtn.classList.contains('disabled')) {
                nextBtn.click();
                return true;
            }
            // 尝试找分页组件
            const pager = document.querySelector('[class*="pagination"]');
            if (pager) {
                const next = pager.querySelector('[class*="next"]:not([class*="disabled"])');
                if (next) { next.click(); return true; }
            }
            return false;
        }).catch(() => false);

        if (hasNext) {
            await sleep(3000);
            pageNum++;
        }
    }

    console.log(`📊 抓取完成！共 ${allData.length} 条客户数据`);

    if (allData.length === 0) {
        console.log('❌ 未抓取到任何数据，请检查：');
        console.log('   1. 客户列表页是否正常加载？');
        console.log('   2. 「最新健康分」列是否已显示在列表中？');
        console.log('   浏览器将保持打开，请手动检查后关闭。');
        await sleep(300000);
        await browser.close();
        return;
    }

    // 构建快照
    const snapshot = {
        week: getWeekKey(),
        timestamp: new Date().toISOString(),
        threshold: 4,
        data: allData
    };

    // 写入 JSONBin
    console.log('💾 正在写入 JSONBin...');
    try {
        const binData = await loadBin();
        binData.record.snapshots = binData.record.snapshots || [];
        binData.record.snapshots.push(snapshot);

        // 只保留最近12周数据
        if (binData.record.snapshots.length > 12) {
            binData.record.snapshots = binData.record.snapshots.slice(-12);
        }

        await saveBin(binData.record);
        console.log('✅ 数据已写入 JSONBin！快照周次：', snapshot.week);
    } catch (err) {
        console.error('❌ 写入 JSONBin 失败：', err.message);
    }

    await browser.close();
    console.log('🎉 全部完成！');
}

main().catch(err => {
    console.error('❌ 脚本执行失败：', err);
    process.exit(1);
});
