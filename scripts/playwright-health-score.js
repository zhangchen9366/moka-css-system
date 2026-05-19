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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function loadBin() {
    const res = await fetch(`${JSONBIN_API}/b/${HEALTH_BIN_ID}/latest`, { headers: { 'X-Master-Key': JSONBIN_KEY } });
    if (!res.ok) throw new Error(`读取Bin失败: ${res.status}`);
    return await res.json();
}
async function saveBin(data) {
    const res = await fetch(`${JSONBIN_API}/b/${HEALTH_BIN_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
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
    
    // 等待数据出现（轮询检测）
    console.log('⏳ 等待数据加载...');
    for(let w=0; w<15; w++) {
        await sleep(2000);
        const ready = await page.evaluate(() => {
            const t = document.body.innerText;
            return t.includes('客户名称') && t.includes('PP CSS') && t.includes('最新健康分') && /\d+\.\d+/.test(t);
        }).catch(()=>false);
        if(ready) { console.log('   ✅ 数据已加载'); break; }
        console.log(`   ...等待中 (${(w+1)*2}s)`);
    }
    await sleep(2000);

    // ===== 核心：用多种策略提取数据 =====
    // 策略A：尝试找到数据行容器并提取
    // 策略B：如果A失败，直接dump HTML分析结构

    console.log('\n🔍 分析页面DOM结构...');

    // 先dump一下列表区域的HTML结构
    const domAnalysis = await page.evaluate(() => {
        // 找包含"杭州拼吖"或"全部客户"的区域
        const allDivs = document.querySelectorAll('[class*="grid"], [class*="list"], [class*="table"], [class*="body"], [class*="content"], [class*="row"]');
        
        const results = [];
        for(const div of allDivs) {
            const childCount = div.children.length;
            const tag = div.tagName;
            const cls = div.className?.substring(0,80) || '';
            const hasData = /\d+\.\d{2}|PP\s*CSS|ATS\s*CSS/.test(div.innerText);
            
            if(hasData && childCount > 2) {
                results.push({
                    tag,
                    cls: cls.replace(/\s+/g,' ').substring(0,100),
                    childCount,
                    textPreview: div.innerText.substring(0, 150).replace(/\s+/g,' ')
                });
            }
        }
        return results.slice(0, 10);
    }).catch(() => []);

    if(domAnalysis.length > 0) {
        console.log('   📦 找到可能的数据容器：');
        domAnalysis.forEach(d => {
            console.log(`      <${d.tag}> class="${d.cls}" children=${d.childCount}`);
            console.log(`         文本: "${d.textPreview}"`);
        });
    } else {
        console.log('   ⚠️ 未通过class匹配到容器，尝试其他方式...');
    }

    // ===== 抓取数据：核心函数 =====
    console.log('\n📊 开始抓取...');

    const allRaw = [];

    // 获取总页数
    const pageInfo = await page.evaluate(() => {
        const t = document.body.innerText;
        const m = t.match(/共\s*(\d+)\s*条/);
        const p = t.match(/(\d+)\s*页/);
        return { total: m ? parseInt(m[1]) : 0 };
    }).catch(() => ({ total: 0 }));
    const totalPages = Math.ceil(pageInfo.total / 50) || 14;
    console.log(`   总计约 ${pageInfo.total} 条，${totalPages} 页\n`);

    let pageNum = 1;

    while(pageNum <= totalPages + 3) {
        console.log(`   📄 第 ${pageNum} 页...`);

        const pageData = await page.extractDataFromPage().catch(() => null);

        if(!pageData) {
            // 使用 evaluate 提取 —— 核心策略：遍历所有可能的行元素
            const extracted = await page.evaluate(() => {
                const results = [];

                // === 策略1：找所有看起来像行的元素 ===
                // 销售易的每行数据通常是一个包含多个子元素的容器
                // 每行有：序号、客户名称、M、PP CSS、ATS CSS、最新健康分、...
                
                // 方法：找所有包含数字序号(1,2,3...)且长度较短的文本块
                // 这些就是数据行
                
                // 更直接的方法：找整个表格区域，获取它的innerHTML然后解析
                const bodyText = document.body.innerText;
                
                // 找"全部客户"之后、"创建日期"附近开始的数据区域
                // 数据格式大概是：
                // 1  杭州拼吖信息科技有限公司  ... 黄文鑫  5.09  张云芳  已签约
                // 2  江苏月半湖生物科技...  ...
                
                // 尝试通过DOM结构提取
                // 销售易 neoweb 的表格通常在某个特定的容器内
                const possibleContainers = [
                    document.querySelector('[class*="virtual-list"]'),
                    document.querySelector('[class*="scroll"]'),
                    document.querySelector('[class*="body-wrapper"]'),
                    document.querySelector('[class*="table-body"]'),
                    document.querySelector('[class*="grid-body"]'),
                    document.querySelector('[class*="entity-grid"]'),
                ].filter(Boolean);

                // 如果找到了容器
                for(const container of possibleContainers) {
                    // 在容器内找所有子项（行）
                    const items = container.querySelectorAll(':scope > *, :scope > * > *, [class*="row"], [class*="item"]');
                    
                    for(const item of items) {
                        const txt = item.innerText || '';
                        // 数据行的特征：包含公司名（通常较长）和数字
                        if(txt.length > 20 && txt.length < 300 && /\d/.test(txt)) {
                            // 进一步验证是否是数据行
                            if(/有限公司|集团|公司|科技|股份|生物|汽车|网络|电子/.test(txt)) {
                                results.push({ rawText: txt.trim(), html: item.innerHTML.substring(0, 500) });
                                break; // 一个item就够了，避免重复
                            }
                        }
                    }
                    if(results.length > 0) break; // 找到一个容器的数据就够
                }

                // === 策略2：如果上面没找到，暴力扫描所有可见元素 ===
                if(results.length === 0) {
                    const allElements = document.querySelectorAll('*');
                    for(const el of allElements) {
                        // 只看有足够子元素的（可能是行）
                        if(el.children.length >= 5 && el.children.length <= 15 && el.offsetParent !== null) {
                            const txt = (el.innerText||'').trim();
                            if(txt.length > 30 && txt.length < 400 && /有限公司|集团|公司|科技|股份/.test(txt) && /\d\.\d+/.test(txt)) {
                                results.push({ rawText: txt, html: el.innerHTML.substring(0, 800), strategy: 'brute_force' });
                                break;
                            }
                        }
                    }
                }

                return results;
            }).catch(e => ({ error: e.message }));

            if(extracted.error) {
                console.log(`      ⚠️ 解析异常: ${extracted.error}`);
            } else if(extracted.length > 0) {
                // 解析原始文本为结构化数据
                for(const item of extracted) {
                    // 原始文本大概长这样：
                    // "1 杭州拼吖信息科技有限公司  $  邵顺  黄文鑫  5.09  张云芳  已签约"
                    const parsed = parseRowText(item.rawText);
                    if(parsed) allRaw.push(parsed);
                }
                
                console.log(`      ✅ 提取 ${extracted.length} 条（累计 ${allRaw.length}）`);
            } else {
                console.log(`      ⬜ 本页未提取到数据`);
            }
        } else {
            allRaw.push(...pageData);
            console.log(`      ✅ +${pageData.length}（累计 ${allRaw.length}）`);
        }

        // 下一页
        const hasNext = await page.evaluate(() => {
            const els = [...document.querySelectorAll('*')].filter(el => {
                const t = (el.innerText||'').trim();
                const c = el.className||'';
                const isNext = t==='下一页'||t==='>'||t==='›'||t.toLowerCase()==='next';
                const isVisible = el.offsetParent !== null;
                const isEnabled = !el.disabled && !/(disabled|is-disabled)/.test(c);
                return isNext && isVisible && isEnabled && el.children.length === 0; // 叶子节点按钮
            });
            if(els.length > 0) { els[0].click(); return true; }
            return false;
        }).catch(() => false);

        if(!hasNext) { 
            console.log('   ⏹️ 到达末页'); 
            if(allRaw.length > 0) break;
        }
        
        await sleep(2500);
        pageNum++;
    }

    console.log(`\n📊 原始抓取：${allRaw.length} 条`);

    if(allRaw.length === 0) {
        console.log('\n❌ 仍然没抓到！执行完整DOM诊断...');
        
        const diag = await page.evaluate(() => {
            // 打印更详细的HTML结构
            // 找到包含"全部客户"或"序号"的最近父级
            const target = Array.from(document.querySelectorAll('*')).find(el => 
                el.innerText?.includes('全部客户') && el.children?.length > 5
            );
            
            if(target) {
                return {
                    found: true,
                    tagName: target.tagName,
                    className: target.className?.substring(0, 150),
                    childCount: target.children.length,
                    outerHTML: target.outerHTML.substring(0, 3000),
                    innerHTML: target.innerHTML.substring(0, 3000)
                };
            }
            return { found: false, bodySnippet: document.body.innerHTML.substring(0, 5000) };
        }).catch(() => ({ error: 'evaluate failed' }));

        console.log('\n===== DOM诊断结果 =====');
        if(diag.found) {
            console.log(`标签：<${diag.tagName}>`);
            console.log(`类名：${diag.className}`);
            console.log(`子元素数：${diag.childCount}`);
            console.log(`\n--- 外层HTML前3000字符 ---\n${diag.outerHTML}`);
        } else if(diag.bodySnippet) {
            console.log(`\n--- body前5000字符 ---\n${diag.bodySnippet}`);
        } else {
            console.log(JSON.stringify(diag));
        }

        // 保存诊断结果到文件
        const diagFile = path.join(__dirname, 'dom-diagnosis.json');
        fs.writeFileSync(diagFile, JSON.stringify(diag, null, 2));
        console.log(`\n💾 诊断结果已保存到：${diagFile}`);

        console.log('\n浏览器保持打开。请将终端输出截图发给我。');
        await sleep(600000);
        await browser.close();
        return;
    }

    // ===== 过滤目标人员 =====
    console.log('\n===== 过滤 =====');
    const filtered = allRaw.filter(item => {
        const ppMatch = TARGET_CSS.some(t => (item.ppCss||'').includes(t));
        const atsMatch = TARGET_CSS.some(t => (item.atsCss||'').includes(t));
        return ppMatch || atsMatch;
    });

    const finalData = filtered.map(d => ({
        customerName: d.customerName,
        healthScore: d.healthScore,
        css: ((d.atsCss || d.ppCss || '')+'').trim(),
        crmUrl: d.crmUrl || ''
    }));

    console.log(`✅ 过滤后：${finalData.length} 条`);
    if(finalData.length > 0) {
        const summary = {};
        finalData.forEach(d => { summary[d.css] = (summary[d.css]||0)+1; });
        Object.entries(summary).sort((a,b)=>b[1]-a[1]).forEach(([n,c]) => console.log(`   ${n}：${c}`));

        const snapshot = { week: getWeekKey(), timestamp: new Date().toISOString(), threshold: 4, data: finalData };
        console.log('\n💾 写入 JSONBin...');
        try {
            const bin = await loadBin();
            bin.record.snapshots = bin.record.snapshots || [];
            bin.record.snapshots.push(snapshot);
            if(bin.record.snapshots.length > 12) bin.record.snapshots = bin.record.snapshots.slice(-12);
            await saveBin(bin.record);
            console.log('✅ 成功！周次：'+snapshot.week+' → 点网页🔄刷新查看');
        } catch(err) {
            console.error('❌ 失败:', err.message);
            fs.writeFileSync(path.join(__dirname, `health-${getWeekKey()}.json`), JSON.stringify(snapshot,null,2));
        }
    }

    await browser.close();
    console.log('\n🎉 完成！');
}

// ===== 从一行原始文本解析出字段 =====
function parseRowText(text) {
    // 清理多余空白
    const cleaned = text.replace(/\t/g, ' ').replace(/  +/g, ' ').trim();
    
    // 尝试按已知列顺序解析
    // 列：序号 | 客户名称 | M(图标?) | PP CSS | ATS CSS | 最新健康分 | 客户所有人 | 状态
    
    // 策略：找数字健康分数（如 5.09, 2.50），它前面应该是CSS人名，再前面是客户名称
    const healthMatch = cleaned.match(/(\d+\.\d+)/);
    if(!healthMatch) return null;
    
    const healthScore = parseFloat(healthMatch[1]);
    
    // 以健康分为锚点向前向后切分
    const parts = cleaned.split(/\s+/);
    
    let customerName = '';
    let ppCss = '', atsCss = '';
    let crmUrl = '';

    // 找健康分的位置
    const healthIdx = parts.findIndex(p => /^\d+\.\d+$/.test(p));
    if(healthIdx < 2) return null; // 至少要有前面的字段

    // 健康分后面的是：客户所有人、状态
    // 健康分前面紧邻的是：ATS CSS、PP CSS、客户名称
    
    // 从后往前推：
    // parts[healthIdx] = 健康分
    // parts[healthIdx-1] 可能是 ATS CSS 人名
    // parts[healthIdx-2] 可能是 PP CSS 人名
    // 再往前是客户名称等

    // 尝试识别模式：名字通常是中文2-4字
    const isChineseName = s => /^[\u4e00-\u9fa5]{2,4}$/.test(s);

    // 从健康分位置往前找两个中文名作为CSS
    const candidatesBefore = [];
    for(let i = healthIdx - 1; i >= Math.max(0, healthIdx - 5); i--) {
        if(isChineseName(parts[i])) candidatesBefore.push({ name: parts[i], idx: i });
    }

    if(candidatesBefore.length >= 2) {
        atsCss = candidatesBefore[0].name;  // 离健康分最近的第一个
        ppCss = candidatesBefore[1].name;  // 第二个
        
        // 客户名称是从开头到ppCss之前的部分
        const nameEndIdx = candidatesBefore[1].idx;
        customerName = parts.slice(1, nameEndIdx).join(' '); // 跳过开头的序号
    } else if(candidatesBefore.length === 1) {
        // 只找到一个CSS名
        atsCss = candidatesBefore[0].name;
        customerName = parts.slice(1, candidatesBefore[0].idx).join(' ');
    } else {
        // 找不到中文CSS名，把健康分前的都当客户名
        customerName = parts.slice(1, healthIdx).join(' ');
    }

    if(customerName.length < 2 || customerName.length > 100) return null;
    
    return { customerName: customerName.trim(), healthScore, ppCss, atsCss, crmUrl };
}

main().catch(err => { console.error('❌ 失败:', err); process.exit(1); });
