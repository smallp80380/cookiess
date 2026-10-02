// Native popup from the install ZIP, using only a temporary synthetic profile.
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
const profile = mkdtempSync(path.join(tmpdir(), 'cookiess-popup-smoke-'));
const server = createServer((_, response) => response.end('<!doctype html><title>Synthetic fixture</title>'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
mkdirSync('test-output', { recursive: true });
let context;
const errors = [];
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--no-sandbox', '--enable-unsafe-extension-debugging', `--load-extension=${path.resolve(process.env.EXTENSION_PATH ?? 'dist')}`],
    viewport: { width: 1000, height: 800 },
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const { extensions } = await cdp.send('Extensions.getExtensions');
  const installed = extensions.find((extension) => extension.name === 'Cookiess');
  assert(installed, 'Packaged extension loaded');
  const site = await context.newPage();
  await site.goto(`http://127.0.0.1:${server.address().port}/`);
  const { targetInfos: tabs } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const target = tabs.find((tab) => tab.url === site.url());
  assert(target, 'Synthetic site target exists');
  let seq = 0;
  const pending = new Map();
  cdp.on('Target.receivedMessageFromTarget', ({ message }) => {
    const event = JSON.parse(message);
    if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.text);
    const item = pending.get(event.id);
    if (item) {
      clearTimeout(item.timer);
      pending.delete(event.id);
      event.error ? item.reject(new Error(JSON.stringify(event.error))) : item.resolve(event.result);
    }
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await cdp.send('Extensions.triggerAction', { id: installed.id, targetId: target.targetId });
    let popup;
    for (let n = 0; n < 100 && !popup; n++) {
      popup = (await cdp.send('Target.getTargets')).targetInfos.find((item) => item.url === `chrome-extension://${installed.id}/index.html`);
      if (!popup) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(popup, 'Actual native action target opened');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: popup.targetId, flatten: false });
    async function send(method, params = {}) {
      const id = ++seq;
      const promise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 10000);
        pending.set(id, { resolve, reject, timer });
      });
      await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) });
      return promise;
    }
    await send('Runtime.enable');
    await send('Page.enable');
    let state;
    for (let n = 0; n < 100; n++) {
      const result = await send('Runtime.evaluate', {
        expression: `({brand:document.querySelector('.wordmark')?.textContent,body:document.body.innerText,busy:document.querySelector('#app')?.classList.contains('busy'),styled:getComputedStyle(document.body).width})`,
        returnByValue: true,
      });
      assert(!result.exceptionDetails);
      state = result.result.value;
      if (state.brand?.includes('Cookiess') && state.busy === false && state.body.includes('Доступ к сайту')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(state?.brand?.includes('Cookiess'), 'Popup JS initialized; no missing index/JS');
    assert.match(state.body, /Доступ к сайту/);
    assert.equal(state.styled, '460px', 'Packaged stylesheet loaded');
    assert(!state.body.includes('ERR_FILE_NOT_FOUND'));
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`test-output/native-popup-${attempt}.png`, Buffer.from(screenshot.data, 'base64'));
    await cdp.send('Target.closeTarget', { targetId: popup.targetId });
  }
  assert.deepEqual(errors, [], 'No unhandled popup exceptions');
  writeFileSync('test-output/popup-smoke.json', JSON.stringify({ browser: context.browser().version(), platform: process.platform, checks: ['ZIP extension loaded', 'native popup JS/CSS and permission screen initialized', 'popup closes and reopens without missing file'], unhandledErrors: errors }, null, 2));
  console.log('Native install-ZIP popup smoke passed:', process.platform);
} finally {
  if (context) await context.close();
  await new Promise((resolve) => server.close(resolve));
  rmSync(profile, { recursive: true, force: true });
}
