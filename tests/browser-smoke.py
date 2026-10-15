from playwright.sync_api import sync_playwright
import threading,functools,http.server,socketserver
from pathlib import Path
site=Path(__file__).parents[1]/'site'
class ReuseTCPServer(socketserver.TCPServer): allow_reuse_address=True
handler=functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(site))
server=ReuseTCPServer(('127.0.0.1',0),handler)
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
url=f'http://127.0.0.1:{server.server_address[1]}/'
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1400,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(url,wait_until='domcontentloaded');page.wait_for_timeout(800)
    assert 'Calendário Atlas Organizer' in page.locator('#pageTitle').inner_text()
    page.locator('[data-page=settings]').first.click()
    assert page.locator('#atlasGatewayUrl').count()==1
    page.locator('#atlasGatewayUrl').fill('https://example.workers.dev')
    page.locator('#saveGatewayUrl').click()
    assert 'configurado' in page.locator('#atlasGatewayStatus').inner_text().lower()
    page.reload(wait_until='domcontentloaded');page.wait_for_timeout(700)
    page.locator('[data-page=settings]').first.click()
    assert page.locator('#atlasGatewayUrl').input_value()=='https://example.workers.dev'
    assert not errors,errors
    print('BROWSER: carregamento, título, preferências de backend e reload OK')
    browser.close()
server.shutdown()
