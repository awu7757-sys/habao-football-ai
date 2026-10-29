import asyncio,json
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlsplit
from playwright.async_api import async_playwright,TimeoutError as PT
URL="https://hd5577.com/"
OUT=Path("probe-output");OUT.mkdir(exist_ok=True)
async def main():
 r={"target":URL,"timestamp_utc":datetime.now(timezone.utc).isoformat(),"browser_opened":False,"public_page_loaded":False,"dg_login_tested":False,"real_time_card_data_tested":False}
 try:
  async with async_playwright() as p:
   b=await p.chromium.launch(headless=True,args=["--no-sandbox"]);r["browser_opened"]=True
   c=await b.new_context(viewport={"width":1100,"height":900},locale="zh-TW")
   page=await c.new_page()
   resp=await page.goto(URL,wait_until="domcontentloaded",timeout=25000)
   r["http_status"]=resp.status if resp else None
   u=urlsplit(page.url);r["final_origin"]=u.scheme+"://"+str(u.hostname)
   r["title"]=(await page.title())[:100]
     r["page_body_length"]=len((await page.locator("body").inner_text(timeout=10000)).strip())
   r["public_page_loaded"]=(r["http_status"] is not None and 200<=r["http_status"]<400 and r["page_body_length"]>=20)
   await page.screenshot(path=str(OUT/"public_page.png"))
   await b.close()
 except Exception as e:r["error_type"]=type(e).__name__;r["error"]=str(e).splitlines()[0][:180]
 (OUT/"result.json").write_text(json.dumps(r,ensure_ascii=False,indent=2))
 print(json.dumps(r,ensure_ascii=False))
 if not r["public_page_loaded"]:\n  raise SystemExit("FAIL: HD5577 public page was not verified as loaded; review result.json and screenshot")
asyncio.run(main())
