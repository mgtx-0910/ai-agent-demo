/* 面试题收集 · 应用逻辑（无依赖，只读渲染 interview-questions.data.js） */
(function () {
  'use strict';

  var TKEY = 'kh_interview_theme';
  var CATS = ['RAG / 检索', 'Agent / 工作流', '提示词工程', '评测 / 观测', '数据库 / 存储', 'NestJS / 工程化', '系统设计', '权限 / 安全', '其他'];
  var DIFFS = ['简单', '中等', '困难'];
  var STATUSES = ['待复习', '复习中', '已掌握'];
  var SC = { 待复习: 'red', 复习中: 'amber', 已掌握: 'green' };
  var DC = { 简单: 'green', 中等: 'amber', 困难: 'red' };

  var S = { items: [], q: '', status: '', cat: '', diff: '', open: {} };
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 工具 ---------- */
  function uid() { return 'q-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function normalize(it) {
    return {
      id: it && it.id ? String(it.id) : uid(),
      title: (it && it.title ? String(it.title) : '').trim(),
      cat: CATS.indexOf(it && it.cat) > -1 ? it.cat : '其他',
      diff: DIFFS.indexOf(it && it.diff) > -1 ? it.diff : '中等',
      status: STATUSES.indexOf(it && it.status) > -1 ? it.status : '待复习',
      tags: Array.isArray(it && it.tags) ? it.tags.map(String).map(function (t) { return t.trim(); }).filter(Boolean) : [],
      answer: (it && it.answer) || '',
      follow: (it && it.follow) || '',
      note: (it && it.note) || ''
    };
  }

  /* ---------- 极简 Markdown ---------- */
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

  /* ---------- 筛选 ---------- */
  function match(it) {
    if (S.status && it.status !== S.status) return false;
    if (S.cat && it.cat !== S.cat) return false;
    if (S.diff && it.diff !== S.diff) return false;
    if (S.q) {
      var hay = [it.title, it.answer, it.follow, it.note, it.cat, it.tags.join(' ')].join('\n').toLowerCase();
      var parts = S.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < parts.length; i++) if (hay.indexOf(parts[i]) === -1) return false;
    }
    return true;
  }
  function visible() {
    /* 列表顺序 = data.js 的书写顺序，不再按时间/置顶重排 */
    return S.items.filter(match);
  }

  /* ---------- 渲染 ---------- */
  function renderStats() {
    var total = S.items.length;
    var n = { 待复习: 0, 复习中: 0, 已掌握: 0 };
    S.items.forEach(function (it) { n[it.status]++; });
    var pct = function (v) { return total ? (v / total * 100).toFixed(1) + '%' : '0%'; };
    $('stats').innerHTML =
      '<div class="row"><span>题目总数</span><b>' + total + '</b></div>' +
      '<div class="row"><span>待复习</span><b>' + n['待复习'] + '</b></div>' +
      '<div class="row"><span>复习中</span><b>' + n['复习中'] + '</b></div>' +
      '<div class="row"><span>已掌握</span><b>' + n['已掌握'] + '</b></div>' +
      '<div class="bar">' +
      '<i style="width:' + pct(n['已掌握']) + ';background:var(--ok)"></i>' +
      '<i style="width:' + pct(n['复习中']) + ';background:var(--warn)"></i>' +
      '<i style="width:' + pct(n['待复习']) + ';background:var(--border-strong)"></i>' +
      '</div>';
  }
  function renderFilters() {
    var build = function (host, label, values, field) {
      var counts = {}; values.forEach(function (v) { counts[v] = 0; });
      S.items.forEach(function (it) { if (counts[it[field]] != null) counts[it[field]]++; });
      var html = '<li><button data-f="' + field + '" data-v="" class="' + (S[field] ? '' : 'active') +
        '">' + label + '<span class="cnt">' + S.items.length + '</span></button></li>';
      values.forEach(function (v) {
        html += '<li><button data-f="' + field + '" data-v="' + esc(v) + '" class="' + (S[field] === v ? 'active' : '') +
          '">' + esc(v) + '<span class="cnt">' + counts[v] + '</span></button></li>';
      });
      host.innerHTML = html;
    };
    build($('fStatus'), '全部', STATUSES, 'status');
    build($('fCat'), '全部', CATS, 'cat');
    build($('fDiff'), '全部', DIFFS, 'diff');
  }
  function renderList() {
    var list = visible();
    $('lsub').textContent = '共 ' + list.length + ' 题' + (S.q ? '（搜索：' + S.q + '）' : '');
    if (!list.length) {
      $('list').innerHTML = '<div class="empty"><div class="big">🗂️</div><h3>' +
        (S.items.length ? '没有匹配的题目' : '还没有收集任何面试题') + '</h3><p>' +
        (S.items.length ? '换个关键词或清空筛选条件试试。' : '往 js/interview-questions.data.js 里加题，刷新页面即可。') +
        '</p></div>';
      return;
    }
    var all = S.items;
    $('list').innerHTML = list.map(function (it) {
      var no = all.indexOf(it) + 1;
      var tags = it.tags.map(function (t) { return '<span class="pill">#' + esc(t) + '</span>'; }).join('');
      var open = S.open[it.id] ? ' open' : '';
      return '<article class="q' + open + '" data-id="' + esc(it.id) + '">' +
        '<div class="qh">' +
        '<div class="qno">' + no + '</div>' +
        '<div class="qm"><p class="qt">' + esc(it.title) + '</p><div class="qmeta">' +
        '<span class="pill blue">' + esc(it.cat) + '</span>' +
        '<span class="pill ' + (DC[it.diff] || '') + '">' + esc(it.diff) + '</span>' +
        '<span class="pill ' + (SC[it.status] || '') + '">' + esc(it.status) + '</span>' + tags +
        '</div></div>' +
        '</div>' +
        '<div class="qb">' +
        block('answer', '参考答案', it.answer) +
        block('follow', '可能的追问', it.follow) +
        block('note', '我的笔记 / 项目对应实现', it.note) +
        '</div></article>';
    }).join('');
  }
  function block(cls, label, text) {
    return '<div class="blk ' + cls + '"><h5>' + label + '</h5><div class="md">' +
      (text && text.trim() ? md(text) : '<p style="color:var(--muted)">（暂未填写）</p>') + '</div></div>';
  }
  function render() { renderStats(); renderFilters(); renderList(); }

  /* ---------- 事件 ---------- */
  $('list').addEventListener('click', function (e) {
    var card = e.target.closest('.q');
    if (!card) return;
    if (e.target.closest('.qb')) return;
    var id = card.dataset.id;
    S.open[id] = !S.open[id];
    card.classList.toggle('open');
  });

  ['fStatus', 'fCat', 'fDiff'].forEach(function (hostId) {
    $(hostId).addEventListener('click', function (e) {
      var b = e.target.closest('button[data-f]');
      if (!b) return;
      S[b.dataset.f] = b.dataset.v;
      render();
    });
  });

  var t;
  $('search').addEventListener('input', function (e) {
    clearTimeout(t);
    var v = e.target.value;
    t = setTimeout(function () { S.q = v.trim(); renderList(); }, 160);
  });
  $('bOpenAll').addEventListener('click', function () {
    visible().forEach(function (it) { S.open[it.id] = true; }); renderList();
  });
  $('bCloseAll').addEventListener('click', function () { S.open = {}; renderList(); });
  $('bReset').addEventListener('click', function () {
    S.q = ''; S.status = ''; S.cat = ''; S.diff = ''; $('search').value = ''; render();
  });

  $('bTheme').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', cur);
    try { localStorage.setItem(TKEY, cur); } catch (e) {}
  });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('search').focus(); }
  });

  /* ---------- 启动 ---------- */
  (function init() {
    try {
      var saved = localStorage.getItem(TKEY);
      if (saved) document.documentElement.setAttribute('data-theme', saved);
    } catch (e) {}
    /* 数据源固定为 docs/js/interview-questions.data.js，不再读 localStorage 里的题目 */
    S.items = (window.KHQ_SEED || []).map(normalize);
    if (S.items.length) S.open[S.items[0].id] = true;
    render();
  })();
})();
