const { webkit } = require('playwright');
const fs = require('fs');
const path = require('path');

const COOKIE_FILE = path.join(__dirname, '.cookies.json');
const JSONBIN_API = 'https://api.jsonbin.io/v3';
const JSONBIN_KEY = '$2a$10$94MoVDNRO0bakGDYcTsN3.BEiTefnDwwkXGndi1VuAZqxhKHhggby';
const HEALTH_BIN_ID = '6a089ef2adc21f119aad2ceb';
const CRM_URL = 'https://crm.xiaoshouyi.com';

// 目标CSS人员
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
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`写入Bin失败: ${res.status}`);
    return true;
}
function getWeekKey() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    return `${now.getFullYear()}-W${String(Math.ceil((now - start) / 604800000 + 1)).padStart(2,'0')}`;
}

async function main() {
    console.log('🎯 目标CSS：' + TARGET_CSS.join(','));
    console.log('   列名：PP CSS / ATS CSS / 最新健康分\n');

    const browser = await webkit.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    // cookies
    if (fs.existsSync(COOKIE_FILE)) {
        try { await context.addCookies(JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'))); console.log('✅ cookie加载成功'); } catch(e){ console.log('⚠️ cookie加载失败'); }
    }

    console.log('🚀 打开销售易...');
    await page.goto(`${CRM_URL}/index.action`, { waitUntil: 'networkidle', timeout: 60000 });

    const needLogin = await page.evaluate(() => window.location.href.includes('login') || !!document.querySelector('input[type="password"]')).catch(()=>true);
    if (needLogin) {
        console.log('🔐 请在浏览器登录...');
        try { await page.waitForFunction(() => !window.location.href.includes('login'), { timeout: 300000 }); } catch(e){}
        fs.writeFileSync(COOKIE_FILE, JSON.stringify(await context.cookies(), null, 2));
        console.log('✅ 登录状态已保存');
    } else { console.log('✅ 已登录'); }

    // 跳转客户列表
    console.log('\n📋 跳转客户列表...');
    await page.goto(`${CRM_URL}/bff/neoweb#/entityGrid/account?objectApiKey=account`);
    await sleep(6000);

    // 等数据行出现
    console.log('⏳ 等待数据加载...');
    for(let w=0; w<10; w++) {
        await sleep(2000);
        const ready = await page.evaluate(() => {
            const text = document.body.innerText;
            return text.includes('客户名称') && text.includes('PP CSS') && text.includes('最新健康分') && /\d+\.\d+/.test(text);
        }).catch(()=>false);
        if(ready) break;
        console.log(`   等待中... (${(w+1)*2}s)`);
    }
    await sleep(2000);

    // ===== 获取表头（多种方式） =====
    console.log('\n📋 识别列头...');
    const colInfo = await page.evaluate(() => {
        // 方式1：标准表头
        let headerCells = Array.from(document.querySelectorAll('thead th, [class*="header-cell"], [class*="col-header"]'));
        
        // 方式2：如果方式1没找到，找第一行的特殊元素
        if(headerCells.length < 3) {
            headerCells = Array.from(document.querySelectorAll('[class*="head"] th, [class*="title"]'));
        }
        // 方式3：找包含"序号"或"客户名称"的元素所在的行
        if(headerCells.length < 3) {
            const allEls = document.querySelectorAll('*');
            for(const el of allEls) {
                if(el.innerText === '序号' && el.offsetParent !== null) {
                    const parentRow = el.closest('tr')?.closest('thead') || el.closest('tr')?.parentElement;
                    if(parentRow) {
                        headerCells = Array.from(parentRow.children);
                    }
                    break;
                }
            }
        }

        return Array.from(headerCells).map((el,i) => ({
            idx: i,
            text: el.innerText.trim().replace(/\s+/g,' ')
        }));
    }).catch(() => []);

    console.log('   检测到的列：');
    colInfo.forEach(c => console.log(`     [${c.idx}] "${c.text}"`));

    // 定位关键列索引
    const nameIdx = colInfo.findIndex(c => c.text.includes('客户名称')) ?? -1;
    const ppCssIdx = colInfo.findIndex(c => c.text === 'PP CSS' || /^PP\s*CSS$/i.test(c.text));
    const atsCssIdx = colInfo.findIndex(c => c.text === 'ATS CSS' || /^ATS\s*CSS$/i.test(c.text));
    const healthIdx = colInfo.findIndex(c => c.text === '最新健康分' || c.text.includes('最新健康分'));

    console.log(`\n   🔍 列索引定位：`);
    console.log(`      客户名称 → [${nameIdx}]`);
    console.log(`      PP CSS   → [${ppCssIdx}]`);
    console.log(`      ATS CSS  → [${atsCssIdx}]`);
    console.log(`      最新健康分→ [${healthIdx}]`);

    if(nameIdx < 0 || healthIdx < 0) {
        console.log('\n❌ 关键列未找到！');
        console.log('请确保浏览器里客户列表显示了「客户名称」和「最新健康分」列');
        console.log('按回车继续尝试抓取（可能使用备用方案）...');
        await new Promise(resolve => process.stdin.once('data', () => resolve()));
    }

    // ===== 开始翻页抓取 =====
    console.log('\n' + '='.repeat(50));
    console.log('📊 开始逐页抓取...');
    const allRaw = [];
    let pageNum = 1;

    // 先获取总记录数
    const totalCount = await page.evaluate(() => {
        const text = document.body.innerText;
        // 匹配 "共 673 条"
        const m = text.match(/共\s*(\d+)\s*条/);
        return m ? parseInt(m[1]) : 0;
    }).catch(() => 0);
    const totalPages = Math.ceil(totalCount / 50);
    console.log(`   总计约 ${totalCount} 条，约 ${totalPages} 页\n`);

    while(pageNum <= totalPages + 5) { // 多给几页余量
        console.log(`   📄 第 ${pageNum} / ~${totalPages} 页...`);

        const pageData = await page.evaluate((colMap) => {
            const results = [];

            // 销售易的数据行选择器——尝试多种
            let dataRows = [];
            
            // 尝试1：tbody tr
            const tbodyRows = Array.from(document.querySelectorAll('tbody tr')).filter(tr => tr.querySelectorAll('td').length >= 3);
            if(tbodyRows.length > 0) dataRows = tbodyRows;

            // 尝试2：带row class的div
            if(dataRows.length === 0) {
                const divRows = Array.from(document.querySelectorAll('[class*="row"][class*="item"], [class*="list-row"]'));
                if(divRows.length > 0) dataRows = divRows;
            }

            // 尝试3：所有tr排除header
            if(dataRows.length === 0) {
                dataRows = Array.from(document.querySelectorAll('table tr')).filter(tr => {
                    return !tr.closest('thead') && tr.querySelectorAll('td').length >= 3;
                });
            }

            // 尝试4：直接从页面文本区域提取（最暴力但最稳）
            if(dataRows.length === 0) {
                // 不行了，返回空
                return [];
            }

            // 对每一行提取字段
            for(const row of dataRows) {
                try {
                    const cells = row.tagName === 'TR' 
                        ? Array.from(row.querySelectorAll('td'))
                        : Array.from(row.querySelectorAll('[class*="cell"], [class*="column"], td'));

                    if(cells.length < 3) continue;

                    const getName = (idx) => idx >= 0 && idx < cells.length ? (cells[idx]?.innerText||'').trim() : '';
                    const getNum = (idx) => idx >= 0 && idx < cells.length ? parseFloat(cells[idx]?.innerText||'0') || 0 : 0;
                    
                    const customerName = getName(colMap.nameIdx);
                    const ppCss = getName(colMap.ppCssIdx);
                    const atsCss = getName(colMap.atssCssIdx);
                    const healthScore = getNum(colMap.healthIdx);

                    // 取链接
                    let crmUrl = '';
                    const nameCell = colMap.nameIdx >= 0 ? cells[colMap.nameIdx] : null;
                    if(nameCell) {
                        const link = nameCell.querySelector('a');
                        if(link?.href) crmUrl = link.href;
                    }

                    if(customerName && customerName.length > 0 && customerName.length < 100) {
                        results.push({ customerName, healthScore, ppCss, atsCss, crmUrl });
                    }
                } catch(e) {}
            }
            return results;
        }, { nameIdx, ppCssIdx, atssCssIdx: atsCssIdx, healthIdx }).catch(e => {
            console.log(`   ⚠️ 页面解析异常: ${e.message}`);
            return [];
        });

        if(pageData.length > 0) {
            allRaw.push(...pageData);
            console.log(`      ✅ +${pageData.length} 条（累计 ${allRaw.length}）`);
        } else {
            console.log(`      ⬜ 0 条`);
            // 连续3页为空就停
            if(allRaw.length > 0) break;
        }

        // 点击下一页
        const clickedNext = await page.evaluate(() => {
            // 查找所有可能的下一页按钮
            const candidates = [...document.querySelectorAll('button, a, li, span, div')]
                .filter(el => {
                    const text = (el.innerText||'').trim();
                    const cls = (el.className||'');
                    // 匹配：下一页、>、›、next
                    if(text === '下一页' || text === '>' || text === '›' || text.toLowerCase().includes('next')) {
                        return !el.disabled 
                            && !cls.includes('disabled')
                            && !cls.includes('is-disabled')
                            && el.offsetParent !== null; // 可见
                    }
                    // 也匹配右箭头图标
                    if(cls.includes('next') || cls.includes('right')) {
                        return !el.disabled && el.offsetParent !== null;
                    }
                    return false;
                });
            
            if(candidates.length > 0) {
                candidates[0].click();
                return true;
            }
            return false;
        }).catch(() => false);

        if(!clickedNext) {
            console.log('   ⏹️ 已到达最后一页');
            break;
        }

        await sleep(3000); // 翻页后等数据加载
        pageNum++;
    }

    console.log(`\n📊 抓取完成：共 ${allRaw.length} 条原始数据`);

    if(allRaw.length === 0) {
        console.log('\n❌ 一条都没抓到。打印前3行原始HTML供排查...\n');
        const sample = await page.evaluate(() => {
            const rows = document.querySelectorAll('tbody tr');
            if(rows.length > 0) {
                return Array.from(rows).slice(0, 3).map(r => r.innerText.substring(0, 200));
            }
            // 如果没有tbody，取body部分文字
            return ['无tbody元素', 'body前200字:', document.body.innerText.substring(0, 500)];
        }).catch(() => ['无法获取']);
        sample.forEach(s => console.log('  ', s));
        console.log('\n浏览器保持打开，手动检查后关闭终端结束');
        await sleep(300000);
        await browser.close();
        return;
    }

    // ===== 过滤目标人员 =====
    console.log('\n===== 按 CSS 人员过滤 =====');
    const filtered = allRaw.filter(item => {
        const matchPp = item.ppCss && TARGET_CSS.some(t => item.ppCss.trim().includes(t));
        const matchAts = item.atsCss && TARGET_CSS.some(t => item.atsCss.trim().includes(t));
        return matchPp || matchAts;
    });

    const finalData = filtered.map(item => ({
        customerName: item.customerName,
        healthScore: item.healthScore,
        css: (item.atsCss || item.ppCss || '').trim(),
        crmUrl: item.crmUrl
    }));

    console.log(`✅ 过滤结果：${finalData.length} 条`);

    if(finalData.length === 0) {
        console.log('❌ 过滤后为空！打印原始数据的PP CSS和ATS CSS值供排查：');
        allRaw.slice(0, 10).forEach(d => {
            console.log(`  "${d.customerName}" | PP:["${d.ppCss}"] ATS:["${d.atsCss}"] 健康:${d.healthScore}`);
        });
        await sleep(10000);
    } else {
        const summary = {};
        finalData.forEach(d => { summary[d.css] = (summary[d.css]||0)+1; });
        console.log('\n📋 各人客户数：');
        Object.entries(summary).sort((a,b)=>b[1]-a[1]).forEach(([n,c]) => console.log(`   ${n}：${c}`));

        // 写入 JSONBin
        const snapshot = { week: getWeekKey(), timestamp: new Date().toISOString(), threshold: 4, data: finalData };
        console.log('\n💾 写入 JSONBin...');
        try {
            const bin = await loadBin();
            bin.record.snapshots = bin.record.snapshots || [];
            bin.record.snapshots.push(snapshot);
            if(bin.record.snapshots.length > 12) bin.record.snapshots = bin.record.snapshots.slice(-12);
            await saveBin(bin.record);
            console.log('✅ 成功！周次：'+snapshot.week+'，点网页🔄刷新查看');
        } catch(err) {
            console.error('❌ JSONBin失败:', err.message);
            const localFile = path.join(__dirname, `health-${getWeekKey()}.json`);
            fs.writeFileSync(localFile, JSON.stringify(snapshot, null, 2));
            console.log('已保存本地：'+localFile);
        }
    }

    await browser.close();
    console.log('\n🎉 完成！');
}

main().catch(err => { console.error('❌ 失败:', err); process.exit(1); });
