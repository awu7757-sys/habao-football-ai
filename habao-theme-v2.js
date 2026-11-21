/* =====================================================================
   HABAO 全站風格 v2：外觀互動（2026-11-21，PROJECT_NOTES §25）
   只處理顯示：LINE 客服史萊姆邊條、數字載入閃光、無資料球類提示。
   不呼叫 API、不改資料、不改任何功能流程；連結網址維持原樣。
===================================================================== */
(() => {
  "use strict";
  const page = document.body?.dataset?.hbPage || "";

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
