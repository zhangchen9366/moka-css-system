// ============================================================
// 使用方法：在销售易客户列表页面，按 F12 打开控制台，粘贴这段代码运行
// 它会自动提取当前页可见的客户健康分数据
// ============================================================

const TARGET_CSS = ['张辰','宋明亮','娄洋','王俊朋','曾瑞锋','徐琪','李晓丽','金梅','王亚淼','周旺'];
const COLS = ['序号','客户名称','M','PP CSS','ATS CSS','最新健康分','客户所有人','状态'];

function extractVisibleData() {
    const results = [];
    
    // 策略：找所有包含数字序号+公司名称的可见元素
    // 销售易的每个数据行通常是一个包含多个子元素的容器
    const allEls = document.querySelectorAll('*');
    
    for(const el of allEls) {
        // 只看有足够子元素的容器
        if(el.children.length < 3 || el.children.length > 20) continue;
        if(!el.offsetParent) continue; // 不可见
        
        const text = el.innerText || '';
        // 数据行特征：以数字开头 + 包含公司名特征 + 长度适中
        const lines = text.split(/\n/).map(l=>l.trim()).filter(l=>l.length>0);
        if(lines.length < 3) continue;
        
        // 第一行必须是数字（序号）
        if(!/^\d+$/.test(lines[0])) continue;
        
        // 必须包含公司名特征
        const hasCompany = lines.some(l=> /有限公司|集团|公司|科技|股份|生物|汽车|网络|电子|信息|商贸|咨询/.test(l));
        if(!hasCompany) continue;
        
        // 解析这一行的数据
        const parsed = parseRowLines(lines);
        if(parsed) {
            results.push(parsed);
        }
    }
    
    return results;
}

function parseRowLines(lines) {
    // lines 大概格式（每行一个字段，空列被跳过）：
    // ['1', '杭州拼吖信息科技有限公司', '秀顺', '黄文鑫', '5.09', '张云芳', '已签约']
    // 或 ['3', 'EDGEX', 'DAO', 'PT...', '$', '立铭', '黄文鑫', '吕成宣', '已签约']
    
    const serial = lines[0];
    if(!/^\d+$/.test(serial)) return null;
    
    // 找健康分（X.XX格式）
    let healthScore = 0;
    let healthIdx = -1;
    for(let i = lines.length - 1; i >= 0; i--) {
        if(/^\d+\.\d+$/.test(lines[i])) {
            healthScore = parseFloat(lines[i]);
            healthIdx = i;
            break;
        }
    }
    
    // 状态在最后
    const statusWords = ['已签约','未签约','已开通','已关闭','已归档','草稿','跟进中','已完结','关闭','签约','新商机','续约','流失','已退订','已终止','暂停','在约'];
    let status = '';
    let statusIdx = lines.length;
    for(let i = lines.length - 1; i >= 0; i--) {
        if(statusWords.some(w => lines[i].includes(w))) {
            status = lines[i];
            statusIdx = i;
            break;
        }
    }
    
    // 客户所有人 = 状态前面的中文名（或英文名）
    let owner = '';
    let ownerIdx = -1;
    if(statusIdx > 0) {
        owner = lines[statusIdx - 1];
        ownerIdx = statusIdx - 1;
    }
    
    // 找两个CSS名（健康分/所有人之前的纯中文名，排除$）
    const cssCandidates = [];
    const searchEnd = healthIdx >= 0 ? healthIdx : (ownerIdx > 0 ? ownerIdx : lines.length);
    for(let i = searchEnd - 1; i > 0; i--) {
        const val = lines[i];
        if(val === '$') continue;
        // 中文名或英文名
        if(/^[\u4e00-\u9fa5]{2,5}$/.test(val) || /^[A-Za-z\s\.]+$/.test(val)) {
            cssCandidates.push({ val, idx: i });
        }
    }
    
    let atsCss = '', ppCss = '';
    if(cssCandidates.length >= 2) {
        atsCss = cssCandidates[0].val;
        ppCss = cssCandidates[1].val;
    } else if(cssCandidates.length === 1) {
        atsCss = cssCandidates[0].val;
    }
    
    // 客户名称 = 序号后到第一个CSS之前的所有非$内容
    const nameEndIdx = ppCss ? cssCandidates[1]?.idx : (cssCandidates[0]?.idx || searchEnd);
    const nameParts = [];
    for(let i = 1; i < (ppCss ? cssCandidates[1].idx : (cssCandidates[0]?.idx || searchEnd)); i++) {
        if(lines[i] !== '$' && !/^[\u4e00-\u9fa5]{2,5}$/.test(lines[i])) {
            nameParts.push(lines[i]);
        }
    }
    const customerName = nameParts.join(' ').trim();
    
    if(!customerName || customerName.length < 2) return null;
    
    return {
        customerName,
        ppCss,
        atsCss,
        healthScore,
        owner,
        status
    };
}

// 执行提取
const data = extractVisibleData();
console.log('提取到', data.length, '条');
console.log(data.slice(0, 5));

// 过滤目标人员
const filtered = data.filter(d => {
    return TARGET_CSS.some(t => (d.ppCss||'').includes(t) || (d.atsCss||'').includes(t));
});

console.log('\n目标人员数据：', filtered.length, '条');
filtered.forEach(d => console.log(d.customerName, '| PP:', d.ppCss, '| ATS:', d.atsCss, '| 健康分:', d.healthScore));

// 复制到剪贴板（可选）
const jsonStr = JSON.stringify(filtered, null, 2);
console.log('\n===== JSON =====');
console.log(jsonStr);
