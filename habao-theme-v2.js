/* =====================================================================
   HABAO 全站風格 v2：外觀互動（2026-11-21，PROJECT_NOTES §25）
   只處理顯示：LINE 客服史萊姆邊條、數字載入閃光、無資料球類提示。
   不呼叫 API、不改資料、不改任何功能流程；連結網址維持原樣。
===================================================================== */
(() => {
  "use strict";
  const page = document.body?.dataset?.hbPage || "";

  /* 0. LINE 客服：使用者要求每個畫面都顯示（2026-11-22）。頁面本身沒有時才補上；連結與首頁完全相同（未改 LINE 連結）。 */
  if (page && !document.querySelector(".habao-support-float")) {
    const a = document.createElement("a");
    a.className = "habao-support-float";
    a.href = "https://line.me/R/ti/p/@804dlhod";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.setAttribute("aria-label", "LINE 客服");
    a.innerHTML = '<span class="habao-support-float-button"><svg class="habao-support-line-icon" viewBox="0 0 64 64" aria-hidden="true"><path fill="#ffffff" d="M32 11C19.3 11 9 19.3 9 29.5c0 9.2 8.2 16.9 19.3 18.3.8.2 1.9.6 2.2 1.3.3.6.2 1.6.1 2.2l-.4 2.1c-.1.6-.5 2.4 2.1 1.3 2.6-1.1 14.1-8.3 19.2-14.2 3.5-3.9 5.5-7.9 5.5-11C57 19.3 46.7 11 32 11Z"/><text x="32" y="34.5" text-anchor="middle" fill="#06C755" font-size="12.5" font-family="Arial, Helvetica, sans-serif" font-weight="900" letter-spacing="-.5">LINE</text></svg></span><span class="habao-support-float-label">客服</span>';
    document.body.appendChild(a);
  }

  /* 0b. 智能投注配置：金色史萊姆（VIP 才顯示，2026-11-22 使用者要求）。點一下彈出兩個選項：開始配置／週報表。
         只讀 sessionStorage 會員等級與本機 localStorage 是否設定過預算，不呼叫 API。 */
  (function () {
    if (!page || page === "login" || document.querySelector(".hb-bet-slime")) return;
    let m = null;
    try { m = JSON.parse(sessionStorage.getItem("habao_member") || "null"); } catch (e) {}
    if (!m || !m.account || String(m.member_level || "normal").toLowerCase() !== "vip") return;
    let hasBudget = false;
    try { const d = JSON.parse(localStorage.getItem("habao_bet_plan_v1:" + m.account) || "null"); hasBudget = !!(d && d.weekly_budget); } catch (e) {}
    const wrap = document.createElement("div");
    wrap.className = "hb-bet-slime";
    wrap.innerHTML =
      '<button type="button" class="hb-bet-slime-ball" aria-label="智能投注配置" aria-expanded="false">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V10M10 19V5M16 19v-6M21 19H3"/></svg>' +
      '</button>' +
      '<div class="hb-bet-slime-menu" role="menu">' +
        '<a role="menuitem" href="' + (hasBudget ? "bet-plan.html#plan" : "budget-calculator.html") + '"><b>開始配置</b><small>' + (hasBudget ? "本期分配" : "從預算計算開始") + '</small></a>' +
        '<a role="menuitem" href="bet-plan.html#report"><b>週報表</b><small>本期損益與結算</small></a>' +
      '</div>';
    document.body.appendChild(wrap);
    const ball = wrap.querySelector(".hb-bet-slime-ball");
    const set = (open) => { wrap.classList.toggle("is-open", open); ball.setAttribute("aria-expanded", open ? "true" : "false"); };
    ball.addEventListener("click", (e) => { e.stopPropagation(); set(!wrap.classList.contains("is-open")); });
    wrap.querySelectorAll(".hb-bet-slime-menu a").forEach((a) => a.addEventListener("click", () => set(false)));
    document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) set(false); }, true);
    window.addEventListener("scroll", () => { if (wrap.classList.contains("is-open")) set(false); }, { passive: true });
  })();

  /* 1. LINE 客服：平常黏在右邊像史萊姆，第一次點會彈出，再點才開 LINE */
  const slime = document.querySelector(".habao-support-float");
  if (slime) {
    slime.classList.add("hb-slime");
    let timer = 0;
    const close = () => { slime.classList.remove("is-open"); clearTimeout(timer); };
    slime.addEventListener("click", (e) => {
      if (!slime.classList.contains("is-open")) {
        e.preventDefault();
        slime.classList.add("is-open");
        clearTimeout(timer);
        timer = setTimeout(close, 4000);
      }
    });
    document.addEventListener("click", (e) => { if (!slime.contains(e.target)) close(); }, true);
    window.addEventListener("scroll", () => { if (slime.classList.contains("is-open")) close(); }, { passive: true });
  }

  /* 2. 首頁統計數字：還是「--」時顯示閃光條，而不是兩條槓 */
  if (page === "home") {
    const mark = (el) => el.classList.toggle("hb-loading", /^\s*-{1,2}\s*$/.test(el.textContent || ""));
    document.querySelectorAll(".quick-value").forEach((el) => {
      mark(el);
      new MutationObserver(() => mark(el)).observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  /* 3. AI 戰績：目前球類已驗證 0 場時，用一張提示卡取代一整頁的「--」 */
  if (page === "performance") {
    const num = document.getElementById("verifiedMatches");
    const bar = document.querySelector(".summarybar");
    if (num && bar) {
      const note = document.createElement("section");
      note.className = "hb-empty-sport";
      note.hidden = true;
      bar.insertAdjacentElement("afterend", note);
      const names = { football: "足球", basketball: "NBA", baseball: "MLB" };
      const update = () => {
        const sport = document.querySelector(".sport-tab.active")?.dataset?.sport || "";
        const empty = String(num.textContent || "").trim() === "0";
        document.body.classList.toggle("hb-perf-empty", empty);
        note.hidden = !empty;
        if (empty) {
          const name = names[sport] || "此球類";
          note.innerHTML = '<div class="hb-empty-icon">' + (sport === "baseball" ? "⚾" : sport === "basketball" ? "🏀" : "⚽") +
            '</div><b>' + name + (sport === "baseball" ? " 休賽中" : " 樣本累積中") + '</b>' +
            '<p>目前這個區間還沒有已驗證的賽事，' + (sport === "baseball" ? "開季後" : "有賽果後") + '會自動更新公開戰績。</p>';
        }
      };
      new MutationObserver(update).observe(num, { childList: true, characterData: true, subtree: true });
      document.querySelectorAll(".sport-tab,.filter-btn").forEach((b) => b.addEventListener("click", () => setTimeout(update, 50)));
      update();
    }
  }
})();
