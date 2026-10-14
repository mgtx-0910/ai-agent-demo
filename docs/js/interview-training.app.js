/* 面试强化训练 · 应用逻辑（无依赖，只读渲染 interview-training.data.js） */
(function () {
  'use strict';

  var DATA = (window.KHTRAIN || { units: [], plan: [] });
  var GUIDE = DATA.guide || [];
  var FIGS = DATA.figs || {};
  var FIGBASE = '../agent-imgs/knowledge-hub-img/';
  var LKEY = 'kh_train_state_v1';
  var TKEY = 'kh_train_theme';
  var MODS = [];
  var PRIOS = ['P0 必答', 'P1 加分', 'P2 了解'];
  var STATUSES = ['待复习', '复习中', '已掌握'];
  var SC = { '待复习': 'red', '复习中': 'amber', '已掌握': 'green' };
  var DC = { '简单': 'green', '中等': 'amber', '困难': 'red' };

  var S = { q: '', mod: '', prio: '', status: '', view: 'units', mask: false, open: {}, st: {}, days: {} };
  var $ = function (id) { return document.getElementById(id); };
  function save() {
    try {
      localStorage.setItem(LKEY, JSON.stringify({ st: S.st, days: S.days, open: S.open, mask: S.mask, view: S.view }));
    } catch (e) { /* 隐私模式忽略 */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(LKEY);
      if (!raw) return;
      var d = JSON.parse(raw) || {};
      S.st = d.st || {}; S.days = d.days || {}; S.open = d.open || {};
      S.mask = !!d.mask; S.view = d.view === 'plan' ? 'plan' : 'units';
    } catch (e) { /* 数据损坏时用默认值 */ }
  }

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function statusOf(id) { return STATUSES.indexOf(S.st[id]) > -1 ? S.st[id] : '待复习'; }

  /* ---------- 极简 Markdown（支持围栏代码块 / 表格 / 列表） ---------- */
  function inline(t) {
    return esc(t)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  function md(src) {
    if (!src || !String(src).trim()) return '';
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    var out = [], i = 0, m;
    while (i < lines.length) {
      var ln = lines[i];
      if (!ln.trim()) { i++; continue; }
      if (/^\s*```/.test(ln)) {
        var code = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }
      if (/^\s*\|/.test(ln)) {
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        var cells = function (r) {
          return r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
        };
        var body = rows.slice(1).filter(function (r) { return !/^[\s|:\-]+$/.test(r); });
        var h = '<div class="tw"><table><thead><tr>' +
          cells(rows[0]).map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') +
          '</tr></thead><tbody>';
        h += body.map(function (r) {
          return '<tr>' + cells(r).map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
        }).join('');
        out.push(h + '</tbody></table></div>');
        continue;
      }
      if ((m = /^(#{1,4})\s+(.*)$/.exec(ln))) {
        out.push(m[1].length <= 2 ? '<h3>' + inline(m[2]) + '</h3>' : '<h4>' + inline(m[2]) + '</h4>');
        i++; continue;
      }
      if (/^\s*[-*]\s+/.test(ln)) {
        var ul = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          ul.push('<li>' + inline(lines[i].replace(/^\s*[-*]\s+/, '')) + '</li>'); i++;
        }
        out.push('<ul>' + ul.join('') + '</ul>'); continue;
      }
      if (/^\s*\d+[.)]\s+/.test(ln)) {
        var ol = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          ol.push('<li>' + inline(lines[i].replace(/^\s*\d+[.)]\s+/, '')) + '</li>'); i++;
        }
        out.push('<ol>' + ol.join('') + '</ol>'); continue;
      }
      out.push('<p>' + inline(ln) + '</p>'); i++;
    }
    return out.join('');
  }

  /* ---------- 匹配 ---------- */
  function match(u) {
    if (S.mod && u.mod !== S.mod) return false;
    if (S.prio && u.prio !== S.prio) return false;
    if (S.status && statusOf(u.id) !== S.status) return false;
    if (S.q) {
      var hay = [u.title, u.mod, u.ask, u.analogy, u.answer, u.follow, u.files, u.drill, u.accept, u.pitfall]
        .concat(u.tags || []).join(' ').toLowerCase();
      var ks = S.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < ks.length; i++) { if (hay.indexOf(ks[i]) === -1) return false; }
    }
    return true;
  }

  /* ---------- 侧边栏 ---------- */
  function renderStats() {
    var all = DATA.units, n = all.length, c = { '待复习': 0, '复习中': 0, '已掌握': 0 };
    all.forEach(function (u) { c[statusOf(u.id)]++; });
    var pct = n ? Math.round(c['已掌握'] / n * 100) : 0;
    var top = c['已掌握'] + c['复习中'];
    $('stats').innerHTML =
      '<div class="row"><span>单元总数</span><b>' + n + '</b></div>' +
      '<div class="row"><span>已掌握</span><b>' + c['已掌握'] + '</b></div>' +
      '<div class="row"><span>复习中</span><b>' + c['复习中'] + '</b></div>' +
      '<div class="row"><span>待复习</span><b>' + c['待复习'] + '</b></div>' +
      '<div class="row" style="margin-top:6px"><span>推进度</span><b>' + pct + '%</b></div>' +
      '<div class="bar"><i style="width:' + pct + '%;background:var(--ok)"></i>' +
      '<i style="width:' + Math.round((top - c['已掌握']) / (n || 1) * 100) + '%;background:var(--warn)"></i></div>';
  }
  function fList(id, list, cur, field, labels) {
    var box = $(id);
    box.innerHTML = list.map(function (k) {
      var n = DATA.units.filter(function (u) {
        return field === 'mod' ? u.mod === k : field === 'prio' ? u.prio === k : statusOf(u.id) === k;
      }).length;
      return '<li><button data-f="' + field + '" data-v="' + esc(k) + '" class="' + (cur === k ? 'active' : '') +
        '"><span>' + esc(labels ? labels[k] || k : k) + '</span><span class="cnt">' + n + '</span></button></li>';
    }).join('');
  }
  function renderFilters() {
    var mods = [];
    DATA.units.forEach(function (u) { if (mods.indexOf(u.mod) === -1) mods.push(u.mod); });
    MODS = mods;
    fList('fMod', mods, S.mod, 'mod');
    fList('fPrio', PRIOS, S.prio, 'prio');
    $('fStatus').innerHTML = STATUSES.map(function (k) {
      return '<li><button data-f="status" data-v="' + k + '" class="' + (S.status === k ? 'active' : '') + '"><span>' + k + '</span></button></li>';
    }).join('');
  }
  /* ---------- 卡片 ---------- */
  function blk(cls, title, body) {
    if (!body) return '';
    return '<section class="blk ' + cls + '"><h5>' + title + '</h5><div class="md">' + md(body) + '</div></section>';
  }
  function figsHtml(u) {
    var f = FIGS[u.id];
    if (!f || !f.length) return '';
    return '<section class="blk figs"><h5>配图 · 图解</h5><div class="figgrid">' +
      f.map(function (it) {
        var cap = it[1] || it[0];
        return '<figure class="fig"><img src="' + esc(FIGBASE + it[0]) + '" alt="' + esc(cap) + '" loading="lazy">' +
          '<figcaption>' + esc(cap) + '</figcaption></figure>';
      }).join('') +
      '</div></section>';
  }
  function cardHtml(u, idx) {
    var st = statusOf(u.id);
    var tags = (u.tags || []).map(function (t) { return '<span class="pill">#' + esc(t) + '</span>'; }).join('');
    return '<article class="u' + (S.open[u.id] ? ' open' : '') + '" id="u-' + esc(u.id) + '" data-id="' + esc(u.id) + '">' +
      '<div class="uh" data-act="toggle">' +
        '<div class="uno">' + idx + '</div>' +
        '<div class="um"><h3 class="ut">' + esc(u.title) + '</h3>' +
          '<div class="umeta">' +
            '<span class="pill blue">' + esc(u.mod) + '</span>' +
            '<span class="pill ' + (u.prio === 'P0 必答' ? 'red' : u.prio === 'P1 加分' ? 'amber' : '') + '">' + esc(u.prio) + '</span>' +
            '<span class="pill ' + (DC[u.diff] || '') + '">' + esc(u.diff) + '</span>' +
            '<span class="pill">' + (u.mins || 30) + ' 分钟</span>' +
            (u.code ? '<span class="pill amber">含动手练习</span>' : '') +
            tags +
            '<button class="pill ' + (SC[st] || '') + ' stbtn" data-act="status" title="点击切换掌握状态">● ' + st + '</button>' +
          '</div></div>' +
      '</div>' +
      '<div class="ub">' +
        blk('ask', '面试官会怎么问', u.ask) +
        blk('analogy', '前端视角类比', u.analogy) +
        blk('answer', '30 秒口述模板', u.answer) +
        blk('follow', '追问与加分点', u.follow) +
        blk('files', '本项目对应代码', u.files) +
        figsHtml(u) +
        blk('drill', '动手练习', u.drill) +
        blk('drill', '验收标准', u.accept) +
        blk('pitfall', '常见扣分点', u.pitfall) +
      '</div></article>';
  }
  function introHtml() {
    return '<div class="intro"><h2>🎯 怎么用这个页面（前端 → 后端面试）</h2>' +
      '<p>你的劣势不是"不会写后端"，而是<b>只到"会调 API、会用中间件"这一层</b>。面试官对前端候选人的后端期望通常是三件事：<b>能讲清边界、能说出取舍、有排查思路</b>——不要求你设计分布式系统，但要求你知道自己在系统里的位置。</p>' +
      '<p>所以每个训练单元都按同一个结构给：<b>面试官怎么问 → 前端视角类比 → 30 秒口述稿 → 追问答法 → 本项目代码位置 → 动手练习 + 验收 → 扣分点</b>。看一遍不算学会，要能"开口说 + 亲手跑"。</p>' +
      '<div class="kv">' +
        '<div><b>① 先读卡片</b>理解原理，找到项目里的代码位置</div>' +
        '<div><b>② 开"口述自测"</b>把答案打码，自己讲一遍再对照</div>' +
        '<div><b>③ 做动手练习</b>每题都有可验证的验收标准</div>' +
        '<div><b>④ 标记掌握度</b>点卡片上的状态，进度存在本地</div>' +
      '</div>' +
      '<p style="color:var(--muted);font-size:12.8px;margin-top:12px">优先级说明：<b>P0 必答</b>＝答错直接减分、必须能讲；<b>P1 加分</b>＝能体现你跑过系统；<b>P2 了解</b>＝知道概念即可。跟着 <b>计划</b> 走，每天 1.5 小时。</p>' +
      '<p style="color:var(--muted);font-size:12.8px">后端初学者入口：模块列表里的 <b>存储基础 · 总览 / PostgreSQL / MongoDB / Redis</b>（共 18 个补课单元，计划里对应 B1~B6）专治"只会增删改查"——每个单元都给可复制的 SQL / mongosh / redis-cli 命令，<b>亲手跑一遍再回来做主线题</b>。</p>' +
      '</div>';
  }
  function guideHtml() {
    if (!GUIDE.length) return '';
    return '<div class="guide"><div class="gt">🧭 后端初学者路线（点一下跳到对应内容）</div><div class="grow">' +
      GUIDE.map(function (g, i) {
        return '<button class="gbtn" data-act="guide" data-i="' + i + '">' +
          '<span class="gl">' + esc(g.label) + '</span>' +
          '<span class="gh">' + esc(g.hint || '') + '</span></button>';
      }).join('') + '</div></div>';
  }
  function renderUnits() {
    var list = DATA.units.filter(match);
    var head = '<div class="lh"><div><h1>训练卡片</h1><div class="sub">共 ' + list.length + ' / ' + DATA.units.length +
      ' 个单元' + (S.q ? ' · 搜索「' + esc(S.q) + '」' : '') + '</div></div></div>';
    if (!list.length) {
      $('main').innerHTML = introHtml() + guideHtml() + head + '<div class="empty">没有匹配的单元，试试清空筛选条件</div>';
      return;
    }
    $('main').innerHTML = introHtml() + guideHtml() + head + list.map(function (u) {
      return cardHtml(u, DATA.units.indexOf(u) + 1);
    }).join('');
  }

  /* ---------- 14 天计划 ---------- */
  function renderPlan() {
    var doneN = DATA.plan.filter(function (d) { return S.days[d.d]; }).length;
    var head = '<div class="lh"><div><h1>' + esc(DATA.planTitle || '14 天冲刺计划') + '</h1><div class="sub">已完成 ' + doneN + ' / ' + DATA.plan.length +
      ' 天 · 每天 1.5 小时左右</div></div><div class="sub">点任务可跳到对应训练卡片</div></div>';
    var body = DATA.plan.map(function (d) {
      var uids = d.tasks.map(function (t) { return t[0]; });
      var names = uids.map(function (id) {
        var u = DATA.units.filter(function (x) { return x.id === id; })[0];
        return u ? u.title : id;
      });
      return '<div class="day' + (S.days[d.d] ? ' done' : '') + '">' +
        '<div class="dh"><span class="dno">' + esc(d.label || ('D' + d.d)) + '</span><b>' + esc(d.title) + '</b>' +
        '<button class="btn ghost" data-act="daydone" data-d="' + d.d + '" style="margin-left:auto">' +
        (S.days[d.d] ? '✓ 已完成' : '标记完成') + '</button></div>' +
        '<div class="dgoal">目标：' + esc(d.goal) + '</div>' +
        '<ul class="dtasks">' + d.tasks.map(function (t, i) {
          return '<li><input type="checkbox"><span><a data-act="gotounit" data-id="' + esc(t[0]) + '">' +
            esc(names[i]) + '</a> — ' + esc(t[1]) + '</span></li>';
        }).join('') + '</ul>' +
        '<div class="dout">产出：' + esc(d.out) + '</div></div>';
    }).join('');
    $('main').innerHTML = guideHtml() + head + '<div class="plan">' + body + '</div>';
  }

  /* ---------- 渲染入口 ---------- */
  function render() {
    renderStats();
    renderFilters();
    document.body.classList.toggle('masked', S.mask);
    $('bMask').classList.toggle('on', S.mask);
    $('bView').innerHTML = S.view === 'units' ? '📅 14 天计划' : '🗂 训练卡片';
    if (S.view === 'units') renderUnits(); else renderPlan();
  }
  function gotoUnit(id) {
    S.view = 'units'; S.open[id] = true; save(); render();
    var el = $('u-' + id);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  /* 初学者路线：按存储 / 技术栈一键跳转 */
  function gotoGuide(i) {
    var g = GUIDE[i];
    if (!g) return;
    if (g.view === 'plan') { S.view = 'plan'; save(); render(); }
    else if (g.id) { gotoUnit(g.id); return; }
    else {
      S.view = 'units'; S.mod = g.mod || ''; S.prio = ''; S.status = ''; S.q = '';
      var si = $('search'); if (si) si.value = '';
      save(); render();
    }
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
  }

  /* ---------- 事件 ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target, el = t.closest ? t.closest('[data-act]') : null;
    if (el) {
      var act = el.getAttribute('data-act');
      if (act === 'status') {
        var card = el.closest('.u'), id = card.getAttribute('data-id');
        var cur = statusOf(id);
        S.st[id] = STATUSES[(STATUSES.indexOf(cur) + 1) % STATUSES.length];
        save(); render(); return;
      }
      if (act === 'toggle') {
        var c2 = el.closest('.u'), id2 = c2.getAttribute('data-id');
        if (S.open[id2]) delete S.open[id2]; else S.open[id2] = true;
        save(); c2.classList.toggle('open'); return;
      }
      if (act === 'guide') { gotoGuide(Number(el.getAttribute('data-i'))); return; }
      if (act === 'gotounit') { gotoUnit(el.getAttribute('data-id')); return; }
      if (act === 'daydone') { var d = el.getAttribute('data-d'); if (S.days[d]) delete S.days[d]; else S.days[d] = true; save(); renderPlan(); renderStats(); return; }
    }
    var f = t.closest ? t.closest('[data-f]') : null;
    if (f) {
      var field = f.getAttribute('data-f'), v = f.getAttribute('data-v');
      S[field] = S[field] === v ? '' : v;
      render(); return;
    }
    if (S.mask) {
      var mblk = t.closest ? t.closest('.blk.answer,.blk.follow') : null;
      if (mblk) mblk.classList.toggle('revealed');
    }
  });

  $('search').addEventListener('input', function (e) { S.q = e.target.value.trim(); render(); });
  $('bView').addEventListener('click', function () { S.view = S.view === 'units' ? 'plan' : 'units'; save(); render(); });
  $('bMask').addEventListener('click', function () { S.mask = !S.mask; save(); render(); });
  $('bOpenAll').addEventListener('click', function () {
    DATA.units.filter(match).forEach(function (u) { S.open[u.id] = true; }); save(); render();
  });
  $('bCloseAll').addEventListener('click', function () { S.open = {}; save(); render(); });
  $('bReset').addEventListener('click', function () {
    S.q = ''; S.mod = ''; S.prio = ''; S.status = ''; $('search').value = ''; render();
  });
  $('bResetState').addEventListener('click', function () {
    if (!confirm('清空掌握状态与计划进度？')) return;
    S.st = {}; S.days = {}; save(); render();
  });
  $('bTheme').addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(TKEY, next); } catch (e) { /* ignore */ }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('search').focus(); }
    if (e.key === 'Escape') { S.q = ''; $('search').value = ''; render(); }
  });

  /* ---------- 启动 ---------- */
  try {
    var th = localStorage.getItem(TKEY);
    if (th) document.documentElement.setAttribute('data-theme', th);
  } catch (e) { /* ignore */ }
  load();
  if (!DATA.units.length) {
    $('main').innerHTML = '<div class="empty">数据未加载：请确认 <code>docs/js/interview-training.data.js</code> 存在且与页面同源目录。</div>';
  } else {
    render();
  }
})();
