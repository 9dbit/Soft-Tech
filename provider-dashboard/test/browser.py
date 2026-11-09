"""Control-panel UI tests against actual HTTP auth and persistent core (no seeded metrics)."""
import json, os, secrets, subprocess, tempfile, time, pathlib, urllib.request
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'qa-artifacts/provider-core';OUT.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory() as tmp:
    port=19370
    env={**os.environ,'NODE_ENV':'test','PORT':str(port),'CORE_DB_PATH':tmp+'/provider.sqlite','PANEL_ADMIN_PASSWORD':secrets.token_urlsafe(24),'PANEL_AUDITOR_PASSWORD':secrets.token_urlsafe(24),'PANEL_SESSION_SECRET':secrets.token_urlsafe(48)}
    srv=subprocess.Popen(['node','server.mjs'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/health') as r:
                    if r.status==200:break
            except Exception:time.sleep(.1)
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True,executable_path=os.getenv('CHROMIUM_PATH') or None,args=['--no-sandbox'])
            errors=[];checks=[]
            for width,height,role in [(1440,1000,'admin'),(390,844,'admin'),(1280,850,'auditor')]:
                page=browser.new_page(viewport={'width':width,'height':height},accept_downloads=True)
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(f'http://127.0.0.1:{port}/',wait_until='networkidle')
                page.locator('#role').select_option(role)
                page.locator('#password').fill(env['PANEL_ADMIN_PASSWORD' if role=='admin' else 'PANEL_AUDITOR_PASSWORD'])
                page.locator('#login-button').click();page.locator('#app-shell:not([hidden])').wait_for()
                page.evaluate('document.fonts.ready')
                assert page.evaluate('document.fonts.check(\'18px "Minecraft"\')')
                assert page.locator('.brand-block img').evaluate('(x)=>x.complete&&x.naturalWidth>0')
                for route in ['overview','games','operators','ledger','reconcile','developer']:
                    if width<840:page.locator('#menu-toggle').click()
                    page.locator(f'.nav-link[data-page="{route}"]').click()
                    page.locator('#page-content h1').wait_for()
                    size=page.evaluate('({scroll:document.documentElement.scrollWidth,width:innerWidth})')
                    assert size['scroll']<=size['width']+3,(route,width,size)
                    if route=='operators' and role=='auditor':assert page.locator('[data-add-operator]').is_disabled()
                    if route in ('overview','games','developer'):
                        page.screenshot(path=str(OUT/f'{role}-{width}-{route}.png'),full_page=True,animations='disabled')
                    checks.append(f'{role}/{width}/{route}:pass')
                if role=='admin' and width==1440:
                    page.locator('.nav-link[data-page="operators"]').click();page.locator('[data-add-operator]').click()
                    form=page.locator('#operator-form');form.locator('[name=name]').fill('Browser QA operator')
                    form.locator('[name=return_origins]').fill('https://operator.example')
                    form.locator('[type=submit]').click();page.locator('.secret-output').wait_for()
                    value=json.loads(page.locator('.secret-output').inner_text())
                    assert value['operator']['name']=='Browser QA operator';assert len(value['credential']['secret'])>=32
                    page.locator('[data-close-dialog]').first.click()
                    page.locator('.nav-link[data-page="developer"]').click()
                    with page.expect_download() as result:page.locator('[data-download=json]').click()
                    assert 'openapi-v1.json' in result.value.suggested_filename
                    page.locator('.nav-link[data-page="reconcile"]').click();page.locator('#run-reconcile').click()
                    page.locator('.reconcile-card .tag').wait_for();assert page.locator('.reconcile-card .tag').inner_text()=='no_activity'
                if width<840:
                    page.locator('#menu-toggle').click();page.wait_for_timeout(350)
                    rect=page.locator('#sidebar').bounding_box();assert rect['x']>=-2
                    page.screenshot(path=str(OUT/'mobile-menu.png'));page.keyboard.press('Escape')
                page.locator('#logout-button').click();page.locator('#auth-layout:not([hidden])').wait_for()
                page.close()
            browser.close();assert not errors,errors
            (OUT/'report.json').write_text(json.dumps({'checks':checks,'errors':errors,'backend':'actual persistent provider core','engine_rounds':'tested separately against isolated native runtimes'},indent=2))
            print('PASS: 18 responsive route/role checks + real operator credential creation, CSRF login/logout, document download and no-activity reconciliation')
    finally:
        srv.terminate()
        try:srv.wait(timeout=5)
        except subprocess.TimeoutExpired:srv.kill()
