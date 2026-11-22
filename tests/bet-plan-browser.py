"""投注分配整合測試（Playwright＋本機 Chrome）。執行：python3 tests/bet-plan-browser.py
涵蓋 GPT 複審 M1～M5：只手動結算不被自動覆寫、改回未結算後不再自動結算、雙分頁確認＋改預算交錯不遺失、
同鍵恢復被擋、全部刪除失敗不清畫面。公開比分 API 以假資料攔截，不連線。"""
import json,time,sys,os
from playwright.sync_api import sync_playwright
ROOT="file://"+os.path.abspath(os.path.join(os.path.dirname(__file__),".."))
now=time.time();iso=lambda t:time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime(t))
KEY="habao_bet_plan_v1:it"
fails=[]
def check(c,msg):
    print(("PASS " if c else "FAIL ")+msg)
    if not c: fails.append(msg)
rows=[{"sport":"football","fixture_id":77,"fixture_time":iso(now+7200),"home_team":"甲","away_team":"乙","v2_stage":"t10","league_name":"英超","result_data":{"analysis":{"recommendations":{"moneyline":{"pick":"主勝"},"btts":{"pick":"是"}}}}}]
init="sessionStorage.setItem('habao_member',JSON.stringify({account:'it',member_level:'vip'}));sessionStorage.setItem('habao_history_cache_v1',JSON.stringify({account:'it',t:1,rows:%s}));"%json.dumps(rows,ensure_ascii=False)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox"])
    ctx=b.new_context(viewport={"width":390,"height":844});ctx.add_init_script(init)
    ctx.route("**/ai-performance*",lambda r:r.fulfill(json={"success":True,"matches":[{"fixture_id":1,"final_score":"2-1","verified_at":"x"},{"fixture_id":2,"final_score":"0-0","verified_at":"x"}]}))
    A=ctx.new_page();A.goto(ROOT+"/bet-plan.html");A.fill("#weekBudget","7000");A.click("#saveBudget");A.wait_for_timeout(200)
    st=A.evaluate(f"JSON.parse(localStorage.getItem('{KEY}'))");ws=st["cycle_start"];td=A.evaluate("window.HabaoBetPlan.twDate(Date.now())")
    check(bool(st.get("periods",{}).get(ws)),"M4 儲存預算時保存該期快照")
    def bet(i,fid,mode="auto",res=None):return {"id":"b%d"%i,"placed_at":iso(now),"placed_date":td,"week_start":ws,"sport":"football","fixture_id":str(fid),"stage":"t10","market":"moneyline","kickoff":iso(now-5*3600),"home":"H","away":"A","rec_pick":"主勝","line":None,"odds":1.9,"stake":100,"settlement_mode":mode,"result":res}
    A.evaluate(f"bs=>{{const d=JSON.parse(localStorage.getItem('{KEY}'));d.bets=bs;localStorage.setItem('{KEY}',JSON.stringify(d));}}",[bet(1,1,"manual"),bet(2,2)])
    A.goto(ROOT+"/bet-plan.html#report");A.wait_for_function("/已自動|沒有可自動|還沒驗證|讀取比分失敗/.test(document.getElementById('autoMsg').textContent)",timeout=8000)
    print("  autoMsg:",A.inner_text("#autoMsg"))
    r=A.evaluate(f"JSON.parse(localStorage.getItem('{KEY}')).bets.map(b=>b.id+':'+b.result)")
    check("b1:None" in [x.replace("null","None") for x in r],"M1 只手動結算的注單不被自動結算")
    check("b2:loss" in r,"M1 一般注單照常自動結算（0-0 主勝＝全輸）")
    # 改回未結算後重整不再被自動結算
    A.locator("button[data-id=b2][data-r='']").click();A.wait_for_timeout(300)
    A.reload();A.wait_for_timeout(1500)
    r=A.evaluate(f"JSON.parse(localStorage.getItem('{KEY}')).bets.find(b=>b.id==='b2')")
    check(r["result"] is None and r["settlement_mode"]=="manual","M1 改回未結算後固定為只手動，重整不被覆寫")
    # M3 同鍵恢復
    A.evaluate(f"()=>{{const d=JSON.parse(localStorage.getItem('{KEY}'));d.bets.push(Object.assign({{}},d.bets[0],{{id:'v1',result:'void',fixture_id:'9'}}),Object.assign({{}},d.bets[0],{{id:'v2',result:null,fixture_id:'9'}}));localStorage.setItem('{KEY}',JSON.stringify(d));}}")
    A.reload();A.wait_for_timeout(800)
    A.locator("button[data-id=v1][data-r='']").click();A.wait_for_timeout(300)
    r=A.evaluate(f"JSON.parse(localStorage.getItem('{KEY}')).bets.find(b=>b.id==='v1').result")
    check(r=="void" and "另一筆有效紀錄" in A.inner_text("#ledgerErr"),"M3 同鍵已有有效紀錄時恢復被擋")
    # M2 雙分頁：A 確認、B 同時改預算，紀錄不可遺失
    A.goto(ROOT+"/bet-plan.html#plan");A.wait_for_timeout(300)
    B=ctx.new_page();B.goto(ROOT+"/bet-plan.html#plan");B.wait_for_timeout(300)
    A.locator("input[type=checkbox]").first.check();A.locator("input[data-f=odds]").first.fill("1.9")
    n0=A.evaluate(f"JSON.parse(localStorage.getItem('{KEY}')).bets.length")
    B.fill("#weekBudget","7500")
    A.evaluate("document.getElementById('confirmBtn').click()");B.evaluate("document.getElementById('saveBudget').click()")
    A.wait_for_timeout(800)
    d=A.evaluate(f"JSON.parse(localStorage.getItem('{KEY}'))")
    check(len(d["bets"])==n0+1 and d["weekly_budget"]==7500,"M2 確認與改預算交錯：新注單與新預算都保留")
    check(A.evaluate("!!(navigator.locks&&navigator.locks.request)"),"環境支援 Web Locks（跨分頁互斥生效）")
    # M5 刪除失敗
    A.goto(ROOT+"/bet-plan.html#report");A.wait_for_timeout(500)
    A.evaluate("()=>{Storage.prototype.removeItem=function(){throw new Error('denied')}}")
    A.click("#wipeBtn");A.click("#wipeBtn");A.wait_for_timeout(300)
    still=A.evaluate(f"localStorage.getItem('{KEY}')!==null")
    check(still and "刪除失敗" in A.inner_text("#ledgerErr") and A.input_value("#weekBudget")!="","M5 刪除失敗時提示、資料與畫面保留")
    b.close()
print("\n%d 項失敗"%len(fails) if fails else "\n全部通過")
sys.exit(1 if fails else 0)
