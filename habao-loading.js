/* HABAO shared lightweight loading feedback - UI only
   頁面在 <body data-habao-loading="bar"> 時只顯示頂部進度條，不顯示底部提示（該頁已有自己的載入文字）。
   2026-11-22：畫面上已有自己的讀取提示（.habao-history-loading 或 [data-own-loading]）時，也只顯示頂部進度條，避免出現兩個「讀取中」。 */
(function () {
  'use strict';
  if (window.HABAO_LOADING) return;
  // 2026-11-15：使用者要求切換時清楚看出正在緩衝 → 縮短延遲、加大提示、加頂部進度條。
  const DELAY = 120;
  const ID = 'habao-mini-loading';
  const BAR = 'habao-top-progress';
  let timer = null, timeout = null, seq = 0, pending = 0, recent = null;
  const css = `
#${ID}{position:fixed;bottom:calc(96px + env(safe-area-inset-bottom,0px));left:50%;transform:translate(-50%,8px);z-index:2147483000;display:flex;align-items:center;gap:10px;padding:11px 18px;border:1px solid rgba(242,189,75,.55);border-radius:999px;background:rgba(7,13,21,.96);box-shadow:0 10px 32px rgba(0,0,0,.45),0 0 0 4px rgba(242,189,75,.08);color:#ffd877;font:700 14px/1.2 system-ui,"Noto Sans TC",sans-serif;letter-spacing:.02em;pointer-events:none;opacity:0;transition:opacity .15s,transform .15s}
#${ID}.visible{opacity:1;transform:translate(-50%,0)}
#${ID} .habao-mini-ring{width:20px;height:20px;border:2.5px solid rgba(242,189,75,.22);border-top-color:#f2bd4b;border-right-color:#f2bd4b;border-radius:50%;animation:habao-mini-spin .7s linear infinite;flex:none}
#${BAR}{position:fixed;top:0;left:0;right:0;height:3px;z-index:2147483001;pointer-events:none;opacity:0;transition:opacity .15s;overflow:hidden;background:rgba(242,189,75,.12)}
#${BAR}.visible{opacity:1}
#${BAR}::before{content:"";position:absolute;top:0;bottom:0;left:-40%;width:40%;background:linear-gradient(90deg,transparent,#f2bd4b,#ffe08a,#f2bd4b,transparent);animation:habao-bar-slide 1s ease-in-out infinite}
@keyframes habao-mini-spin{to{transform:rotate(360deg)}}
@keyframes habao-bar-slide{to{left:100%}}
@media(prefers-reduced-motion:reduce){#${ID} .habao-mini-ring{animation-duration:2s}#${BAR}::before{animation-duration:2.5s}}
`;
  function language() {
    const value = String(localStorage.getItem('habao_lang') || localStorage.getItem('habao_language') || document.documentElement.lang || '').toLowerCase();
    return value.includes('en') ? 'Loading…' : (value.includes('hans') || value.includes('cn') || value.includes('zh-cn') || value.includes('simplified')) ? '加载中…' : '載入中…';
  }
  function node() {
    if (!document.body) return null;
    let n = document.getElementById(ID);
    if (!n) {
      n = document.createElement('div'); n.id = ID; n.setAttribute('role','status'); n.setAttribute('aria-live','polite');
      n.innerHTML = '<span class="habao-mini-ring" aria-hidden="true"></span><span class="habao-mini-label"></span>';
      document.body.appendChild(n);
    }
    n.querySelector('.habao-mini-label').textContent = language();
    if (!document.getElementById(BAR)) {
      const bar = document.createElement('div'); bar.id = BAR; bar.setAttribute('aria-hidden','true');
      document.body.appendChild(bar);
    }
    return n;
  }
  function hide() {
    clearTimeout(timer);clearTimeout(timeout);timer=null;timeout=null;
    const n = document.getElementById(ID); if(n)n.classList.remove('visible');
    const b = document.getElementById(BAR); if(b)b.classList.remove('visible');
  }
  function show() {
    const id = ++seq;hide();
    timer = setTimeout(() => { if(id!==seq)return;const n=node();const barOnly=document.body&&(document.body.dataset.habaoLoading==='bar'||!!document.querySelector('.habao-history-loading,[data-own-loading]'));if(n&&!barOnly)n.classList.add('visible');const b=document.getElementById(BAR);if(b)b.classList.add('visible'); },DELAY);
    timeout = setTimeout(() => { if(id===seq){++seq;pending=0;hide();} },30000);
    return id;
  }
  function stop(id) { if(id && id!==seq)return; ++seq;pending=0;hide(); }
  function watch(p) {
    pending++;
    if(pending===1)show();
    return Promise.resolve(p).finally(() => { pending=Math.max(0,pending-1); if(!pending)stop(); });
  }
  window.HABAO_LOADING = { show,hide:stop,track:watch };
  const style = document.createElement('style'); style.textContent=css;document.head.appendChild(style);
  document.addEventListener('click', e => {
    const el=e.target.closest('a[href],button,[role="button"]');
    if(!el || el.disabled || el.getAttribute('aria-disabled')==='true')return;
    const a=el.closest('a[href]');
    if(a){
      const href=a.getAttribute('href') || '';
      if(href.startsWith('#') || a.hasAttribute('download') || a.target==='_blank' || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button!==0)return;
      try{const u=new URL(a.href,location.href);if(u.protocol==='http:' || u.protocol==='https:'){queueMicrotask(()=>{if(!e.defaultPrevented)show();});return;}}catch(_){}
    }
    recent=Date.now();
  },true);
  document.addEventListener('submit', e => {if(!e.defaultPrevented)recent=Date.now();},true);
  const originalFetch=window.fetch;
  if(typeof originalFetch==='function'){
    window.fetch=function(...args){
      const related=recent && Date.now()-recent<1400;
      let result;
      try{ result=originalFetch.apply(this,args); }catch(err){throw err;}
      if(!related)return result;
      pending++;
      if(pending===1)show();
      return Promise.resolve(result).finally(()=>{pending=Math.max(0,pending-1);if(pending===0)stop();});
    };
  }
  window.addEventListener('pageshow',()=>stop());
  window.addEventListener('pagehide',()=>stop());
  window.addEventListener('habao:languagechange',()=>{const n=document.getElementById(ID);if(n)n.querySelector('.habao-mini-label').textContent=language();});
})();
