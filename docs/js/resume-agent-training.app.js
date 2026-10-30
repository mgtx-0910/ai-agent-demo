/* 简历特训 · 交互逻辑 */
(function () {
  'use strict';

  var DATA = window.RESUME_TRAIN || { units: [], plan: [], pitch: [], source: null };
  var UNITS = DATA.units;
  var MODS = [];
  var PRIOS = [];
  UNITS.forEach(function (u) {
    if (MODS.indexOf(u.mod) < 0) MODS.push(u.mod);
    if (PRIOS.indexOf(u.prio) < 0) PRIOS.push(u.prio);
  });

  var LS_STATE = 'kh-resume-train-state-v1';
  var LS_THEME = 'kh-resume-train-theme-v1';

  var STATE = {
    q: '',
    mod: '全部',
    prio: '全部',
    status: '全部',
    view: 'dashboard',
    mask: false,
    open: {},
    done: (load(LS_STATE) || {}).done || {},
  };

  var main = document.getElementById('main');

  function load(k) {
    try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(LS_STATE, JSON.stringify({ done: STATE.done })); } catch (e) {}
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- 轻量 markdown ---------- */
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }
  function md(src) {
    if (!src) return '';
    var lines = String(src).split('\n');
    var out = [], i = 0, para = [], list = null, table = null;

    function flushPara() {
      if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; }
    }
    function flushList() {
      if (list) { out.push('<' + list.tag + '>' + list.items.map(function (t) { return '<li>' + inline(t) + '</li>'; }).join('') + '</' + list.tag + '>'); list = null; }
    }
    function flushTable() {
      if (!table) return;
      var head = table.head, rows = table.rows;
      var html = '<div class="tw"><table><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
      rows.forEach(function (r) {
        html += '<tr>' + head.map(function (_, idx) { return '<td>' + inline(r[idx] || '') + '</td>'; }).join('') + '</tr>';
      });
      out.push(html + '</tbody></table></div>');
      table = null;
    }
    function splitRow(line) {
      return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); });
    }

    while (i < lines.length) {
      var line = lines[i];
      var t = line.trim();

      if (/^```/.test(t)) {
        flushPara(); flushList(); flushTable();
        var buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
        i++;
        out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }
      if (!t) { flushPara(); flushList(); flushTable(); i++; continue; }

      if (/^\|.*\|$/.test(t)) {
        flushPara(); flushList();
        var isSep = /^\|[\s:\-|]+\|$/.test(t);
        if (!table && !isSep) { table = { head: splitRow(t), rows: [] }; }
        else if (table && isSep) { /* 分隔行忽略 */ }
        else if (table) { table.rows.push(splitRow(t)); }
        i++;
        continue;
      } else { flushTable(); }

      var h = /^(#{1,4})\s+(.*)$/.exec(t);
      if (h) { flushPara(); flushList(); out.push('<h3>' + inline(h[2]) + '</h3>'); i++; continue; }

      var ul = /^[-*]\s+(.*)$/.exec(t);
      if (ul) {
        flushPara();
        if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
        list.items.push(ul[1]); i++; continue;
      }
      var ol = /^\d+[.、]\s+(.*)$/.exec(t);
      if (ol) {
        flushPara();
        if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
        list.items.push(ol[1]); i++; continue;
      }
      flushList();
      para.push(t); i++;
    }
    flushPara(); flushList(); flushTable();
    return out.join('');
  }

  /* ---------- 匹配 ---------- */
  function statusOf(id) { return STATE.done[id] || '未学'; }
  function match(u) {
    if (STATE.mod !== '全部' && u.mod !== STATE.mod) return false;
    if (STATE.prio !== '全部' && u.prio !== STATE.prio) return false;
    if (STATE.status !== '全部' && statusOf(u.id) !== STATE.status) return false;
    if (!STATE.q) return true;
    var q = STATE.q.toLowerCase();
    var hay = [u.title, u.resume, u.ask, u.follow, u.answer, u.nums, u.files, u.pitfall, (u.tags || []).join(' '), u.mod].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function visible() { return UNITS.filter(match); }

  /* ---------- 渲染 ---------- */
  function renderStats() {
    var total = UNITS.length;
    var t = { '已掌握': 0, '复习中': 0, '未学': 0 };
    UNITS.forEach(function (u) { t[statusOf(u.id)] = (t[statusOf(u.id)] || 0) + 1; });
    var pct = Math.round((t['已掌握'] / total) * 100);
    document.getElementById('stats').innerHTML =
      '<div class="row"><span>题目总数</span><b>' + total + '</b></div>' +
      '<div class="row"><span>已掌握</span><b>' + t['已掌握'] + '</b></div>' +
      '<div class="row"><span>复习中</span><b>' + t['复习中'] + '</b></div>' +
      '<div class="row"><span>未学</span><b>' + t['未学'] + '</b></div>' +
      '<div class="bar"><i style="width:' + pct + '%;background:var(--ok)"></i></div>' +
      '<div class="row" style="margin-top:5px"><span>掌握率</span><b>' + pct + '%</b></div>';
  }

  function renderFilters() {
    function list(el, items, key, counts) {
      el.innerHTML = items.map(function (it) {
        var active = STATE[key] === it ? ' active' : '';
        return '<li><button class="' + active + '" data-f="' + key + '" data-v="' + esc(it) + '">' + esc(it) + '<span class="cnt">' + (counts[it] || 0) + '</span></button></li>';
      }).join('');
    }
    var mc = {}, pc = {}, sc = { '未学': 0, '复习中': 0, '已掌握': 0 };
    UNITS.forEach(function (u) {
      mc[u.mod] = (mc[u.mod] || 0) + 1;
      pc[u.prio] = (pc[u.prio] || 0) + 1;
      sc[statusOf(u.id)]++;
    });
    list(document.getElementById('fMod'), ['全部'].concat(MODS), 'mod', Object.assign({ '全部': UNITS.length }, mc));
    list(document.getElementById('fPrio'), ['全部'].concat(PRIOS), 'prio', Object.assign({ '全部': UNITS.length }, pc));
    list(document.getElementById('fStatus'), ['全部', '未学', '复习中', '已掌握'], 'status', Object.assign({ '全部': UNITS.length }, sc));
  }

  function statusBtn(u) {
    var s = statusOf(u.id);
    var cls = s === '已掌握' ? 'green' : (s === '复习中' ? 'amber' : '');
    return '<button class="pill stbtn ' + cls + '" data-st="' + u.id + '" title="点击切换掌握状态">' + s + '</button>';
  }

  function unitHtml(u, idx) {
    var open = STATE.open[u.id] ? ' open' : '';
    var prioCls = u.prio.indexOf('P0') === 0 ? 'red' : (u.prio.indexOf('P1') === 0 ? 'amber' : '');
    return '' +
      '<article class="u' + open + '" id="u-' + u.id + '" data-id="' + u.id + '">' +
        '<div class="uh" data-t="' + u.id + '">' +
          '<div class="uno">' + (idx + 1) + '</div>' +
          '<div class="um">' +
            '<h2 class="ut">' + esc(u.title) + '</h2>' +
            '<div class="umeta">' +
              '<span class="pill blue">' + esc(u.mod) + '</span>' +
              '<span class="pill ' + prioCls + '">' + esc(u.prio) + '</span>' +
              '<span class="pill">难度 ' + esc(u.diff) + '</span>' +
              '<span class="pill">约 ' + u.mins + ' 分钟</span>' +
              statusBtn(u) +
              (u.tags || []).map(function (t) { return '<span class="pill">#' + esc(t) + '</span>'; }).join('') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="ub">' +
          '<div class="blk resume"><h5>简历原句</h5><div class="md"><p>' + inline(u.resume).replace(/\n/g, '<br>') + '</p></div></div>' +
          '<div class="blk ask"><h5>面试官会怎么问</h5><div class="md">' + md(u.ask) + '</div></div>' +
          '<div class="blk follow masked-block" data-mask-block><h5>追问链（点开逐层压）</h5><div class="md">' + md(u.follow) + '</div></div>' +
          '<div class="blk answer masked-block" data-mask-block><h5>口述稿 / 应答骨架</h5><div class="md">' + md(u.answer) + '</div></div>' +
          (u.nums ? '<div class="blk nums masked-block" data-mask-block><h5>数字与口径</h5><div class="md">' + md(u.nums) + '</div></div>' : '') +
          (u.files ? '<div class="blk files masked-block" data-mask-block><h5>代码锚点（被问"哪行"时用）</h5><div class="md">' + md(u.files) + '</div></div>' : '') +
          '<div class="blk pitfall masked-block" data-mask-block><h5>扣分红线</h5><div class="md">' + md(u.pitfall) + '</div></div>' +
        '</div>' +
      '</article>';
  }

  var INTRO = '<section class="intro">' +
    '<h2>训练规则：先回答，再看答案</h2>' +
    '<p>这不是让你背一套项目介绍，而是<strong>把简历上的每一句话变成“事实、证据、边界”三件套</strong>。打开训练单元后，先用自己的话回答“面试官会怎么问”，再展开追问链；顶部的“遮住答案”会把口述稿、数字、代码锚点和扣分红线先藏起来。</p>' +
    '<div class="kv">' +
      '<div><b>P0 必答</b>答不出直接掉档，先全部过一遍</div>' +
      '<div><b>P1 加分</b>答得出就与普通候选人拉开差距</div>' +
      '<div><b>简历对账</b>右上角可切到 PDF 原文（技能 + 项目），看每个关键词在本项目是否真的落地</div>' +
      '<div><b>代码锚点</b>被问"具体在哪"时直接报文件与函数</div>' +
    '</div></section>' +
    '<div class="risk"><b>先看风险自查：</b>这个 Knowledge Hub 生产链路是<strong>单 Agent + 4 个工具</strong>，不是多 Agent 协作；技能栏里的 Multi-Agent、DeepAgents、HITL 要主动说明来自其他项目或学习经验。对应处置见 <a data-jump="m5-4" style="color:inherit;text-decoration:underline;cursor:pointer">技能深挖 · Multi-Agent</a>。另外，“120 道题 vs 9 条回归集”、hit@5、P95、成本 -35% 都必须能说清口径，先看 <a data-jump="m6-1" style="color:inherit;text-decoration:underline;cursor:pointer">压力面 · 口径校准</a>。</div>';

  function jumpLink(id, label) {
    return '<a class="dash-link" data-jump="' + id + '">' + esc(label) + '</a>';
  }

  function renderDashboard() {
    var done = Object.keys(STATE.done).filter(function (id) { return STATE.done[id] === '已掌握'; }).length;
    var total = UNITS.length;
    var pct = total ? Math.round(done / total * 100) : 0;
    main.innerHTML = '<div class="dashboard">' +
      '<section class="dash-hero">' +
        '<h1>面试防守训练台</h1>' +
        '<p>目标不是把简历写得更漂亮，而是面试官顺着任何一句话往下追，你都能回答：<strong>我做了什么、为什么这样做、怎么证明、哪里没做</strong>。</p>' +
        '<div class="dash-actions"><button class="btn on" data-view="units">开始训练单元</button><button class="btn" data-view="pitch">先练 30 秒自述</button><button class="btn" data-view="src">先做简历对账</button></div>' +
      '</section>' +
      '<div class="dash-strip">' +
        '<div class="dash-rule"><b>当前进度</b><span>' + done + ' / ' + total + ' 个单元已掌握（' + pct + '%）</span></div>' +
        '<div class="dash-rule"><b>练习动作</b><span>先答 30 秒，再接 3 层追问，最后报代码锚点</span></div>' +
        '<div class="dash-rule"><b>最高优先级</b><span>先过 P0：定位、Agent 主链、RAG、权限、评测、数字口径</span></div>' +
      '</div>' +
      '<div class="dash-grid">' +
        '<section class="dash-step"><h3><span class="dash-no">1</span>先守住项目边界</h3><p>先把“我做了什么”和“我没做什么”说准确，避免被关键词带偏。</p><ul>' +
          '<li>' + jumpLink('m0-1', '30 秒项目定位') + '</li><li>' + jumpLink('m0-2', '负责人到底负责什么') + '</li><li>' + jumpLink('m5-4', '单 Agent 与 Multi-Agent 的边界') + '</li>' +
        '</ul></section>' +
        '<section class="dash-step"><h3><span class="dash-no">2</span>讲清 Agent 怎么工作</h3><p>不要只说“用了 LangChain”，要能画出口路由、工具、重查和停止条件。</p><ul>' +
          '<li>' + jumpLink('m1-1', 'createAgent 与 LangGraph 怎么选') + '</li><li>' + jumpLink('m1-2', '4 个工具怎么分工') + '</li><li>' + jumpLink('m1-4', '切题评估与改写重查') + '</li>' +
        '</ul></section>' +
        '<section class="dash-step"><h3><span class="dash-no">3</span>讲清 RAG 为什么可靠</h3><p>把召回、融合、重排、阈值、降级和权限放在一条链里解释。</p><ul>' +
          '<li>' + jumpLink('m2-1', '混合检索从 query 到 top5') + '</li><li>' + jumpLink('m2-2', 'RRF 为什么不是加权求和') + '</li><li>' + jumpLink('m2-4', '向量或 rerank 挂了怎么办') + '</li>' +
        '</ul></section>' +
        '<section class="dash-step"><h3><span class="dash-no">4</span>用证据而不是形容词收尾</h3><p>每个结果都要能回到指标、评测样本、trace 或代码文件。</p><ul>' +
          '<li>' + jumpLink('m4-1', '9 个评估器分别管什么') + '</li><li>' + jumpLink('m6-1', '120 道题与 9 条回归集') + '</li><li>' + jumpLink('m7-1', 'hit@5 62%→84% 怎么讲') + '</li>' +
        '</ul></section>' +
      '</div>' +
      '<div class="dash-warning"><b>面试时的三条底线</b><br>1. 生产项目是单 Agent + 多工具，不把其他项目经验冒充成 Knowledge Hub 的实现。<br>2. 任何数字先说统计口径，再说结论；说不出来源就标成估算或删掉。<br>3. 不确定时用“当前实现 / 我做过的实验 / 下一步会补”分层回答，不要用更大的名词掩盖空白。</div>' +
    '</div>';
  }

  function renderUnits() {
    var list = visible();
    var html = INTRO;
    if (!list.length) {
      html += '<div class="empty">没有匹配的单元。试试搜索 <code>RRF</code>、<code>意图</code>、<code>评测</code>，或点左侧"清空筛选"。</div>';
    } else {
      html += '<div class="lh"><h1>特训单元</h1><div class="sub">当前 ' + list.length + ' / ' + UNITS.length + ' 条 · 先答再展开 · 点击标题展开</div></div>';
      html += '<div class="training-note">建议顺序：先读“面试官会怎么问”，用 30 秒回答；再打开追问链，补上“为什么”；最后核对数字和代码锚点。打开顶部“遮住答案”后，参考内容会先模糊隐藏。</div>';
      html += list.map(unitHtml).join('');
    }
    main.innerHTML = html;
  }

  function renderPlan() {
    var html = '<div class="lh"><h1>7 天冲刺计划</h1><div class="sub">每天 1~2 小时 · 每天有明确产出</div></div><div class="plan">';
    html += DATA.plan.map(function (p) {
      var allDone = p.tasks.length > 0 && p.tasks.every(function (t, i) { return STATE.done['plan-' + p.day + '-' + i]; });
      var tasks = p.tasks.map(function (t, i) {
        var id = 'plan-' + p.day + '-' + i;
        var done = STATE.done[id];
        var links = (t.ids || []).filter(function (uid) {
          return UNITS.some(function (u) { return u.id === uid; });
        }).map(function (uid) {
          var u = UNITS.filter(function (x) { return x.id === uid; })[0];
          return '<a data-jump="' + uid + '">' + esc(u.title) + '</a>';
        }).join('、');
        return '<li><button class="pill stbtn ' + (done ? 'green' : '') + '" data-plan="' + id + '">' + (done ? '✓' : '○') + '</button><span>' + esc(t.text) + (links ? '　→ ' + links : '') + '</span></li>';
      }).join('');
      return '<div class="day' + (allDone ? ' done' : '') + '">' +
        '<div class="dh"><span class="dno">' + p.day + '</span><b>' + esc(p.title) + '</b></div>' +
        '<div class="dgoal">目标：' + esc(p.goal) + '</div>' +
        '<ul class="dtasks">' + tasks + '</ul>' +
        '<div class="dout">产出：' + esc(p.output) + '</div></div>';
    }).join('');
    main.innerHTML = html + '</div>';
  }

  function renderPitch() {
    var html = '<div class="lh"><h1>自述话术</h1><div class="sub">照读三遍，然后脱稿说一遍；不要背字，背结构</div></div><div class="pitch">';
    html += DATA.pitch.map(function (p) {
      return '<div class="pcard"><h3>' + esc(p.title) + '</h3><div class="pmeta">' + esc(p.meta) + '</div>' +
        '<div class="md">' + md(p.body) + '</div>' +
        (p.tip ? '<div class="tip">用法：' + esc(p.tip) + '</div>' : '') + '</div>';
    }).join('');
    main.innerHTML = html + '</div>';
  }

  function renderSource() {
    var S = DATA.source;
    if (!S) { main.innerHTML = '<div class="empty">没有原文数据。</div>'; return; }
    var html = '<div class="lh"><h1>简历原文对照</h1><div class="sub">PDF 逐字摘录 · 每段标落点单元与差异</div></div>' +
      '<div class="srccmd">' + md(S.meta) + '</div><div class="src">';

    html += '<div class="pcard"><h3>' + esc(S.skills.title) + '</h3><div class="pmeta">' + esc(S.skills.sub) +
      ' <button class="btn mini" data-agent-only>只看 Agent（' + countAgent(S.skills.items) + ' 组）</button></div>';
    S.skills.items.forEach(function (it, i) {
      html += '<div class="srcq">' + esc(it.text) + '</div>' +
        (it.qa && it.qa.length ? '<div class="srcqa">' + it.qa.map(function (x) {
          return '<details class="qa"' + (x.tag === 'Agent' ? ' data-agent="1"' : '') + '><summary>' +
            (x.tag ? '<b class="qatag' + (x.tag === 'Agent' ? ' on' : '') + '">' + esc(x.tag) + '</b>' : '') +
            esc(x.q) + '</summary><div class="md">' + md(x.a) + '</div></details>';
        }).join('') + '</div>' : '') +
        (it.note ? '<div class="srcnote">' + inline(it.note) + '</div>' : '') +
        '<div class="srclink"><span>对照：</span>' + linkOf(it.ids) + '</div>';
      if (i < S.skills.items.length - 1) html += '<hr class="srchr">';
    });
    html += '</div>';

    S.projects.forEach(function (p) {
      html += '<div class="pcard"><h3>' + esc(p.name) + '</h3><div class="pmeta">' + esc(p.meta) + '</div>' +
        '<div class="srcq">' + esc(p.desc) + '</div>' +
        (p.note ? '<div class="srcnote">' + inline(p.note) + '</div>' : '') +
        '<div class="srcstack">技术栈：' + esc(p.stack) + '</div>' +
        '<div class="blk"><h5>核心实现（原文要点 → 对照）</h5>';
      p.points.forEach(function (pt) {
        html += '<div class="srcpt"><b>' + esc(pt.h) + '</b>' +
          '<div class="srcq">' + esc(pt.text) + '</div>' +
          (pt.note ? '<div class="srcnote">' + inline(pt.note) + '</div>' : '') +
          '<div class="srclink"><span>对照：</span>' + linkOf(pt.ids) + '</div></div>';
      });
      html += '</div></div>';
    });

    main.innerHTML = html + '</div>';
  }

  function countAgent(items) {
    var n = 0;
    (items || []).forEach(function (it) {
      (it.qa || []).forEach(function (x) { if (x.tag === 'Agent') n++; });
    });
    return n;
  }

  function linkOf(ids) {
    return (ids || []).filter(function (uid) {
      return UNITS.some(function (u) { return u.id === uid; });
    }).map(function (uid) {
      var u = UNITS.filter(function (x) { return x.id === uid; })[0];
      return '<a data-jump="' + uid + '">' + esc(u.title) + '</a>';
    }).join('') || '<span>—</span>';
  }

  function render() {
    renderStats();
    renderFilters();
    document.body.classList.toggle('masked', STATE.mask);
    document.getElementById('bMask').classList.toggle('on', STATE.mask);
    if (STATE.view === 'dashboard') renderDashboard();
    else if (STATE.view === 'plan') renderPlan();
    else if (STATE.view === 'pitch') renderPitch();
    else if (STATE.view === 'src') renderSource();
    else renderUnits();
    document.getElementById('bHome').classList.toggle('on', STATE.view === 'dashboard');
    document.getElementById('bView').classList.toggle('on', STATE.view === 'units');
    document.getElementById('bPitch').classList.toggle('on', STATE.view === 'pitch');
    document.getElementById('bSrc').classList.toggle('on', STATE.view === 'src');
    document.getElementById('bView').textContent = STATE.view === 'plan' ? '回到训练单元' : '训练单元';
  }

  /* ---------- 事件 ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-t],[data-st],[data-f],[data-plan],[data-jump],[data-agent-only],[data-view],[data-mask-block]') : null;
    if (!t) return;

    if (t.hasAttribute('data-mask-block')) {
      if (STATE.mask) t.classList.toggle('revealed');
      return;
    }
    if (t.hasAttribute('data-view')) {
      STATE.view = t.getAttribute('data-view');
      render();
      toTop();
      return;
    }
    if (t.hasAttribute('data-agent-only')) {
      var only = main.classList.toggle('agentOnly');
      t.textContent = only ? '显示全部问答' : ('只看 Agent（' + countAgent(DATA.source.skills.items) + ' 组）');
      return;
    }
    if (t.hasAttribute('data-st')) {
      var id = t.getAttribute('data-st');
      var cur = statusOf(id);
      var next = cur === '未学' ? '复习中' : (cur === '复习中' ? '已掌握' : '未学');
      if (next === '未学') delete STATE.done[id]; else STATE.done[id] = next;
      save();
      var art = document.getElementById('u-' + id);
      var btn = art.querySelector('[data-st]');
      btn.textContent = next;
      btn.className = 'pill stbtn ' + (next === '已掌握' ? 'green' : (next === '复习中' ? 'amber' : ''));
      renderStats(); renderFilters();
      return;
    }
    if (t.hasAttribute('data-plan')) {
      var pid = t.getAttribute('data-plan');
      if (STATE.done[pid]) delete STATE.done[pid]; else STATE.done[pid] = 'done';
      save(); renderPlan();
      return;
    }
    if (t.hasAttribute('data-jump')) {
      var uid = t.getAttribute('data-jump');
      STATE.view = 'units'; STATE.mod = '全部'; STATE.prio = '全部'; STATE.status = '全部'; STATE.q = '';
      document.getElementById('search').value = '';
      STATE.open[uid] = true;
      render();
      var el = document.getElementById('u-' + uid);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
      return;
    }
    if (t.hasAttribute('data-f')) {
      STATE[t.getAttribute('data-f')] = t.getAttribute('data-v');
      render();
      return;
    }
    if (t.hasAttribute('data-t')) {
      var tid = t.getAttribute('data-t');
      STATE.open[tid] = !STATE.open[tid];
      var node = document.getElementById('u-' + tid);
      if (node) node.classList.toggle('open', !!STATE.open[tid]);
      return;
    }
  });

  document.getElementById('search').addEventListener('input', function (e) {
    STATE.q = e.target.value.trim();
    if (STATE.view !== 'units') STATE.view = 'units';
    render();
  });

  function toTop() {
    try { window.scrollTo({ top: 0 }); } catch (e) {}
  }

  document.getElementById('bView').addEventListener('click', function () {
    STATE.view = STATE.view === 'units' ? 'plan' : 'units';
    render(); toTop();
  });
  document.getElementById('bHome').addEventListener('click', function () {
    STATE.view = 'dashboard';
    render(); toTop();
  });
  document.getElementById('bPitch').addEventListener('click', function () {
    STATE.view = STATE.view === 'pitch' ? 'units' : 'pitch';
    render(); toTop();
  });
  document.getElementById('bSrc').addEventListener('click', function () {
    STATE.view = STATE.view === 'src' ? 'units' : 'src';
    render(); toTop();
  });
  document.getElementById('bMask').addEventListener('click', function () {
    STATE.mask = !STATE.mask;
    document.body.classList.toggle('masked', STATE.mask);
    document.getElementById('bMask').classList.toggle('on', STATE.mask);
  });
  document.getElementById('bTheme').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme');
    var next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(LS_THEME, next); } catch (e) {}
  });
  document.getElementById('bOpenAll').addEventListener('click', function () {
    visible().forEach(function (u) { STATE.open[u.id] = true; });
    render();
  });
  document.getElementById('bCloseAll').addEventListener('click', function () {
    STATE.open = {};
    render();
  });
  document.getElementById('bReset').addEventListener('click', function () {
    STATE.q = ''; STATE.mod = '全部'; STATE.prio = '全部'; STATE.status = '全部';
    document.getElementById('search').value = '';
    render();
  });
  document.getElementById('bResetState').addEventListener('click', function () {
    if (!confirm('清空所有掌握状态与计划打勾？')) return;
    STATE.done = {}; save(); render();
  });

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      document.getElementById('search').focus();
    }
    if (e.key === 'Escape' && document.activeElement && document.activeElement.id === 'search') {
      document.getElementById('search').value = ''; STATE.q = ''; render();
    }
  });

  try {
    var th = localStorage.getItem(LS_THEME);
    if (th) document.documentElement.setAttribute('data-theme', th);
  } catch (e) {}

  render();
})();
