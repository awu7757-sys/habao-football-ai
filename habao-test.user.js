// ==UserScript==
// @name HABAO HD5577 Floating Assistant TEST
// @namespace https://github.com/awu7757-sys/habao-football-ai
// @version 0.4.0
// @description HD5577/DG overlay interaction test only. No account or gameplay access.
// @match https://hd5577.com/*
// @match https://www.hd5577.com/*
// @match https://cn.dingdangmail.com/*
// @match https://new-dd-cn.ahsy114.com/*
// @grant none
// @run-at document-idle
// ==/UserScript==
(function () {
  'use strict';
  if (document.getElementById('habao-demo-fab')) return;
  const host=document.createElement('div');
  host.id='habao-demo-fab';
  host.style.cssText='position:fixed;left:calc(100vw - 76px);top:calc(100dvh - 180px);z-index:2147483647;pointer-events:none;';
  const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML=`<style>*{box-sizing:border-box;font-family:system-ui,sans-serif}#ball{touch-action:none;pointer-events:auto;cursor:grab;background:linear-gradient(135deg,#f5d885,#ae7621);color:#221607;border:2px solid #ffecc2;border-radius:50%;width:54px;height:54px;font-size:25px;box-shadow:0 4px 16px #0007}#panel{display:none;pointer-events:auto;position:absolute;width:min(310px,calc(100vw - 24px));background:#101927;color:white;border:1px solid #c8a55e;border-radius:14px;padding:16px;box-shadow:0 5px 20px #0008;font-size:14px;line-height:1.7}#panel b{color:#f1ce82}#close{background:#dec079;border:0;border-radius:8px;padding:8px;margin-top:12px}</style><button id="ball" type="button" aria-label="HABAO AI">✦</button><div id="panel"><b>HABAO AI 浮窗測試 V0.4</b><p>按鈕可拖曳，點擊可展開。本版尚未串接雲端讀牌或登入。</p><button id="close" type="button">收起</button></div>`;
  document.documentElement.appendChild(host);
  const ball=shadow.getElementById('ball'),panel=shadow.getElementById('panel');
  function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
  function place(){
    const x=clamp(parseFloat(host.style.left)||0,8,Math.max(8,innerWidth-62));
    const y=clamp(parseFloat(host.style.top)||0,8,Math.max(8,innerHeight-62));
    host.style.left=x+'px';host.style.top=y+'px';
    panel.style.left=(x+54+12>innerWidth?Math.min(0,innerWidth-x-12-310):0)+'px';
    panel.style.top=(y>220?'-192px':'65px');
  }
  place();
  addEventListener('resize',place);
  let down=null,suppress=false;
  ball.addEventListener('pointerdown',e=>{
    down={id:e.pointerId,x:e.clientX,y:e.clientY,l:parseFloat(host.style.left),t:parseFloat(host.style.top),moved:false};
    ball.setPointerCapture(e.pointerId);
  });
  ball.addEventListener('pointermove',e=>{
    if(!down||e.pointerId!==down.id)return;
    const dx=e.clientX-down.x,dy=e.clientY-down.y;
    if(Math.hypot(dx,dy)>7)down.moved=true;
    if(down.moved){host.style.left=clamp(down.l+dx,8,Math.max(8,innerWidth-62))+'px';host.style.top=clamp(down.t+dy,8,Math.max(8,innerHeight-62))+'px';place();}
  });
  ball.addEventListener('pointerup',e=>{if(!down)return;suppress=down.moved;down=null;});
  ball.addEventListener('click',()=>{if(suppress){suppress=false;return;}panel.style.display=panel.style.display==='block'?'none':'block';place();});
  shadow.getElementById('close').addEventListener('click',()=>panel.style.display='none');
})();