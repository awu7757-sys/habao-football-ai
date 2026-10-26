/* HABAO shared lightweight loading feedback - UI only */
(function () {
  'use strict';
  if (window.HABAO_LOADING) return;
  const DELAY = 230;
  const ID = 'habao-mini-loading';
  let timer = null, timeout = null, seq = 0, pending = 0, recent = null;
  const css = `
#${ID}{position:fixed;bottom:calc(24px + env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:9px;padding:9px 13px;border:1px solid rgba(242,189,75,.35);border-radius:999px;background:rgba(7,13,21,.94);box-shadow:0 6px 25px rgba(0,0,0,.3);color:#f8d47b;font:600 12px/1.2 system-ui,"Noto Sans TC",sans-serif;pointer-events:none;opacity:0;transition:opacity .15s}
#${ID}.visible{opacity:1}
#${ID} .habao-mini-ring{width:19px;height:19px;border:2px solid rgba(242,189,75,.23);border-top-color:#f2bd4b;border-right-color:#f2bd4b;border-radius:50%;animation:habao-mini-spin .75s linear infinite;flex:none}
@keyframes habao-mini-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){#${ID} .habao-mini-ring{animation-duration:2s}}
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
    return n;
  }
  function hide() {
    clearTimeout(timer);clearTimeout(timeout);timer=null;timeout=null;
    const n = document.getElementById(ID); if(n)n.classList.remove('visible');
  }
  function show() {
    const id = ++seq;hide();
    timer = setTimeout(() => { if(id!==seq)return;const n=node();if(n)n.classList.add('visible'); },DELAY);
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
