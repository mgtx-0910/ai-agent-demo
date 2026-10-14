/* 图片点击放大（lightbox）
 * 用法：页面里引入本脚本即可，正文/配图里任何 <figure> 内的 <img>（含 JS 动态渲染出来的）都能点开看大图。
 * 交互：点图放大 → 再点大图切 1:1 原始尺寸（可滚动） → Esc / 点空白 / 点右上角 × 关闭。
 */
(function () {
  'use strict';
  if (window.__imgZoomReady) return;
  window.__imgZoomReady = true;

  var TRIGGER = 'figure, .figgrid, .figs, .md';

  var st = document.createElement('style');
  st.textContent = [
    'figure img,.figgrid img,.md img{cursor:zoom-in}',
    '.kz{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;',
    'padding:22px;background:rgba(8,10,14,.9);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}',
    '.kz.on{display:flex}',
    '.kz img{width:auto;height:auto;max-width:100%;max-height:calc(100vh - 120px);object-fit:contain;',
    'border-radius:10px;background:#fff;box-shadow:0 18px 60px rgba(0,0,0,.55);cursor:zoom-in}',
    '.kz.real{align-items:flex-start;justify-content:flex-start;overflow:auto;cursor:zoom-out}',
    '.kz.real img{max-width:none;max-height:none;cursor:zoom-out}',
    '.kz-cap{position:fixed;left:0;right:0;bottom:14px;margin:0;padding:0 24px;text-align:center;',
    'font-size:13px;line-height:1.5;color:#e9edf4;pointer-events:none;text-shadow:0 1px 4px rgba(0,0,0,.7)}',
    '.kz-tip{position:fixed;top:18px;left:20px;font-size:12px;color:#b9c2cf;pointer-events:none}',
    '.kz-close{position:fixed;top:12px;right:14px;width:38px;height:38px;padding:0;border-radius:50%;',
    'border:1px solid rgba(255,255,255,.35);background:rgba(20,24,32,.72);color:#fff;font-size:22px;',
    'line-height:1;cursor:pointer}',
    '.kz-close:hover{background:rgba(40,46,58,.9)}',
    '@media(max-width:640px){.kz-tip{display:none}}'
  ].join('');
  document.head.appendChild(st);

  var box = document.createElement('div');
  box.className = 'kz';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', '图片预览');
  box.innerHTML = '<button class="kz-close" type="button" aria-label="关闭">&times;</button>' +
    '<img alt="">' +
    '<span class="kz-tip">点击大图切 1:1 · Esc 关闭</span>' +
    '<p class="kz-cap"></p>';
  document.body.appendChild(box);

  var big = box.querySelector('img');
  var cap = box.querySelector('.kz-cap');
  var btn = box.querySelector('.kz-close');
  var lastFocus = null;

  function open(src, capText) {
    big.src = src;
    big.alt = capText || '';
    cap.textContent = capText || '';
    box.className = 'kz on';
    document.documentElement.style.overflow = 'hidden';
    lastFocus = document.activeElement;
    try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); }
  }

  function close() {
    box.className = 'kz';
    big.removeAttribute('src');
    cap.textContent = '';
    document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
  }

  function captionOf(img) {
    var fig = img.closest ? img.closest('figure') : null;
    var fc = fig ? fig.querySelector('figcaption') : null;
    return ((fc && fc.textContent) || img.alt || '').replace(/\s+/g, ' ').trim();
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || t.nodeType !== 1) return;

    if (t === btn) { close(); return; }

    if (box.classList.contains('on')) {
      if (t === big) { box.classList.toggle('real'); return; }
      if (t === box) { close(); return; }
      if (box.contains(t)) return;
    }

    if (t.tagName === 'IMG' && t.closest && t.closest(TRIGGER)) {
      e.preventDefault();
      open(t.currentSrc || t.getAttribute('src'), captionOf(t));
    }
  });

  // 鼠标移到图上时补一个提示，让"能点开放大"这件事可被发现
  document.addEventListener('pointerover', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && !t.title && t.closest && t.closest(TRIGGER)) t.title = '点击查看大图';
  });

  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.keyCode === 27) && box.classList.contains('on')) close();
  });
})();
