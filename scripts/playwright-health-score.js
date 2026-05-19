const { webkit } = require('playwright');
const fs = require('fs');
const path = require('path');

const COOKIE_FILE = path.join(__dirname, '.cookies.json');
const JSONBIN_API = 'https://api.jsonbin.io/v3';
const JSONBIN_KEY = '$2a$10$94MoVDNRO0bakGDYcTsN3.BEiTefnDwwkXGndi1VuAZqxhKHhggby';
const HEALTH_BIN_ID = '6a089ef2adc21f119aad2ceb';
const CRM_URL = 'https://crm.xiaoshouyi.com';

// ===== 只抓取这些 CSS 负责人的客户数据 =====
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
    console.log('   共 ' + TARGET_CSS.length + ' 人，只抓取这些人的客户健康分\n');

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
            console.log('⚠️  加载 cookies 失败，将重新登录:', e.message);
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
        console.log('🔐 需要登录，请在浏览器中手动完成登录（含2FA/验证码）...');
        console.log('   登录成功后脚本将自动继续');
        try {
            await page.waitForFunction(
                () => !window.location.href.includes('login'),
                { timeout: 300000 }
            );
            console.log('✅ 登录检测成功！');
        } catch (e) {
            console.log('⚠️  登录等待超时，尝试继续...');
        }
        const cookies = await context.cookies();
        fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
        console.log('✅ 登录状态已保存');
    } else {
        console.log('✅ 使用已保存的登录状态');
    }

    // ===== 逐人抓取 =====
    const allData = [];
    let totalFound = 0;
    let totalNotFound = 0;

    for (const cssName of TARGET_CSS) {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`🔍 正在抓取 [${cssName}] 的客户数据...`);

        // 跳转到客户列表页，通过URL参数设置筛选条件
        // 销售易支持通过URL filter 参数筛选
        const filterUrl = `${CRM_URL}/bff/neoweb#/entityGrid/account?objectApiKey=account`;
        await page.goto(filterUrl);
        await sleep(4000);

        // 等待列表加载
        try {
            await page.waitForSelector('table, [class*="grid"], [class*="table"], [class*="list"]', { timeout: 20000 });
        } catch (e) {
            console.log(`   ⚠️ 列表加载慢，等待中...`);
            await sleep(5000);
        }
        await sleep(2000);

        // ===== 在页面内设置筛选条件 =====
        // 方案：通过销售易的筛选功能搜索负责人
        console.log(`   📌 正在设置筛选条件：负责人 = ${cssName}`);

        const filterSuccess = await page.evaluate((name) => {
            // 查找筛选区域的搜索框或筛选按钮
            // 销售易的筛选入口通常是顶部工具栏的筛选图标
            const filterBtns = document.querySelectorAll('[class*="filter"], [class*="search"], [title*="筛选"], [title*="搜索"], [aria-label*="筛选"]');
            
            // 尝试找高级筛选入口
            for (const btn of filterBtns) {
                const text = btn.innerText || btn.title || btn.getAttribute('aria-label') || '';
                if (text.includes('筛选') || text.includes('高级')) {
                    btn.click();
                    return 'clicked_filter';
                }
            }

            // 尝试直接找搜索框输入
            const searchInputs = document.querySelectorAll('input[type="text"], input[placeholder], [class*="search"] input');
            for (const input of searchInputs) {
                const placeholder = input.placeholder || input.getAttribute('placeholder') || '';
                if (placeholder.includes('搜索') || placeholder.includes('查询') || placeholder.includes('客户')) {
                    input.value = name;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    // 触发回车
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                    return 'searched';
                }
            }
            
            return 'not_found';
        }, cssName).catch(() => 'error');

        if (filterSuccess === 'clicked_filter') {
            console.log(`   ✅ 已打开筛选面板，等待输入...`);
            await sleep(2000);

            // 在筛选面板中填写条件
            const panelFilled = await page.evaluate((name) => {
                // 查找筛选面板内的输入框
                const inputs = document.querySelectorAll('[class*="filter"] input, [class*="dialog"] input, [class*="modal"] input, [class*="popover"] input, [class*="drawer"] input');
                
                // 找"负责人"相关的行
                const allLabels = document.querySelectorAll('[class*="filter"] label, [class*="filter"] span, [class*="dialog"] label, [class*="modal"] label');
                for (const label of allLabels) {
                    if (label.innerText.includes('负责人') || label.innerText.includes('CSS') || label.innerText.includes('负责')) {
                        // 找同一行/同组的输入框
                        const container = label.closest('tr') || label.closest('[class*="row"]') || label.closest('[class*="item"]') || label.parentElement?.parentElement;
                        if (container) {
                            const input = container.querySelector('input');
                            if (input) {
                                input.click();
                                input.value = name;
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                return true;
                            }
                        }
                    }
                }

                // 如果找不到标签，尝试第一个可编辑输入框
                for (const input of inputs) {
                    if (!input.readOnly && !input.disabled && input.offsetParent !== null) {
                        input.click();
                        input.value = name;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        return true;
                    }
                }
                return false;
            }, cssName).catch(() => false);

            if (panelFilled) {
                console.log(`   ✅ 已在筛选面板输入「${cssName}」`);
                await sleep(1000);

                // 查找并点击「确定/查询」按钮
                await page.evaluate(() => {
                    const btns = document.querySelectorAll('button, [class*="btn"]');
                    for (const btn of btns) {
                        const text = btn.innerText.trim();
                        if (text === '确定' || text === '查询' || text === '搜索' || text === '筛选' || text.includes('确认')) {
                            btn.click();
                            return;
                        }
                    }
                }).catch(() => {});
                await sleep(4000);
            } else {
                console.log(`   ⚠️ 未找到筛选输入框，将抓取全量数据后按人过滤`);
            }
        } else if (filterSuccess === 'searched') {
            console.log(`   ✅ 已通过搜索框输入「${cssName}」`);
            await sleep(4000);
        } else {
            console.log(`   ⚠️ 未找到筛选入口，将抓取全量数据后按人过滤`);
        }

        // ===== 检查列 =====
        const hasHealthCol = await page.evaluate(() => {
            return document.body.innerText.includes('健康分');
        }).catch(() => false);

        const hasCssCol = await page.evaluate(() => {
            const text = document.body.innerText;
            return text.includes('负责人') || text.includes('CSS');
        }).catch(() => false);

        if (!hasHealthCol) {
            console.log(`   ⚠️ 未检测到「健康分」列`);
            console.log(`   请在浏览器中手动添加该列，然后按回车继续...`);
            await new Promise(resolve => {
                process.stdin.once('data', () => resolve());
            });
        }

        if (!hasCssCol) {
            console.log(`   ⚠️ 未检测到「负责人/CSS」列`);
            console.log(`   请在浏览器中手动添加该列，然后按回车继续...`);
            await new Promise(resolve => {
                process.stdin.once('data', () => resolve());
            });
        }

        // ===== 抓取该筛选结果的所有页面 =====
        const personData = [];
        let pageNum = 1;
        let hasNext = true;
        let emptyPages = 0;

        while (hasNext && pageNum <= 30 && emptyPages < 2) {
            console.log(`   📄 第 ${pageNum} 页...`);

            const pageData = await page.evaluate((targetName) => {
                const results = [];

                // 获取表头
                const headerCells = document.querySelectorAll('thead th, [class*="header-cell"], [class*="col-header"]');
                const headers = Array.from(headerCells).map(h => h.innerText.trim());
                
                const nameIdx = headers.findIndex(h => h.includes('客户') || h.includes('名称'));
                const healthIdx = headers.findIndex(h => h.includes('健康分'));
                const cssIdx = headers.findIndex(h => h.includes('负责人') || h === 'CSS' || h.includes('CSS'));
                
                // 如果没找到CSS列，尝试更多匹配
                let cssColIdx = cssIdx;
                if (cssColIdx < 0) {
                    cssColIdx = headers.findIndex(h => h.includes('负责') || h.includes('Owner') || h.includes('所属'));
                }

                const dataRows = Array.from(document.querySelectorAll('tbody tr')).filter(tr => {
                    const cells = tr.querySelectorAll('td');
                    return cells.length >= 2;
                });

                dataRows.forEach(row => {
                    try {
                        const cells = row.querySelectorAll('td');
                        const name = nameIdx >= 0 ? (cells[nameIdx] || {}).innerText || '' : '';
                        const healthScore = healthIdx >= 0 ? parseFloat((cells[healthIdx] || {}).innerText) || 0 : 0;
                        const css = cssColIdx >= 0 ? ((cells[cssColIdx] || {}).innerText || '').trim() : '';

                        let crmUrl = '';
                        const nameCell = nameIdx >= 0 ? cells[nameIdx] : null;
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
                return { results, nameIdx, healthIdx, cssColIdx, headers };
            }, cssName).catch(e => { console.log('   页面解析出错:', e.message); return { results: [] }; });

            if (pageData.results.length > 0) {
                personData.push(...pageData.results);
                emptyPages = 0;
                console.log(`      ✅ ${pageData.results.length} 条`);
            } else {
                emptyPages++;
                console.log(`      ⬜ 0 条`);
            }

            // 下一页
            hasNext = await page.evaluate(() => {
                // 销售易分页按钮
                const btns = document.querySelectorAll('button, [class*="pager"] a, [class*="pagination"] li, [class*="page-btn"]');
                for (const btn of btns) {
                    const text = (btn.innerText || '').trim();
                    if ((text === '下一页' || text === '>' || text.includes('next')) && !btn.disabled && !btn.classList.contains('disabled') && !btn.classList.contains('is-disabled')) {
                        btn.click();
                        return true;
                    }
                }
                // 尝试 SVG 图标类的下一页按钮
                const nextIcons = document.querySelectorAll('[class*="next"], [class*="right"]');
                for (const el of nextIcons) {
                    if (el.offsetParent !== null && !el.disabled && !el.classList.contains('disabled')) {
                        el.click();
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

        // ===== 按人过滤（双保险） =====
        const filtered = personData.filter(item => {
            // 如果页面已有筛选，大部分数据应该已经是对的了
            // 但为了准确性，还是做一次二次过滤
            const cssMatch = item.css.includes(cssName) || 
                             (!item.css && item.customerName); // 没有CSS列时保留所有
            return cssMatch;
        });

        if (filtered.length > 0) {
            console.log(`   ✅ [${cssName}]：匹配 ${filtered.length} 条客户数据`);
            allData.push(...filtered);
            totalFound += filtered.length;
        } else if (personData.length > 0) {
            // 如果精确匹配不到，但抓到了数据，说明CSS列可能没匹配上
            // 检查 personData 中的 css 字段
            const cssValues = [...new Set(personData.map(d => d.css).filter(Boolean))];
            console.log(`   ⚠️ [${cssName}]：抓到 ${personData.length} 条但未精确匹配`);
            console.log(`      页面中的CSS字段值：${cssValues.slice(0, 5).join(', ')}`);
            console.log(`      保留全部 ${personData.length} 条（可能在筛选页面已过滤）`);
            allData.push(...personData);
            totalFound += personData.length;
        } else {
            console.log(`   ❌ [${cssName}]：未抓取到数据`);
            totalNotFound++;
        }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`📊 抓取完成！共 ${allData.length} 条客户数据（${TARGET_CSS.length - totalNotFound}/${TARGET_CSS.length} 人有数据）`);

    if (allData.length === 0) {
        console.log('❌ 未抓取到任何数据，浏览器将保持打开以便排查');
        await sleep(300000);
        await browser.close();
        return;
    }

    // 打印摘要
    const summary = {};
    allData.forEach(d => {
        const key = d.css || '未知';
        summary[key] = (summary[key] || 0) + 1;
    });
    console.log('\n📋 各人数据量：');
    Object.entries(summary).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
        console.log(`   ${name}：${count} 条`);
    });

    // 构建快照
    const snapshot = {
        week: getWeekKey(),
        timestamp: new Date().toISOString(),
        threshold: 4,
        data: allData
    };

    // 写入 JSONBin
    console.log('\n💾 正在写入 JSONBin...');
    try {
        const binData = await loadBin();
        binData.record.snapshots = binData.record.snapshots || [];
        binData.record.snapshots.push(snapshot);

        if (binData.record.snapshots.length > 12) {
            binData.record.snapshots = binData.record.snapshots.slice(-12);
        }

        await saveBin(binData.record);
        console.log('✅ 数据已写入 JSONBin！快照周次：', snapshot.week);
        console.log('   在网页「健康分看板」点🔄刷新即可看到数据');
    } catch (err) {
        console.error('❌ 写入 JSONBin 失败：', err.message);
        console.log('   数据已保存在本地，可手动导入');
        fs.writeFileSync(path.join(__dirname, 'health-snapshot-' + getWeekKey() + '.json'), JSON.stringify(snapshot, null, 2));
        console.log('   本地文件：' + path.join(__dirname, 'health-snapshot-' + getWeekKey() + '.json'));
    }

    await browser.close();
    console.log('\n🎉 全部完成！');
}

main().catch(err => {
    console.error('❌ 脚本执行失败：', err);
    process.exit(1);
});
