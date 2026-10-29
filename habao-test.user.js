// ==UserScript==
// @name HABAO HD5577 Floating Assistant TEST
// @namespace https://github.com/awu7757-sys/habao-football-ai
// @version 0.3.1
// @description HD5577/DG overlay display test only. No account or gameplay access.
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
  const host = document.createElement('div');
  host.id = 'habao-demo-fab';
  host.style.cssText = 'position:fixed;bottom:100px;right:18px;z-index:2147483647;pointer-events:none';
  const shadow = host.attachShadow({mode:'open'});
  shadow.innerHTML = '<style>*{box-sizing:border-box;font-family:system-ui,sans-serif}button{cursor:pointer}#ball{pointer-events:auto;background:linear-gradient(135deg,#f5d885,#ae7621);color:#221607;border:2px solid #ffecc2;border-radius:50%;width:54px;height:54px;font-size:25px;box-shadow:0 4px 16px #0007}#panel{display:none;pointer-events:auto;position:absolute;right:0;bottom:67px;width:min(310px,85vw);background:#101927;color:#fff;border:1px solid #c8a55e;border-radius:14px;padding:16px;box-shadow:0 5px 20px #0008;font-size:14px;line-height:1.7}#panel b{color:#f1ce82}#panel button{background:#dec079;border:0;border-radius:8px;padding:8px;margin-top:12px}</style><button id="ball" type="button" aria-label="HABAO AI">✦</button><div id="panel"><b>HABAO AI 浮窗測試</b><p>此畫面僅驗證 Safari 能否顯示浮動按鈕，尚未串接雲端 AI。</p><button id="close" type="button">收起</button></div>';
  document.documentElement.appendChild(host);
  const ball=shadow.getElementById('ball'), panel=shadow.getElementById('panel');
  ball.addEventListener('click',()=>{panel.style.display=panel.style.display==='block'?'none':'block'});
  shadow.getElementById('close').addEventListener('click',()=>panel.style.display='none');
})();