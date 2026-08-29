# web/_browsertest.py — E2E browser test: dual-pane comparison + full path + copy + i18n.
import asyncio
from playwright.async_api import async_playwright

URL = "http://localhost:8080"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        ctx = await browser.new_context(viewport={"width": 1500, "height": 1100}, permissions=["clipboard-read", "clipboard-write"])
        page = await ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
        await page.goto(URL, wait_until="networkidle")
        await page.wait_for_timeout(8000)

        out = {}
        out["base_img_src"] = await page.evaluate("document.querySelector('#imgBase').getAttribute('src')")
        out["latest_img_src"] = await page.evaluate("document.querySelector('#imgLatest').getAttribute('src')")
        out["base_img_natural"] = await page.evaluate("document.querySelector('#imgBase').naturalWidth + 'x' + document.querySelector('#imgBase').naturalHeight")
        out["latest_img_natural"] = await page.evaluate("document.querySelector('#imgLatest').naturalWidth + 'x' + document.querySelector('#imgLatest').naturalHeight")
        out["base_img_path"] = await page.evaluate("document.getElementById('pathImgBase').title")
        out["latest_img_path"] = await page.evaluate("document.getElementById('pathImgLatest').title")
        out["base_usd_path"] = await page.evaluate("document.getElementById('pathUsdBase').title")
        out["latest_usd_path"] = await page.evaluate("document.getElementById('pathUsdLatest').title")
        out["usd_base_len"] = await page.evaluate("document.getElementById('usdBase').textContent.length")
        out["usd_latest_len"] = await page.evaluate("document.getElementById('usdLatest').textContent.length")

        # copy button -> reads clipboard
        await page.click('#pathUsdLatest + .copybtn')  # button follows the path span
        await page.wait_for_timeout(300)
        out["clipboard_after_copy"] = await page.evaluate("navigator.clipboard.readText()")

        # language toggle
        await page.click("#langBtn")
        await page.wait_for_timeout(200)
        out["lang"] = await page.evaluate("document.documentElement.lang")
        out["h3_labels"] = await page.evaluate("[...document.querySelectorAll('.pane>h3')].map(h=>h.textContent)")

        print("=== DUAL-PANE CHECKS ===\n")
        for k, v in out.items():
            print(f"{k}: {v}")
        print("\n=== CONSOLE ERRORS ===\n", errors if errors else "none")
        await browser.close()

asyncio.run(main())
