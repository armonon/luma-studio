import assert from 'node:assert/strict';
const { chromium } = await import(process.env.LUMA_PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.LUMA_RELEASE_URL ?? 'http://localhost:4213';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const [route, width] of [['/studio', 1440], ['/ipad', 820], ['/iphone', 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(() => localStorage.setItem('luma.scripting', 'on'));
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    assert.equal((await page.goto(base + route)).status(), 200);
    await page.waitForFunction(() => Boolean(window.luma?.studio));
    await page.waitForFunction(() => { const button = document.querySelector('.studio-import-button') ?? document.querySelector('.studio-phone-save'); return button && !button.disabled; });
    const phone = route === '/iphone';
    if (phone) await page.getByLabel('More application actions').click();
    else {
      const menu = page.getByRole('menubar');
      assert.equal(await menu.getByRole('menuitem').count(), 8);
      await menu.getByRole('menuitem', { name: 'File', exact: true }).focus();
      await page.keyboard.press('ArrowDown');
      await page.waitForFunction(() => document.activeElement.textContent === 'Import images…');
      await page.keyboard.press('ArrowRight');
      await page.getByRole('menu', { name: 'Edit', exact: true }).waitFor();
      await page.waitForFunction(() => document.activeElement.closest('[role=menu]')?.getAttribute('aria-label') === 'Edit');
      await page.keyboard.press('Escape');
      await page.getByRole('menu').waitFor({state: 'hidden'});
      await menu.getByRole('menuitem', { name: 'File', exact: true }).click();
    }
    if (!phone) {
      const header = await page.locator('.studio-titlebar').boundingBox();
      const workspace = await page.locator('.spatial-workspace').boundingBox();
      assert.ok(workspace.y >= header.y + header.height, 'Menu bar must not cover the workspace');
    }
    const start = await page.evaluate(() => window.luma.studio.doc.layers.length);
    const data = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff5500'; ctx.fillRect(0, 0, 32, 32);
      return canvas.toDataURL().split(',')[1];
    });
    const files = ['first.png', 'second.png'].map(name => ({name, mimeType: 'image/png', buffer: Buffer.from(data, 'base64')}));
    const picker = page.waitForEvent('filechooser');
    await page.getByRole(phone ? 'button' : 'menuitem', { name: 'Import images…', exact: true }).click();
    const chooser = await picker; assert.equal(chooser.isMultiple(), true); await chooser.setFiles(files);
    await page.waitForFunction(count => window.luma.studio.doc.layers.length === count + 2, start);
    // The workspace drop path must keep importing into the current document.
    await page.evaluate(data => {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'dropped.png', {type:'image/png'}));
      window.dispatchEvent(new DragEvent('drop', {dataTransfer: transfer, bubbles: true, cancelable: true}));
    }, data);
    await page.waitForFunction(count => window.luma.studio.doc.layers.length === count + 3, start);
    if (!phone) {
      await page.getByRole('menuitem', {name:'Edit', exact:true}).click();
      await page.getByRole('menuitem', {name:'Undo', exact:true}).click();
      await page.waitForFunction(count => window.luma.studio.doc.layers.length === count + 2, start);
      await page.getByRole('menuitem', {name:'Edit', exact:true}).click();
      await page.getByRole('menuitem', {name:'Redo', exact:true}).click();
      await page.waitForFunction(count => window.luma.studio.doc.layers.length === count + 3, start);
      await page.getByRole('menuitem', {name:'File', exact:true}).click();
      const box = await page.getByRole('menu', {name:'File', exact:true}).boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 900);
      await page.screenshot({path:`/tmp/luma-menu-${width}.png`});
      await page.mouse.click(width - 20, 400);
      await page.getByRole('menu').waitFor({state: 'hidden'});
    }
    assert.deepEqual(errors, []);
    console.log('PASS', route, width, 'menu navigation, multi-image import, canvas drop, no page errors');
    await context.close();
  }
} finally { await browser.close(); }
