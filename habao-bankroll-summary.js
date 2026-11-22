/* =====================================================================
   HABAO 投注資金工具：本期摘要（2026-11-22，PROJECT_NOTES §27）
   只在本機讀 localStorage「habao_bet_plan_v1:<account>」，不呼叫任何 API、不上傳。
   給「我的分析」提示列與 AI 工具箱卡片使用；計算口徑與 bet-plan.html 相同
   （7 天一期、從 cycle_start 起算；舊資料沿用週一；損益五種結果）。
===================================================================== */
(function () {
  "use strict";
  function twDate(ms) { return new Date(ms + 8 * 3600e3).toISOString().slice(0, 10); }
  function weekStart(ms) { var d = new Date(ms + 8 * 3600e3), wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10); }
  function addDays(ds, n) { return new Date(Date.parse(ds + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10); }
  function periodStart(d, ms) {
    var start = d && d.cycle_start;
    if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return d && (d.weekly_budget || (d.bets && d.bets.length)) ? weekStart(ms) : twDate(ms);
    var diff = Math.floor((Date.parse(twDate(ms) + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400e3);
    return diff < 0 ? start : addDays(start, Math.floor(diff / 7) * 7);
  }
  function profit(stake, odds, r) {
    stake = Number(stake) || 0; odds = Number(odds) || 0;
    return r === "win" ? stake * (odds - 1) : r === "half_win" ? stake * (odds - 1) / 2 : r === "half_loss" ? -stake / 2 : r === "loss" ? -stake : 0;
  }
  function summary(account, now) {
    now = now || Date.now();
    var d = null;
    try { d = JSON.parse(localStorage.getItem("habao_bet_plan_v1:" + String(account || "anon")) || "null"); } catch (e) {}
    if (!d || typeof d !== "object" || !Array.isArray(d.bets)) return { hasBudget: false, bets: 0, open: 0, due: 0, settled: 0, pl: 0 };
    var ps = periodStart(d, now), list = d.bets.filter(function (b) { return b.week_start === ps && b.result !== "void"; });
    var settled = list.filter(function (b) { return b.result; }), open = list.filter(function (b) { return !b.result; });
    return {
      hasBudget: !!d.weekly_budget, periodStart: ps, periodEnd: addDays(ps, 6), bets: list.length,
      open: open.length, due: open.filter(function (b) { return Date.parse(b.kickoff) + 2.5 * 3600e3 < now; }).length,
      settled: settled.length, pl: Math.round(settled.reduce(function (t, b) { return t + profit(b.stake, b.odds, b.result); }, 0))
    };
  }
  /* 依使用狀況決定入口：沒設定預算 → ① 預算計算；有已完賽未結算 → ③ 週報；其他 → ② 本期分配 */
  function entryHref(account) {
    var s = summary(account);
    if (!s.hasBudget) return "budget-calculator.html";
    if (s.due > 0) return "bet-plan.html#report";
    return "bet-plan.html#plan";
  }
  window.HabaoBankroll = { summary: summary, entryHref: entryHref };
})();
