import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright

TARGET = "https://hd5577.com/"
OUTPUT_DIR = Path("probe-output")
OUTPUT_DIR.mkdir(exist_ok=True)


async def main():
    result = {
        "target": TARGET,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "browser_opened": False,
        "public_page_loaded": False,
        "dg_login_tested": False,
        "real_time_card_data_tested": False,
    }

    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                headless=True, args=["--no-sandbox"]
            )
            result["browser_opened"] = True
            context = await browser.new_context(
                viewport={"width": 1100, "height": 900}, locale="zh-TW"
            )
            page = await context.new_page()
            response = await page.goto(
                TARGET, wait_until="domcontentloaded", timeout=25000
            )
            await page.wait_for_timeout(2000)
            result["http_status"] = response.status if response else None
            parsed = urlsplit(page.url)
            result["final_origin"] = f"{parsed.scheme}://{parsed.hostname}"
            result["title"] = (await page.title())[:100]
            body_text = (await page.locator("body").inner_text(timeout=10000)).strip()
            result["page_body_length"] = len(body_text)
            result["public_page_loaded"] = (
                result["http_status"] is not None
                and 200 <= result["http_status"] < 400
                and result["page_body_length"] >= 20
            )
            await page.screenshot(
                path=str(OUTPUT_DIR / "public_page.png"), full_page=False
            )
            # Public navigation diagnostics only. Never log in or enter game tables.
            entry = result["live_entry"] = {
                "attempted": True, "dismissed": False, "clicked": False
            }
            try:
                dismiss = page.get_by_text("不再自動顯示公告", exact=False)
                entry["dismiss_candidates"] = await dismiss.count()
                for i in range(min(entry["dismiss_candidates"], 5)):
                    item = dismiss.nth(i)
                    if await item.is_visible():
                        await item.click(timeout=4000)
                        entry["dismissed"] = True
                        break
                await page.wait_for_timeout(1200)
            except Exception as exc:
                entry["dismiss_error"] = str(exc).splitlines()[0][:240]

            # Screenshot even if navigation is blocked.
            await page.screenshot(
                path=str(OUTPUT_DIR / "after_announcement.png"), full_page=False
            )
            try:
                selectors = [
                    page.get_by_role("link", name="真人", exact=True),
                    page.get_by_text("真人", exact=True),
                    page.locator("a").filter(has_text="真人"),
                ]
                entry["candidate_counts"] = [await s.count() for s in selectors]
                for group in selectors:
                    for i in range(min(await group.count(), 8)):
                        candidate = group.nth(i)
                        if not await candidate.is_visible():
                            continue
                        try:
                            await candidate.click(timeout=5000)
                            entry["clicked"] = True
                            break
                        except Exception as exc:
                            entry["click_error"] = str(exc).splitlines()[0][:240]
                    if entry["clicked"]:
                        break
                await page.wait_for_timeout(1600)
                entry["tab_count"] = len(context.pages)
                entry["origins"] = [
                    urlsplit(tab.url).hostname for tab in context.pages
                ]
                entry["main_page_title"] = (await page.title())[:100]
            except Exception as exc:
                entry["error_type"] = type(exc).__name__
                entry["error"] = str(exc).splitlines()[0][:240]
            finally:
                await page.screenshot(
                    path=str(OUTPUT_DIR / "after_live_click.png"),
                    full_page=False
                )
            
            await browser.close()
    except Exception as exc:
        result["error_type"] = type(exc).__name__
        result["error"] = str(exc).splitlines()[0][:180]

    (OUTPUT_DIR / "result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=False))
    if not result["public_page_loaded"]:
        raise SystemExit(
            "FAIL: HD5577 public page not verified; check result.json and screenshot"
        )


if __name__ == "__main__":
    asyncio.run(main())
