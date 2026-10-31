"""Read-only, public HD5577 cloud browser diagnostic.

Runs on GitHub Actions (NOT Cloudflare Browser Run).
No credentials, login submission, gameplay, betting, or private content capture.
"""

import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright

BASE_URL = "https://hd5577.com/"
LOGIN_URL = "https://hd5577.com/login"
OUT = Path("probe-output")
OUT.mkdir(parents=True, exist_ok=True)


def safe_location(url):
    """Never persist query strings, fragments, or URL credentials."""
    parts = urlsplit(url)
    return {"host": parts.hostname, "path": parts.path}


def short_error(exc):
    return (type(exc).__name__ + ": " + str(exc).splitlines()[0])[:250]


async def login_visible(page):
    """Verify a public login form without reading or filling its contents."""
    password_fields = page.locator('input[type="password"]')
    try:
        return await password_fields.count() > 0 and await password_fields.first.is_visible()
    except Exception:
        return False


async def main():
    result = {
        "probe_version": "public-login-0.2",
        "environment": "github-actions-playwright-not-cloudflare",
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "browser_opened": False,
        "public_page_loaded": False,
        "login_page_verified": False,
        "dg_login_tested": False,
        "real_time_card_data_tested": False,
        "credentials_used": False,
        "notes": "Public pages only. No account login, cookies export, game or betting interaction.",
        "steps": {},
    }
    started = time.monotonic()

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
            try:
                response = await page.goto(
                    BASE_URL, wait_until="domcontentloaded", timeout=25000
                )
                await page.wait_for_timeout(1200)
                home = result["steps"]["home"] = {
                    "http_status": response.status if response else None,
                    "location": safe_location(page.url),
                }
                home["visible_body"] = bool(
                    (await page.locator("body").inner_text(timeout=10000)).strip()
                )
                result["public_page_loaded"] = (
                    home["http_status"] is not None
                    and 200 <= home["http_status"] < 400
                    and home["visible_body"]
                    and home["location"]["host"] in {"hd5577.com", "www.hd5577.com"}
                )
                await page.screenshot(
                    path=str(OUT / "public_home.png"), full_page=False
                )
            except Exception as exc:
                result["steps"]["home"] = {"error": short_error(exc)}

            if result["public_page_loaded"]:
                dismissal = result["steps"]["announcement"] = {
                    "attempted": True, "dismissed": False
                }
                try:
                    choices = [
                        page.get_by_text("不再自動顯示公告", exact=True),
                        page.get_by_text("不再自動顯示公告", exact=False),
                    ]
                    for items in choices:
                        for i in range(min(await items.count(), 5)):
                            item = items.nth(i)
                            if await item.is_visible():
                                await item.click(timeout=3500)
                                dismissal["dismissed"] = True
                                break
                        if dismissal["dismissed"]:
                            break
                except Exception as exc:
                    dismissal["error"] = short_error(exc)
                await page.wait_for_timeout(500)
                await page.screenshot(
                    path=str(OUT / "after_announcement.png"), full_page=False
                )

                # First attempt the real public login button, retaining click failures.
                click = result["steps"]["login_button"] = {
                    "attempted": True, "clicked": False
                }
                try:
                    choices = [
                        page.get_by_role("link", name="登入", exact=True),
                        page.get_by_text("登入", exact=True),
                    ]
                    click["candidate_counts"] = [
                        await candidate.count() for candidate in choices
                    ]
                    for choices_group in choices:
                        for i in range(min(await choices_group.count(), 8)):
                            candidate = choices_group.nth(i)
                            if not await candidate.is_visible():
                                continue
                            try:
                                await candidate.click(timeout=5000)
                                click["clicked"] = True
                                break
                            except Exception as exc:
                                click["error"] = short_error(exc)
                        if click["clicked"]:
                            break
                    if click["clicked"]:
                        await page.wait_for_timeout(1000)
                    click["after_click"] = safe_location(page.url)
                except Exception as exc:
                    click["error"] = short_error(exc)
                await page.screenshot(
                    path=str(OUT / "after_login_button.png"), full_page=False
                )

                verified_after_click = (
                    safe_location(page.url)["path"].startswith("/login")
                    and await login_visible(page)
                )
                click["login_form_visible"] = verified_after_click

                # Public route fallback is separate evidence, not proof click worked.
                if not verified_after_click:
                    direct = result["steps"]["direct_login_route"] = {
                        "attempted": True, "loaded": False
                    }
                    try:
                        response = await page.goto(
                            LOGIN_URL, wait_until="domcontentloaded", timeout=25000
                        )
                        await page.wait_for_timeout(1000)
                        direct["http_status"] = response.status if response else None
                        direct["location"] = safe_location(page.url)
                        direct["loaded"] = (
                            direct["http_status"] is not None
                            and 200 <= direct["http_status"] < 400
                            and direct["location"]["path"].startswith("/login")
                            and await login_visible(page)
                        )
                    except Exception as exc:
                        direct["error"] = short_error(exc)
                result["login_page_verified"] = (
                    verified_after_click
                    or result["steps"].get("direct_login_route", {}).get("loaded", False)
                )
                await page.screenshot(
                    path=str(OUT / "public_login.png"), full_page=False
                )
            await context.close()
            await browser.close()
    except Exception as exc:
        result["fatal_error"] = short_error(exc)

    result["elapsed_seconds"] = round(time.monotonic() - started, 1)
    (OUT / "result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=False))
    if not result["public_page_loaded"] or not result["login_page_verified"]:
        raise SystemExit("FAIL: public HD5577 home/login not verified; inspect probe-output/result.json")


if __name__ == "__main__":
    asyncio.run(main())
