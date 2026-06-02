const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const COOKIE_FILE = path.join(__dirname, '.cookies.json');
const CRM_URL = 'https://crm.xiaoshouyi.com';

// COS 配置（从环境变量读取，部署时由 .cos.conf 注入）
const COS_CONFIG = {
    SecretId: process.env.COS_SECRET_ID || '',
    SecretKey: process.env.COS_SECRET_KEY || '',
    Bucket: process.env.COS_BUCKET || 'moka-css-system-1428834627',
    Region: process.env.COS_REGION || 'ap-chengdu',
};
const HEALTH_FILE_KEY = 'sync/health-scores.json';

const TARGET_CSS = ['张辰','宋明亮','娄洋','王俊朋','曾瑞锋','徐琪','李晓丽','金梅','王亚淼','周旺'];
const DIAG_DIR = path.join(__dirname, 'diag');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getWeekKey() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    return `${now.getFullYear()}-W${String(Math.ceil((now - start) / 604800000 + 1)).padStart(2,'0')}`;
}

// ========== COS REST API 封装 ==========

function cosSign(method, key, headers) {
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
        headers['Authorization'] = cosSign(method, key, headers);

        const req = https.request({
            hostname: host, path: `/${key}`, method, headers,
            timeout: 30000
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(data ? JSON.parse(data) : null); }
                    catch(e) { resolve(null); }
                } else {
                    reject(new Error(`COS ${method} ${key} -> ${res.statusCode}: ${data.slice(0,200)}`));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
        if (body) req.write(body);
        req.end();
    });
}

async function cosGet(key) {
    try { return await cosRequest('GET', key); }
    catch(e) { console.error(`   ⚠️ COS读取失败: ${e.message}`); return null; }
}

async function cosPut(key, data) {
    try { await cosRequest('PUT', key, JSON.stringify(data)); return true; }
    catch(e) { console.error(`   ⚠️ COS写入失败: ${e.message}`); return false; }
}

function saveDiag(filename, content) {
    if (!fs.existsSync(DIAG_DIR)) fs.mkdirSync(DIAG_DIR, { recursive: true });
    fs.writeFileSync(path.join(DIAG_DIR, filename), content);
    console.log(`   💾 诊断: ${DIAG_DIR}/${filename}`);
}

// ========== 主流程 ==========
async function main() {
    console.log('╔═══════════════════════════════════════════╗');
    console.log('║  销售易健康分抓取 v6 (坐标对齐法)          ║');
    console.log('╚═══════════════════════════════════════════╝');
    console.log('🎯 目标CSS: ' + TARGET_CSS.join(', '));

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();

    if (fs.existsSync(COOKIE_FILE)) {
        try { await context.addCookies(JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'))); console.log('✅ Cookie已加载'); } catch(e) {}
    }

    console.log('\n🚀 打开销售易...');
    await page.goto(`${CRM_URL}/index.action`, { waitUntil: 'networkidle', timeout: 60000 });

    const needLogin = await page.evaluate(() =>
        window.location.href.includes('login') || !!document.querySelector('input[type="password"]')
    ).catch(() => true);

    if (needLogin) {
        console.log('🔐 请在浏览器中登录...');
        try { await page.waitForFunction(() => !window.location.href.includes('login'), { timeout: 300000 }); } catch(e) {}
        fs.writeFileSync(COOKIE_FILE, JSON.stringify(await context.cookies(), null, 2));
        console.log('✅ 登录状态已保存');
    } else {
        console.log('✅ 已登录');
    }

    console.log('\n📋 跳转客户列表...');
    await page.goto(`${CRM_URL}/bff/neoweb#/entityGrid/account?objectApiKey=account`, { waitUntil: 'networkidle', timeout: 60000 });

    console.log('⏳ 等待数据加载...');
    for (let w = 0; w < 30; w++) {
        await sleep(2000);
        const ready = await page.evaluate(() => {
            const t = document.body.innerText;
            return t.includes('客户名称') && t.includes('最新健康分') && /\d+\.\d+/.test(t);
        }).catch(() => false);
        if (ready) { console.log('   ✅ 数据已加载'); break; }
        if (w % 3 === 2) console.log(`   ...等待中 (${(w+1)*2}s)`);
    }
    await sleep(3000);

    // 关闭弹窗
    console.log('\n🪟 关闭弹窗...');
    await page.keyboard.press('Escape');
    await sleep(1000);
    await page.click('text=客户名称', { timeout: 5000 }).catch(() => {});
    await sleep(800);
    await page.screenshot({ path: path.join(DIAG_DIR, '02-after-close.png'), fullPage: false }).catch(() => {});
    console.log('   ✅ 弹窗处理完成');

    let allRecords = [];
    const maxPages = 44;

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        console.log(`\n📄 第 ${pageNum}/${maxPages} 页...`);

        const pageData = await page.evaluate(() => {
            const results = [];
            const seenKeys = new Set();

            // 收集两类元素：所有元素（用于匹配健康分/公司名）和叶子节点（用于匹配人名）
            const allEls = [];
            const leafEls = [];
            for (const el of document.querySelectorAll('*')) {
                const text = el.innerText?.trim() || el.textContent?.trim();
                if (!text) continue;
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0 && rect.top > 100 && rect.top < window.innerHeight) {
                    const item = { text, top: rect.top, left: rect.left, el };
                    allEls.push(item);
                    if (el.children.length === 0) leafEls.push(item);
                }
            }

            // 找到所有健康分 (X.XX 格式) — 用innerText匹配避免叶子节点限制
            const scores = [];
            const seenScores = new Set();
            for (const x of allEls) {
                if (/^\d+\.\d{1,2}$/.test(x.text) && parseFloat(x.text) <= 10) {
                    const key = x.text + '|' + Math.round(x.top);
                    if (!seenScores.has(key)) {
                        seenScores.add(key);
                        scores.push(x);
                    }
                }
            }

            // 找到所有可能的公司名（含关键词）
            const companyPattern = /有限公司|集团|公司|科技|股份|生物|网络|电子|咨询|商贸/;
            const companies = [];
            const seenCompanies = new Set();
            for (const x of allEls) {
                if (companyPattern.test(x.text) && x.text.length > 5 && x.text.length < 60) {
                    const key = x.text + '|' + Math.round(x.top);
                    if (!seenCompanies.has(key)) {
                        seenCompanies.add(key);
                        companies.push(x);
                    }
                }
            }

            // 找所有中文人名（2-4字）
            const nonNames = new Set([
                '集团','有限','科技','股份','网络','电子','信息','咨询','商贸','商务',
                '服务','软件','平台','数据','智能','管理','文化','传媒','教育','医疗',
                '健康','环保','能源','建筑','房地产','金融','保险','证券','银行','基金',
                '投资','贸易','物流','运输','旅游','酒店','餐饮','食品','农业','工业',
                '制造','生产','工程','设计','装饰','广告','公关','法律','会计','审计',
                '税务','人力','资源','招聘','培训','顾问','策划','营销','销售','客服',
                '售后','运营','维护','技术','研发','开发','测试','产品','项目','质量',
                '安全','环境','卫生','消防','物业','租赁','仓储','配送','供应链','采购',
                '加工','包装','印刷','出版','影视','娱乐','体育','艺术','收藏','拍卖',
                '典当','担保','评估','检测','认证','检验','检疫','报关','报检','货运',
                '代理','经纪','中介','交易所','中心','基地','园区','大厦','广场','小区',
                '社区','街道','乡镇','县城','市区','省会','地区','区域','片区','商圈',
                '市场','商场','超市','便利店','专卖店','连锁店','加盟店','直营店','旗舰店',
                '展示厅','展览馆','博物馆','图书馆','档案馆','纪念馆','美术馆','音乐厅',
                '剧院','影院','体育馆','游泳馆','健身房','茶馆','咖啡厅','酒吧','网吧',
                '游乐园','动物园','植物园','公园','景区','景点','度假村','农家乐','民宿',
                '客栈','宾馆','旅馆','招待所','宿舍','写字楼','办公楼','厂房','车间',
                '仓库','车库','停车场','加油站','充电站','维修站','服务站','检测站',
                '收费站','检查站','值班室','监控室','调度室','指挥中心','控制中心',
                '服务中心','客服中心','营销中心','展示中心','体验中心','测试中心',
                '研发中心','创新中心','创业中心','网站','网页','小程序','公众号',
                '直播间','短视频','自媒体','新媒体','门户网站','搜索引擎','电商平台'
            ]);
            const isChineseName = s => /^[\u4e00-\u9fa5]{2,4}$/.test(s) && !nonNames.has(s);

            // 坐标匹配：按Y坐标分组（同一行的top值相近，容差15px）
            const tolerance = 15;

            for (const sc of scores) {
                const score = parseFloat(sc.text);

                // 找同一行的公司名（top值最接近的）
                let matchedCompany = null;
                let minDiff = Infinity;
                for (const comp of companies) {
                    const diff = Math.abs(comp.top - sc.top);
                    if (diff < minDiff && diff <= tolerance) {
                        minDiff = diff;
                        matchedCompany = comp;
                    }
                }

                if (!matchedCompany) continue;

                // 找同行所有人名（只用叶子节点，避免祖先元素包含多列文本）
                // 排除侧边栏等干扰：X坐标>300且不是菜单项
                const menuWords = new Set(['常用','首页','客户','CRM','销售','报表','统计','分析','设置','帮助','搜索','菜单','我的','消息','通知','退出']);
                const rowNames = [];
                const seenRowNames = new Set();
                for (const el of leafEls) {
                    if (el.left > 300 && !menuWords.has(el.text) &&
                        Math.abs(el.top - sc.top) <= tolerance && isChineseName(el.text)) {
                        const key = el.text + '|' + Math.round(el.left);
                        if (!seenRowNames.has(key)) {
                            seenRowNames.add(key);
                            rowNames.push({ text: el.text, left: el.left });
                        }
                    }
                }
                // 按left排序
                rowNames.sort((a, b) => a.left - b.left);

                // 解析：根据位置判断
                // 公司名在最左，然后是级别、CSM、PP CSS、ATS CSS、健康分、所有人、状态
                const companyName = matchedCompany.text;

                // CSS人员 = 健康分前面的两个人名
                const namesBeforeScore = rowNames.filter(n => n.left < sc.left);
                let atsCss = '', ppCss = '';
                if (namesBeforeScore.length >= 2) {
                    // 最靠近健康分的两个人名
                    const closeNames = namesBeforeScore.slice(-2);
                    atsCss = closeNames[1]?.text || '';
                    ppCss = closeNames[0]?.text || '';
                } else if (namesBeforeScore.length === 1) {
                    atsCss = namesBeforeScore[0].text;
                }

                // 所有人 = 健康分后面第一个人名
                const namesAfterScore = rowNames.filter(n => n.left > sc.left);
                const owner = namesAfterScore[0]?.text || '';

                // 状态 = 找健康分后面的状态关键词（也用叶子节点更精确）
                const statusWords = ['已签约','未签约','已开通','已关闭','已归档','草稿','跟进中','已完结','签约','新商机','续约','流失','已退订','已终止','暂停','在约','已领取'];
                let status = '';
                for (const el of leafEls) {
                    if (Math.abs(el.top - sc.top) <= tolerance && el.left > sc.left) {
                        if (statusWords.some(w => el.text.includes(w))) {
                            status = el.text;
                            break;
                        }
                    }
                }

                // 清理公司名：去掉开头的序号（如 "16\n万向集团" → "万向集团"）
                const cleanName = companyName.replace(/^\d+\s*\n?\s*/, '').trim();

                const record = { companyName: cleanName, healthScore: score, ppCss, atsCss, owner, status };
                // 按公司名去重（同一公司只保留一条，取第一次出现的）
                if (!seenKeys.has(cleanName)) {
                    seenKeys.add(cleanName);
                    results.push(record);
                }
            }

            return {
                records: results,
                diag: {
                    allElements: allEls.length,
                    leafElements: leafEls.length,
                    scoresFound: scores.length,
                    companiesFound: companies.length,
                    sampleScores: scores.slice(0, 5).map(x => x.text),
                    sampleCompanies: companies.slice(0, 3).map(x => x.text)
                }
            };
        }).catch(err => ({ records: [], diag: { error: err.message } }));

        console.log(`   可见元素: ${pageData.diag.allElements}(叶子${pageData.diag.leafElements}), 健康分: ${pageData.diag.scoresFound}, 公司名: ${pageData.diag.companiesFound}`);
        console.log(`   样本: 分=[${pageData.diag.sampleScores?.join(', ')||''}], 公司=[${pageData.diag.sampleCompanies?.join(', ')||''}]`);
        console.log(`   ✅ 提取 ${pageData.records.length} 条`);

        saveDiag(`06-p${pageNum}-diag.json`, JSON.stringify(pageData.diag, null, 2));
        if (pageData.records.length > 0) {
            saveDiag(`06-p${pageNum}-records.json`, JSON.stringify(pageData.records, null, 2));
        }
        allRecords.push(...pageData.records);

        if (pageNum < maxPages) {
            let clicked = false;
            // 方法1: Playwright locator点击
            try {
                const nextLocators = [
                    page.locator('text=下一页').first(),
                    page.locator('button:has-text("下一页")').first(),
                    page.locator('[title="下一页"]').first(),
                    page.locator('svg[viewBox]').locator('xpath=ancestor::button').first()
                ];
                for (const loc of nextLocators) {
                    if (await loc.isVisible().catch(() => false)) {
                        await loc.click();
                        clicked = true;
                        break;
                    }
                }
            } catch(e) {}

            // 方法2: 找右箭头SVG或按钮
            if (!clicked) {
                clicked = await page.evaluate(() => {
                    // 找包含右箭头图标的按钮
                    const btns = [...document.querySelectorAll('button, [role="button"], a')];
                    for (const btn of btns) {
                        const html = btn.innerHTML || '';
                        if ((html.includes('right') || html.includes('next') || html.includes('arrow') || html.includes('>')) &&
                            btn.offsetParent && btn.getBoundingClientRect().width < 80) {
                            btn.click();
                            return true;
                        }
                    }
                    // 找分页数字后面的元素
                    const pageNums = [...document.querySelectorAll('*')].filter(el => /^\d+$/.test(el.innerText?.trim()) && el.offsetParent);
                    if (pageNums.length > 5) {
                        pageNums.sort((a,b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
                        const lastNum = pageNums[pageNums.length-1];
                        const nextEl = lastNum.nextElementSibling;
                        if (nextEl && nextEl.offsetParent) {
                            nextEl.click();
                            return true;
                        }
                    }
                    return false;
                }).catch(() => false);
            }

            if (clicked) {
                console.log('   ➡️ 翻页中...');
                // 等待数据刷新：通过检测分数/公司名变化确认翻页成功
                const prevScores = pageData.diag.sampleScores?.join(',') || '';
                const prevCompanies = pageData.diag.sampleCompanies?.join(',') || '';
                let waited = 0;
                const maxWait = 10000;
                while (waited < maxWait) {
                    await sleep(1000);
                    waited += 1000;
                    const check = await page.evaluate(() => {
                        const scores = [];
                        const companies = [];
                        const seen = new Set();
                        for (const el of document.querySelectorAll('*')) {
                            const text = el.innerText?.trim();
                            if (!text) continue;
                            const rect = el.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0 && rect.top > 100 && rect.top < window.innerHeight) {
                                if (/^\d+\.\d{1,2}$/.test(text) && parseFloat(text) <= 10) {
                                    const k = text + '|' + Math.round(rect.top);
                                    if (!seen.has(k)) { seen.add(k); scores.push(text); }
                                }
                                if (/(?:有限公司|集团|公司|科技|股份|生物|网络|电子)/.test(text) && text.length > 5 && text.length < 60) {
                                    companies.push(text);
                                }
                            }
                        }
                        return { scores: scores.slice(0, 5), companies: companies.slice(0, 3) };
                    }).catch(() => null);
                    if (check && (check.scores.join(',') !== prevScores || check.companies.join(',') !== prevCompanies)) {
                        console.log(`   ✅ 数据已刷新 (${waited}ms)`);
                        break;
                    }
                    if (waited >= maxWait) {
                        console.log(`   ⚠️ 等待${waited}ms数据未变化，继续`);
                    }
                }
                await sleep(1000); // 额外1秒确保DOM稳定
            } else {
                console.log('   ⏹️ 无下一页');
                break;
            }
        }
    }

    console.log(`\n📊 共提取 ${allRecords.length} 条原始记录`);
    saveDiag('06-raw-records.json', JSON.stringify(allRecords.slice(0, 30), null, 2));

    if (allRecords.length > 0) {
        const foundCss = new Set();
        allRecords.forEach(r => { if (r.ppCss) foundCss.add(r.ppCss); if (r.atsCss) foundCss.add(r.atsCss); });
        console.log('\n页面中找到的所有CSS人员:');
        [...foundCss].sort().forEach(n => console.log(`   - ${n}`));

        const filtered = allRecords.filter(r => {
            const pp = (r.ppCss || '').toString();
            const ats = (r.atsCss || '').toString();
            return TARGET_CSS.some(t => pp.includes(t) || ats.includes(t));
        });

        console.log(`\n🎯 过滤后: ${filtered.length} 条`);

        if (filtered.length > 0) {
            const summary = {};
            filtered.forEach(d => { const css = (d.atsCss || d.ppCss || '未知').toString().trim(); summary[css] = (summary[css] || 0) + 1; });
            console.log('\n📊 人员分布:');
            Object.entries(summary).sort((a, b) => b[1] - a[1]).forEach(([n, c]) => console.log(`   ${n}: ${c} 条`));

            console.log('\n前5条:');
            filtered.slice(0, 5).forEach(d => console.log(`   ${d.companyName} | PP:${d.ppCss} | ATS:${d.atsCss} | 分:${d.healthScore}`));

            const finalData = filtered.map(d => ({ customerName: d.companyName.trim(), healthScore: d.healthScore, cssOwner: ((d.atsCss || d.ppCss || '') + '').trim() }));
            const snapshot = { week: getWeekKey(), timestamp: new Date().toISOString().slice(0, 10), data: finalData };

            // 从COS拉取现有快照 → 追加新快照 → 写回COS
            let existing = await cosGet(HEALTH_FILE_KEY);
            if (!existing || !existing.snapshots) existing = { snapshots: [] };
            // 检查本周是否已有快照，有则替换
            const idx = existing.snapshots.findIndex(s => s.week === snapshot.week);
            if (idx >= 0) {
                existing.snapshots[idx] = snapshot;
                console.log(`   📝 替换已有快照 ${snapshot.week}`);
            } else {
                existing.snapshots.push(snapshot);
                console.log(`   ➕ 新增快照 ${snapshot.week}`);
            }
            if (existing.snapshots.length > 12) existing.snapshots = existing.snapshots.slice(-12);

            const ok = await cosPut(HEALTH_FILE_KEY, existing);
            if (ok) {
                console.log('\n✅ COS写入成功！周次: ' + snapshot.week);
                console.log('   → 刷新网页健康分看板即可查看');
            } else {
                console.error('❌ COS写入失败');
                fs.writeFileSync(path.join(DIAG_DIR, `health-${snapshot.week}.json`), JSON.stringify(snapshot, null, 2));
                console.log('   💾 已保存到本地文件 ' + path.join(DIAG_DIR, `health-${snapshot.week}.json`));
            }
        } else {
            console.log('\n⚠️ 过滤后0条。显示前10条原始记录:');
            allRecords.slice(0, 10).forEach(d => console.log(`   ${d.companyName} | PP:${d.ppCss} | ATS:${d.atsCss} | 分:${d.healthScore}`));
        }
    } else {
        console.log('\n❌ 未提取到数据');
    }

    console.log('\n浏览器保持打开5秒...');
    await sleep(5000);
    await browser.close();
    console.log('🎉 完成');
}

main().catch(err => { console.error('❌ 失败:', err); process.exit(1); });
