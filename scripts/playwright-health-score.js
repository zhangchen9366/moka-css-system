const { webkit } = require('playwright');
const fs = require('fs');
const path = require('path');

const COOKIE_FILE = path.join(__dirname, '.cookies.json');
const JSONBIN_API = 'https://api.jsonbin.io/v3';
const JSONBIN_KEY = '$2a$10$94MoVDNRO0bakGDYcTsN3.BEiTefnDwwkXGndi1VuAZqxhKHhggby';
const HEALTH_BIN_ID = '6a089ef2adc21f119aad2ceb';
const CRM_URL = 'https://crm.xiaoshouyi.com';

// ===== 只保留这些 CSS 负责人的客户 =====
const TARGET_CSS = [
    '张辰', '宋明亮', '娄洋', '王俊朋', '曾瑞锋', '徐琪', '李晓丽',
    '金梅', '王亚淼', '周旺'
];

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function loadBin() {
    const res = await fetch(`${JSONBIN_API}/b/${HEALTH_BIN_ID}/latest`, {
        headers: { 'X-Master-Key': JSONBIN_KEY }
    });
    if (!res.ok) throw new Error(`读取Bin失败: ${res.status}`);
    return await res.json();
}

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

function getWeekKey() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const diff = now - start;
    const oneWeek = 604800000;
    const weekNum = Math.ceil((diff / oneWeek) + 1);
    return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

async function main() {
    console.log('🎯 目标CSS人员：' + TARGET_CSS.join('、'));
    console.log('   销售易列名：ATS CSS / PP CSS / 健康分');
    console.log('   策略：抓取全量 → 本地按人过滤\n');

    const browser = await webkit.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    // 加载 cookies
    if (fs.existsSync(COOKIE_FILE)) {
        try {
            const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
            await context.addCookies(cookies);
            console.log('✅ 已加载保存的登录状态');
        } catch (e) {
            console.log('⚠️  加载 cookies 失败:', e.message);
        }
    }

    console.log('🚀 正在打开销售易...');
    await page.goto(`${CRM_URL}/index.action`, { waitUntil: 'networkidle', timeout: 60000 });

    // 登录检测
    const needLogin = await page.evaluate(() => {
        return window.location.href.includes('login') ||
               !!document.querySelector('input[type="password"]');
    }).catch(() => true);

    if (needLogin) {
        console.log('🔐 请在浏览器中手动登录...');
        try {
            await page.waitForFunction(() => !window.location.href.includes('login'), { timeout: 300000 });
            console.log('✅ 登录成功！');
        } catch (e) {
            console.log('⚠️  登录超时，尝试继续...');
        }
        const cookies = await context.cookies();
        fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
        console.log('✅ 登录状态已保存');
    } else {
        console.log('✅ 使用已保存的登录状态');
    }

    // 跳转客户列表
    const accountUrl = `${CRM_URL}/bff/neoweb#/entityGrid/account?objectApiKey=account`;
    console.log('📋 正在跳转客户列表...');
    await page.goto(accountUrl);
    await sleep(6000);

    // 等待列表
    console.log('⏳ 等待列表加载...');
    try {
        await page.waitForSelector('table, [class*="grid"], [class*="table"], [class*="list"]', { timeout: 30000 });
        console.log('✅ 列表容器已加载');
    } catch (e) {
        console.log('⚠️  未检测到列表容器，继续...');
    }
    await sleep(3000);

    // ===== 第一步：先打印表头，确认列名 =====
    console.log('\n===== 第一步：识别表头列名 =====');
    const headerInfo = await page.evaluate(() => {
        const headerCells = document.querySelectorAll('thead th, [class*="header-cell"], [class*="col-header"], [class*="header"] th');
        const headers = Array.from(headerCells).map((h, i) => ({
            idx: i,
            text: h.innerText.trim().replace(/\s+/g, ' ')
        }));
        return headers;
    }).catch(() => []);

    console.log('📋 当前列表的列名：');
    headerInfo.forEach(h => console.log(`   [${h.idx}] ${h.text}`));

    // 找关键列
    const nameCol = headerInfo.find(h => h.text.includes('客户') || h.text.includes('名称'));
    const healthCol = headerInfo.find(h => h.text.includes('健康分'));
    const atsCssCol = headerInfo.find(h => h.text === 'ATS CSS' || h.text.includes('ATS CSS'));
    const ppCssCol = headerInfo.find(h => h.text === 'PP CSS' || h.text.includes('PP CSS'));
    // 兼容：如果列名有细微差异
    const anyCssCol = headerInfo.find(h => /ATS\s*CSS|PP\s*CSS/i.test(h.text));

    console.log('\n🔍 关键列定位：');
    console.log(`   客户名称：${nameCol ? `[${nameCol.idx}] ${nameCol.text}` : '❌ 未找到'}`);
    console.log(`   健康分：${healthCol ? `[${healthCol.idx}] ${healthCol.text}` : '❌ 未找到'}`);
    console.log(`   ATS CSS：${atsCssCol ? `[${atsCssCol.idx}] ${atsCssCol.text}` : '❌ 未找到'}`);
    console.log(`   PP CSS：${ppCssCol ? `[${ppCssCol.idx}] ${ppCssCol.text}` : '❌ 未找到'}`);
    console.log(`   任意CSS列：${anyCssCol ? `[${anyCssCol.idx}] ${anyCssCol.text}` : '❌ 未找到'}`);

    // 如果健康分列没找到，提示用户手动添加
    if (!healthCol) {
        console.log('\n⚠️⚠️⚠️ 未检测到「健康分」列！');
        console.log('请在浏览器中操作：');
        console.log('   1. 找到列设置/自定义列');
        console.log('   2. 添加「健康分」列');
        console.log('   3. 确保列表中能看到健康分数据');
        console.log('   4. 操作完后回到终端按回车继续');
        await new Promise(resolve => { process.stdin.once('data', () => resolve()); });
        // 重新读取表头
        const headerInfo2 = await page.evaluate(() => {
            const headerCells = document.querySelectorAll('thead th, [class*="header-cell"], [class*="col-header"], [class*="header"] th');
            return Array.from(headerCells).map((h, i) => ({ idx: i, text: h.innerText.trim().replace(/\s+/g, ' ') }));
        }).catch(() => []);
        console.log('📋 更新后的列名：');
        headerInfo2.forEach(h => console.log(`   [${h.idx}] ${h.text}`));
    }

    // ===== 第二步：抓取所有页 =====
    console.log('\n===== 第二步：开始抓取全量数据 =====');
    const allRaw = [];
    let pageNum = 1;
    let hasNext = true;
    let emptyPages = 0;

    while (hasNext && pageNum <= 100 && emptyPages < 3) {
        console.log(`📄 第 ${pageNum} 页...`);

        const pageData = await page.evaluate(() => {
            const results = [];

            // 获取所有表头
            const headerCells = document.querySelectorAll('thead th, [class*="header-cell"], [class*="col-header"], [class*="header"] th');
            const headers = Array.from(headerCells).map(h => h.innerText.trim().replace(/\s+/g, ' '));

            // 找各列索引
            const nameIdx = headers.findIndex(h => h.includes('客户') || h.includes('名称'));
            const healthIdx = headers.findIndex(h => h.includes('健康分'));
            const atsCssIdx = headers.findIndex(h => h === 'ATS CSS');
            const ppCssIdx = headers.findIndex(h => h === 'PP CSS');

            // 兼容匹配
            let cssIdx1 = atsCssIdx;
            let cssIdx2 = ppCssIdx;
            if (cssIdx1 < 0) cssIdx1 = headers.findIndex(h => /ATS\s*CSS/i.test(h));
            if (cssIdx2 < 0) cssIdx2 = headers.findIndex(h => /PP\s*CSS/i.test(h));

            // 取数据行
            const dataRows = Array.from(document.querySelectorAll('tbody tr')).filter(tr => {
                return tr.querySelectorAll('td').length >= 2;
            });

            dataRows.forEach(row => {
                try {
                    const cells = row.querySelectorAll('td');
                    const name = nameIdx >= 0 ? (cells[nameIdx]?.innerText || '').trim() : '';
                    const healthScore = healthIdx >= 0 ? parseFloat(cells[healthIdx]?.innerText || '0') || 0 : 0;
                    const atsCss = cssIdx1 >= 0 ? (cells[cssIdx1]?.innerText || '').trim() : '';
                    const ppCss = cssIdx2 >= 0 ? (cells[cssIdx2]?.innerText || '').trim() : '';

                    // 获取CRM链接
                    let crmUrl = '';
                    const nameCell = nameIdx >= 0 ? cells[nameIdx] : null;
                    if (nameCell) {
                        const link = nameCell.querySelector('a');
                        if (link?.href) crmUrl = link.href;
                    }

                    if (name && name.length > 0 && name.length < 100) {
                        results.push({ customerName: name, healthScore, atsCss, ppCss, crmUrl });
                    }
                } catch (e) {}
            });

            return results;
        }).catch(e => {
            console.log('   ⚠️ 解析出错:', e.message);
            return [];
        });

        if (pageData.length > 0) {
            allRaw.push(...pageData);
            emptyPages = 0;
            console.log(`   ✅ ${pageData.length} 条（累计 ${allRaw.length}）`);
        } else {
            emptyPages++;
            console.log(`   ⬜ 0 条`);
        }

        // 下一页
        hasNext = await page.evaluate(() => {
            // 方式1：按钮文字匹配
            const allBtns = document.querySelectorAll('button, a, [role="button"], li[class*="page"], span[class*="page"]');
            for (const btn of allBtns) {
                const text = (btn.innerText || '').trim();
                const cls = btn.className || '';
                if ((text === '下一页' || text === '>' || text.includes('next') || text === '›') 
                    && !btn.disabled 
                    && !cls.includes('disabled') 
                    && !cls.includes('is-disabled')
                    && btn.offsetParent !== null) {
                    btn.click();
                    return true;
                }
            }
            return false;
        }).catch(() => false);

        if (hasNext) {
            await sleep(2500);
            pageNum++;
        }
    }

    console.log(`\n📊 全量抓取完成：共 ${allRaw.length} 条，${pageNum} 页`);

    // ===== 第三步：按人过滤 =====
    console.log('\n===== 第三步：按CSS人员过滤 =====');
    const filtered = allRaw.filter(item => {
        const atsMatch = item.atsCss && TARGET_CSS.some(t => item.atsCss.includes(t));
        const ppMatch = item.ppCss && TARGET_CSS.some(t => item.ppCss.includes(t));
        return atsMatch || ppMatch;
    });

    // 合并为统一格式
    const finalData = filtered.map(item => {
        // 判断属于哪个团队
        const isAts = TARGET_CSS.slice(0, 7).some(t => (item.atsCss || '').includes(t));
        const isPp = TARGET_CSS.slice(7).some(t => (item.ppCss || '').includes(t));
        const css = isAts ? item.atsCss : (isPp ? item.ppCss : (item.atsCss || item.ppCss || ''));
        return {
            customerName: item.customerName,
            healthScore: item.healthScore,
            css: css.trim(),
            crmUrl: item.crmUrl
        };
    });

    console.log(`✅ 过滤后：${finalData.length} 条（从 ${allRaw.length} 条中筛选）`);

    if (finalData.length === 0) {
        console.log('\n❌ 过滤后数据为空！打印前5条原始数据供排查：');
        allRaw.slice(0, 5).forEach(d => {
            console.log(`   客户：${d.customerName} | ATS CSS：[${d.atsCss}] | PP CSS：[${d.ppCss}] | 健康分：${d.healthScore}`);
        });
        console.log('\n浏览器保持打开，请检查列名是否正确，然后关闭终端结束');
        await sleep(300000);
        await browser.close();
        return;
    }

    // 按人汇总
    const summary = {};
    finalData.forEach(d => {
        const key = d.css || '未知';
        summary[key] = (summary[key] || 0) + 1;
    });
    console.log('\n📋 各人客户数：');
    Object.entries(summary).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
        console.log(`   ${name}：${count} 条`);
    });

    // 写入 JSONBin
    const snapshot = {
        week: getWeekKey(),
        timestamp: new Date().toISOString(),
        threshold: 4,
        data: finalData
    };

    console.log('\n💾 正在写入 JSONBin...');
    try {
        const binData = await loadBin();
        binData.record.snapshots = binData.record.snapshots || [];
        binData.record.snapshots.push(snapshot);
        if (binData.record.snapshots.length > 12) {
            binData.record.snapshots = binData.record.snapshots.slice(-12);
        }
        await saveBin(binData.record);
        console.log('✅ 写入成功！周次：' + snapshot.week);
        console.log('   在网页「健康分看板」点🔄刷新即可查看');
    } catch (err) {
        console.error('❌ JSONBin写入失败:', err.message);
        const localPath = path.join(__dirname, `health-snapshot-${getWeekKey()}.json`);
        fs.writeFileSync(localPath, JSON.stringify(snapshot, null, 2));
        console.log('   已保存到本地：' + localPath);
    }

    await browser.close();
    console.log('\n🎉 全部完成！');
}

main().catch(err => {
    console.error('❌ 脚本执行失败：', err);
    process.exit(1);
});
