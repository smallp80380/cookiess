// Real installed extension and native action popup, never a mock page.
// Run: xvfb-run -a npm run test:browser (Linux Chromium 154+, xdotool, ImageMagick).
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
const profile = mkdtempSync(path.join(tmpdir(), 'cookiess-test-'));
const extensionRoot = path.resolve(process.env.EXTENSION_PATH ?? 'dist');
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
  headless: false,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    '--no-sandbox',
    '--enable-unsafe-extension-debugging',
    `--load-extension=${extensionRoot}`,
  ],
  viewport: { width: 1000, height: 800 },
  acceptDownloads: true,
});
const cdp = await context.browser().newBrowserCDPSession();
const pending = new Map();
let seq = 0;
let popupSend;
let popupTarget;
let acceptDialogs = true;
const results = [];
const errors = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
cdp.on('Target.receivedMessageFromTarget', (event) => {
  const data = JSON.parse(event.message);
  if (data.method === 'Page.javascriptDialogOpening')
    void popupSend('Page.handleJavaScriptDialog', { accept: acceptDialogs });
  if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text);
  const entry = pending.get(data.id);
  if (entry) {
    pending.delete(data.id);
    clearTimeout(entry.timer);
    data.error ? entry.reject(new Error(JSON.stringify(data.error))) : entry.resolve(data.result);
  }
});
async function attach(targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  return async (method, params = {}) => {
    const id = ++seq;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`Timeout ${method}`));
        }
      }, 15000);
      pending.set(id, { resolve, reject, timer });
    });
    await cdp.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id, method, params }),
    });
    return promise;
  };
}
async function evaluate(expression) {
  const result = await popupSend('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description,
    );
  return result.result.value;
}
async function waitFor(expression, message = 'popup condition') {
  for (let n = 0; n < 70; n++) {
    if (await evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`Timeout ${message}`);
}
async function idle() {
  await waitFor("!document.querySelector('#app').classList.contains('busy')", 'operation finished');
}
async function clickText(text) {
  await evaluate(
    `(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!button||button.disabled)throw new Error('Button unavailable');button.click();})()`,
  );
  await delay(50);
  await idle();
}
async function input(selector, value) {
  await evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
}
async function back() {
  assert.equal(await evaluate('document.querySelector(\'[aria-label="Назад к списку"]\').textContent.trim()'), 'Назад');
  await clickText('Назад');
  await idle();
}
async function shot(name) {
  await idle();
  const r = await popupSend('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`screenshots/${name}.png`, Buffer.from(r.data, 'base64'));
}
async function check(name, fn) {
  await fn();
  results.push(name);
  console.log('PASS', name);
}
mkdirSync('screenshots', { recursive: true });
rmSync('screenshots/downloads', { recursive: true, force: true });
let controller;
let site;
let extensionId;
async function openPopup(opener) {
  const tabs = (await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] }))
    .targetInfos;
  const target = tabs.find((t) => t.url === site.url());
  if (opener) await opener.evaluate(() => chrome.action.openPopup());
  else await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
  let popup;
  for (let n = 0; n < 100 && !popup; n++) {
    const targets = (await cdp.send('Target.getTargets')).targetInfos;
    popup = targets.find((t) => t.url === controller.url() && !t.attached);
    if (!popup) await delay(100);
  }
  assert(popup, 'native action popup target exists');
  popupTarget = popup.targetId;
  popupSend = await attach(popup.targetId);
  await popupSend('Runtime.enable');
  await popupSend('Page.enable');
  await waitFor("document.querySelector('.content')?.textContent && !document.querySelector('.content').textContent.includes('Определяем контекст активной вкладки')", 'popup initialization');
  await idle();
}
async function closePopup() {
  await cdp.send('Target.closeTarget', { targetId: popupTarget });
}
const nativeClick = (x, y) => {
  const r = spawnSync('xdotool', ['mousemove', String(x), String(y), 'click', '1']);
  assert.equal(r.status, 0);
};
async function grant() {
  await clickText('Разрешить доступ');
}
// Permission dialogs block run(), so invoke without awaiting idle until native consent.
async function permissionClick() {
  await evaluate(
    "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Разрешить доступ').click()",
  );
  await delay(1000);
}
async function seed(records) {
  return controller.evaluate(async (records) => {
    for (const record of records) await chrome.cookies.set(record);
  }, records);
}
async function readCookies() {
  return controller.evaluate(() => chrome.cookies.getAll({ storeId: '0', partitionKey: {} }));
}
try {
  const installed = await cdp.send('Extensions.getExtensions');
  extensionId = installed.extensions.find((e) => e.name === 'Cookiess').id;
  controller = await context.newPage();
  await controller.goto(`chrome-extension://${extensionId}/index.html`);
  await context.route('https://**/*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Synthetic Cookie Test</title><h1>Synthetic test only</h1>',
    }),
  );
  await context.route('http://**/*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Synthetic HTTP Test</title>',
    }),
  );
  site = await context.newPage();
  await site.goto('https://app.example.com/');
  await openPopup();
  await check(
    'manifest resources load; unsupported controller state; native popup has no-access state',
    async () => {
      const manifest = JSON.parse(readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
      for (const file of [manifest.action.default_popup, ...Object.values(manifest.icons)])
        assert(readFileSync(path.join(extensionRoot, file)).length);
      assert.match(await controller.locator('body').innerText(), /Сайт недоступен/);
      assert.match(await evaluate('document.body.innerText'), /Доступ к сайту/);
      await shot('permission');
    },
  );
  await check('native permission denial is distinct from empty cookies', async () => {
    await permissionClick();
    nativeClick(605, 266);
    await delay(300);
    await idle();
    assert.match(await evaluate('document.body.innerText'), /Доступ не предоставлен/);
    assert.equal((await evaluate('chrome.permissions.getAll()')).origins.length, 0);
  });
  await check(
    'native permission approval immediately loads list and survives popup reopen',
    async () => {
      await permissionClick();
      nativeClick(683, 266);
      await delay(300);
      await idle();
      assert.match(await evaluate('document.body.innerText'), /0 из 0 cookies/);
      await shot('empty');
      await closePopup();
      await openPopup();
      assert.match(await evaluate('document.body.innerText'), /Здесь пока нет cookies/);
    },
  );
  await check('Back sits opposite Refresh above host; refresh preserves every action and dirty draft', async () => {
    for (const action of ['Export', 'Import', 'Add', 'Remove']) {
      await clickText(action);
      await evaluate('document.querySelector(".form")?.scrollTo(0, 100000)');
      assert(await evaluate(`(()=>{const b=document.querySelector('[aria-label="Назад к списку"]');const r=b.getBoundingClientRect();return b.textContent.trim()==='Назад'&&r.top>=0&&r.bottom<=innerHeight;})()`));
      assert(await evaluate(`(()=>{const b=document.querySelector('[aria-label="Назад к списку"]').getBoundingClientRect();const r=document.querySelector('[aria-label="Обновить сайт и cookies"]').getBoundingClientRect();const h=document.querySelector('.site h1').getBoundingClientRect();return Math.abs((b.top+b.bottom)/2-(r.top+r.bottom)/2)<2&&b.right<r.left&&b.bottom<h.top;})()`));
      const heading = await evaluate('document.querySelector(".panel-title h2").textContent');
      await evaluate('document.querySelector(\'[aria-label="Обновить сайт и cookies"]\').click()');
      await idle();
      assert.equal(await evaluate('document.querySelector(".panel-title h2").textContent'), heading);
      assert.equal(await evaluate('document.querySelector(\'[aria-label="Назад к списку"]\').disabled'), false);
      if (action === 'Export') await shot('export-back');
      if (action === 'Add') {
        await input('#field-name', 'unsaved-synthetic');
        await evaluate('document.querySelector(\'[aria-label="Обновить сайт и cookies"]\').click()');
        await idle();
        assert.equal(await evaluate('document.querySelector("#field-name").value'), 'unsaved-synthetic');
        await shot('editor-navigation');
        acceptDialogs = false;
        try {
          await back();
          assert.equal(await evaluate('document.querySelector("#field-name").value'), 'unsaved-synthetic');
        } finally {
          acceptDialogs = true;
        }
      }
      await back();
      assert(await evaluate('Boolean(document.querySelector(".search"))'));
    }
  });
  const base = {
    url: 'https://app.example.com/',
    secure: true,
    sameSite: 'unspecified',
    value: 'synthetic-only',
    storeId: '0',
  };
  await seed([
    { ...base, name: 'host-root', httpOnly: true },
    { ...base, name: 'host-account', path: '/account' },
    { ...base, name: 'parent-domain', domain: '.example.com', path: '/private' },
    { ...base, name: 'parent-host', url: 'https://example.com/' },
    { ...base, name: 'sibling', url: 'https://other.example.com/' },
    { ...base, name: 'duplicate', path: '/' },
    { ...base, name: 'duplicate', path: '/account' },
    {
      ...base,
      name: 'partition-current',
      partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false },
    },
    {
      ...base,
      name: 'partition-other',
      partitionKey: { topLevelSite: 'https://other.com', hasCrossSiteAncestor: true },
    },
    {
      ...base,
      name: 'partition-cross',
      partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: true },
    },
    { ...base, name: 'persistent', expirationDate: Date.now() / 1000 + 86400, sameSite: 'strict' },
    { ...base, name: 'unsafe-text', value: '<script>alert(1)</script>' },
    { ...base, name: 'Длинное_имя_'.repeat(10), value: 'synthetic-long-'.repeat(200) },
  ]);
  await check(
    'onChanged reloads all paths, correct parent/hostOnly scope and current partition only',
    async () => {
      await waitFor("document.querySelectorAll('.cookie-row').length===9", '9 scoped cookies');
      const text = await evaluate('document.body.innerText');
      for (const name of ['host-root', 'host-account', 'parent-domain', 'partition-current'])
        assert(text.includes(name));
      for (const name of ['parent-host', 'sibling', 'partition-other', 'partition-cross'])
        assert(!text.includes(name));
      const behavior = await controller.evaluate(async () => ({
        plain: (await chrome.cookies.getAll({ storeId: '0' })).filter((c) => c.partitionKey).length,
        key: (
          await chrome.cookies.getPartitionKey({
            tabId: (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
            frameId: 0,
          })
        ).partitionKey,
      }));
      writeFileSync('screenshots/partition-behavior.json', JSON.stringify(behavior, null, 2));
      assert.equal(behavior.key.topLevelSite, 'https://example.com');
      assert.equal(behavior.key.hasCrossSiteAncestor, false);
      assert.equal(await evaluate("document.querySelectorAll('script').length"), 1);
      await shot('list-light');
    },
  );
  await check('search, dark theme, keyboard focus and fixed popup dimensions', async () => {
    await input('.theme', 'dark');
    await shot('list-dark');
    await input('.search', 'no-synthetic-match');
    assert.match(await evaluate('document.body.innerText'), /Ничего не найдено/);
    await shot('no-results-dark');
    await input('.search', '');
    await popupSend('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
    });
    await popupSend('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
    });
    assert(await evaluate('document.activeElement!==document.body'));
    const dims = await evaluate(
      '({w:document.body.offsetWidth,h:document.body.offsetHeight,scroll:document.documentElement.scrollWidth})',
    );
    assert.equal(dims.w, 460);
    assert.equal(dims.h, 590);
    assert.equal(dims.scroll, 460);
  });
  await check(
    'editor displays attributes; save preserves session/HttpOnly/unspecified and re-reads API',
    async () => {
      await evaluate(
        'document.querySelector(\'[aria-label="Редактировать host-root /"]\').click()',
      );
      await idle();
      await shot('editor-dark');
      assert(await evaluate("document.querySelector('#field-httpOnly').checked"));
      assert(await evaluate("document.querySelector('#field-session').checked"));
      assert.equal(
        await evaluate("document.querySelector('#field-sameSite').value"),
        'unspecified',
      );
      await input('#field-value', 'synthetic-edited');
      await clickText('Save');
      const saved = (await readCookies()).find((c) => c.name === 'host-root');
      assert.equal(saved.value, 'synthetic-edited');
      assert(saved.session && saved.httpOnly);
      assert.equal(saved.sameSite, 'unspecified');
    },
  );
  await check(
    'Add validates fields, creates persistent None Secure and Cancel protects dirty draft',
    async () => {
      await clickText('Add');
      await input('#field-name', 'created');
      await input('#field-value', 'synthetic-new');
      await input('#field-path', 'invalid');
      await clickText('Save');
      assert.match(await evaluate('document.body.innerText'), /Путь начинается/);
      await input('#field-path', '/');
      await evaluate("document.querySelector('#field-session').click()");
      await input('#field-expirationDate', String(Math.floor(Date.now() / 1000) + 3600));
      await input('#field-sameSite', 'no_restriction');
      await clickText('Save');
      const created = (await readCookies()).find((c) => c.name === 'created');
      assert(created && !created.session && created.secure);
      assert.equal(created.sameSite, 'no_restriction');
      await clickText('Add');
      await input('#field-name', 'draft');
      await clickText('Cancel');
      assert(!(await readCookies()).some((c) => c.name === 'draft'));
    },
  );
  await check(
    'ambiguous duplicate deletion refuses mutation; selected deletion excludes unselected cookies',
    async () => {
      const before = (await readCookies()).filter((c) => c.name === 'duplicate');
      await evaluate(
        'document.querySelector(\'[aria-label="Удалить duplicate /account"]\').click()',
      );
      await delay(100);
      await idle();
      assert.match(await evaluate('document.body.innerText'), /неоднозначно/);
      assert.equal(
        (await readCookies()).filter((c) => c.name === 'duplicate').length,
        before.length,
      );
      await evaluate('document.querySelector(\'[aria-label="Выбрать duplicate /"]\').click()');
      await clickText('Remove');
      await clickText('Удалить выбранные (1)');
      assert.deepEqual(
        (await readCookies()).filter((c) => c.name === 'duplicate').map((c) => c.path),
        ['/account'],
      );
      await evaluate(
        'document.querySelector(\'[aria-label="Удалить duplicate /account"]\').click()',
      );
      await delay(100);
      await idle();
      assert(!(await readCookies()).some((c) => c.name === 'duplicate'));
      await clickText('Remove');
      assert(
        await evaluate(
          "[...document.querySelectorAll('button')].find(b=>b.textContent==='Удалить выбранные (0)').disabled",
        ),
      );
      await back();
    },
  );
  await check('identity rename creates new row and removes old row', async () => {
    await evaluate('document.querySelector(\'[aria-label="Редактировать host-root /"]\').click()');
    await input('#field-name', 'renamed');
    await clickText('Save');
    const all = await readCookies();
    assert(all.some((c) => c.name === 'renamed'));
    assert(!all.some((c) => c.name === 'host-root'));
  });
  await check(
    'hostOnly/domain same domain path name coexist; JSON import keeps both identities',
    async () => {
      await clickText('Import');
      const records = [
        {
          name: 'coexisting',
          value: 'synthetic-host',
          domain: 'app.example.com',
          path: '/',
          hostOnly: true,
          secure: true,
          httpOnly: false,
          session: true,
          sameSite: 'unspecified',
          storeId: '0',
        },
        {
          name: 'coexisting',
          value: 'synthetic-domain',
          domain: '.app.example.com',
          path: '/',
          hostOnly: false,
          secure: true,
          httpOnly: false,
          session: true,
          sameSite: 'unspecified',
          storeId: '0',
        },
      ];
      await input(
        '.import-text',
        JSON.stringify({ format: 'cookiess', version: 1, cookies: records }),
      );
      await clickText('Предпросмотр');
      assert.match(await evaluate('document.body.innerText'), /Добавить 2 · заменить 0/);
      await clickText('Применить импорт');
      const all = (await readCookies()).filter((c) => c.name === 'coexisting');
      assert.equal(all.length, 2);
      assert(all.some((c) => c.hostOnly) && all.some((c) => !c.hostOnly));
      await back();
    },
  );
  await check(
    'partitioned editor saves full key and leaves other partitions untouched',
    async () => {
      await evaluate(
        'document.querySelector(\'[aria-label="Редактировать partition-current /"]\').click()',
      );
      await input('#field-value', 'synthetic-partition-edited');
      await clickText('Save');
      const all = await readCookies();
      const saved = all.find((c) => c.name === 'partition-current');
      assert.equal(saved.value, 'synthetic-partition-edited');
      assert.deepEqual(saved.partitionKey, {
        topLevelSite: 'https://example.com',
        hasCrossSiteAncestor: false,
      });
      assert(all.some((c) => c.name === 'partition-other'));
    },
  );
  await check(
    'JSON export all ignores search; native file download and clipboard/manual fallback',
    async () => {
      await input('.search', 'renamed');
      await clickText('Export');
      const json = JSON.parse(await evaluate("document.querySelector('.export-text').value"));
      assert(json.cookies.length > 1);
      assert.equal(json.format, 'cookiess');
      assert(json.cookies.some((c) => c.partitionKey));
      await cdp.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: path.resolve('screenshots/downloads'),
        eventsEnabled: true,
      });
      await clickText('Скачать файл');
      await delay(500);
      const downloaded = readdirSync('screenshots/downloads').find((f) => f.endsWith('.json'));
      assert(downloaded, 'downloaded JSON exists');
      assert.equal(
        JSON.parse(readFileSync(path.join('screenshots/downloads', downloaded), 'utf8')).cookies
          .length,
        json.cookies.length,
      );
      await clickText('Скопировать текст');
      assert.match(await evaluate('document.body.innerText'), /скопирован|Ctrl\+C/);
      await evaluate(
        "document.querySelectorAll('main select')[1].value='netscape';document.querySelectorAll('main select')[1].dispatchEvent(new Event('change'))",
      );
      assert.match(await evaluate('document.body.innerText'), /не поддерживает partitioned/);
      await back();
      await input('.search', '');
    },
  );
  await check(
    'import preview, foreign-domain rejection, malformed record and actual partial results',
    async () => {
      await clickText('Import');
      const imported = {
        name: 'imported',
        value: 'synthetic-import',
        domain: 'app.example.com',
        path: '/',
        hostOnly: true,
        secure: true,
        httpOnly: true,
        session: true,
        sameSite: null,
        storeId: null,
      };
      await input(
        '.import-text',
        JSON.stringify([
          imported,
          { ...imported, name: 'foreign', domain: 'other.example.com' },
          { ...imported, name: 'bad', value: 3 },
          { ...imported, name: 'oversized', value: 'synthetic-'.repeat(600) },
        ]),
      );
      await clickText('Предпросмотр');
      assert.match(
        await evaluate('document.body.innerText'),
        /Добавить 2 · заменить 0 · пропустить 1 · ошибок 1/,
      );
      await shot('import-dark');
      await clickText('Применить импорт');
      assert.match(
        await evaluate('document.body.innerText'),
        /Частичный импорт: записано 1, пропущено 1, ошибок 2/,
      );
      assert((await readCookies()).some((c) => c.name === 'imported' && c.storeId === '0'));
      assert(!(await readCookies()).some((c) => c.name === 'foreign' || c.name === 'oversized'));
      await input('.import-text', JSON.stringify([{ ...imported, value: 'synthetic-replaced' }]));
      await clickText('Предпросмотр');
      assert.match(await evaluate('document.body.innerText'), /заменить 1/);
      await clickText('Применить импорт');
      assert.equal(
        (await readCookies()).find((c) => c.name === 'imported').value,
        'synthetic-replaced',
      );
      await input('.import-text', JSON.stringify([{ ...imported, value: 'synthetic-skipped' }]));
      await evaluate(
        "document.querySelector('main select').value='skip';document.querySelector('main select').dispatchEvent(new Event('change'))",
      );
      await clickText('Предпросмотр');
      assert.match(await evaluate('document.body.innerText'), /пропустить 1/);
      assert(
        await evaluate(
          "[...document.querySelectorAll('button')].find(b=>b.textContent==='Применить импорт').disabled",
        ),
      );
      await back();
    },
  );
  await check('Netscape paste and JSON local file import', async () => {
    await clickText('Import');
    await input(
      '.import-text',
      '#HttpOnly_app.example.com\tFALSE\t/account\tTRUE\t0\tnetscape\tsynthetic-txt\n',
    );
    await clickText('Предпросмотр');
    await clickText('Применить импорт');
    assert(
      (await readCookies()).some(
        (c) => c.name === 'netscape' && c.httpOnly && c.session && c.path === '/account',
      ),
    );
    await back();
    await clickText('Import');
    const fileJson = JSON.stringify({
      format: 'cookiess',
      version: 1,
      cookies: [
        {
          name: 'from-file',
          value: 'synthetic-file',
          domain: 'app.example.com',
          path: '/',
          hostOnly: true,
          secure: true,
          httpOnly: false,
          session: true,
          sameSite: 'lax',
          storeId: '0',
        },
      ],
    });
    const filePath = path.join(profile, 'import.json');
    writeFileSync(filePath, fileJson);
    const doc = await popupSend('DOM.getDocument');
    const { nodeId } = await popupSend('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: 'input[type=file]',
    });
    await popupSend('DOM.setFileInputFiles', { nodeId, files: [filePath] });
    await delay(100);
    await idle();
    await clickText('Предпросмотр');
    await clickText('Применить импорт');
    assert((await readCookies()).some((c) => c.name === 'from-file'));
    await back();
  });
  await check(
    'hundreds of rows, long Unicode names and XSS values remain within popup',
    async () => {
      await seed([
        ...Array.from({ length: 120 }, (_, i) => ({
          ...base,
          name: `synthetic-${String(i).padStart(3, '0')}`,
          value: `synthetic-${i}`,
        })),
        ...Array.from({ length: 100 }, (_, i) => ({
          ...base,
          name: `partition-bulk-${i}`,
          value: 'synthetic-partition',
          partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false },
        })),
      ]);
      await waitFor("document.querySelectorAll('.cookie-row').length>200");
      await input('.theme', 'light');
      await shot('many-light');
      assert.equal(await evaluate('document.documentElement.scrollWidth'), 460);
      await clickText('Import');
      await input('.import-text', 'not a cookie file');
      await clickText('Предпросмотр');
      await shot('import-light');
      await back();
      await evaluate(
        'document.querySelector(\'[aria-label="Редактировать persistent /"]\').click()',
      );
      await shot('editor-light');
      await back();
    },
  );
  await check('stale active-tab navigation blocks mutation until explicit refresh', async () => {
    await site.goto('https://other.example.com/');
    await delay(300);
    assert.match(await evaluate('document.body.innerText'), /Сайт вкладки изменился/);
    assert(await evaluate("[...document.querySelectorAll('footer button')].every(b=>b.disabled)"));
    await evaluate('document.querySelector(\'[aria-label="Обновить сайт и cookies"]\').click()');
    await idle();
    assert.equal(await evaluate('document.querySelector("h1").textContent'), 'other.example.com');
    assert.equal(await evaluate('document.querySelectorAll(".cookie-row").length'), 2);
  });
  await check(
    'Remove all requires host/count confirmation and affects only current host',
    async () => {
      await clickText('Remove');
      await clickText('Удалить все cookies этого сайта (2)');
      assert(!(await readCookies()).some((c) => c.name === 'sibling'));
      assert((await readCookies()).some((c) => c.name === 'renamed'));
    },
  );
  await check('localhost and IP optional access loads true HTTP site cookies', async () => {
    for (const host of ['localhost', '127.0.0.1']) {
      await closePopup();
      await site.goto(`http://${host}:8080/`);
      await openPopup();
      assert.match(await evaluate('document.body.innerText'), /Доступ к сайту/);
      await permissionClick();
      nativeClick(683, 266);
      await delay(250);
      await idle();
      await clickText('Add');
      await input('#field-name', `synthetic-${host}`);
      await input('#field-value', 'synthetic-local');
      assert.equal(await evaluate("document.querySelector('#field-secure').checked"), false);
      await clickText('Save');
      assert.match(await evaluate('document.body.innerText'), /1 из 1 cookies/);
    }
  });
  await check(
    'permission revocation disables writes and refresh returns no-access state',
    async () => {
      await controller.evaluate(() => chrome.permissions.remove({ origins: ['*://127.0.0.1/*'] }));
      await delay(200);
      assert.match(await evaluate('document.body.innerText'), /Разрешение изменилось/);
      await evaluate('document.querySelector(\'[aria-label="Обновить сайт и cookies"]\').click()');
      await idle();
      assert.match(await evaluate('document.body.innerText'), /Доступ к сайту/);
    },
  );
  await check(
    'incognito popup uses a separate store; CRUD never changes normal store',
    async () => {
      console.log('Incognito: enable in isolated settings');
      await closePopup();
      const settings = await context.newPage();
      await settings.goto(`chrome://extensions/?id=${extensionId}`);
      if ((await settings.locator('#devMode').getAttribute('aria-checked')) !== 'true')
        await settings.locator('#devMode').click();
      await settings.locator('#allow-incognito cr-toggle').click();
      await delay(1200);
      await settings.close();
      // Chrome reloads the extension when incognito access changes; reopen its controller.
      controller = await context.newPage();
      await controller.goto(`chrome-extension://${extensionId}/index.html`);
      const server = createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<!doctype html><title>Synthetic incognito test</title>');
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const url = `http://localhost:${server.address().port}/`;
      let windowId;
      let privateTabId;
      try {
        const privateWindow = await controller.evaluate(
          (url) => chrome.windows.create({ incognito: true, url }),
          url,
        );
        windowId = privateWindow?.id;
        await delay(200);
        privateTabId = (
          await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })
        ).targetInfos.find((t) => t.url === url)?.targetId;
        assert(privateTabId, 'Chrome created a native incognito tab');
        site = { url: () => url };
        await delay(300);
        await openPopup();
        await waitFor("document.querySelector('.list-summary')");
        assert.match(await evaluate('document.body.innerText'), /0 из 0 cookies/);
        const stores = await evaluate(
          '(async()=>{const tab=(await chrome.tabs.query({active:true,currentWindow:true}))[0];return (await chrome.cookies.getAllCookieStores()).find(s=>s.tabIds.includes(tab.id));})()',
        );
        assert.notEqual(stores.id, '0');
        await clickText('Add');
        await input('#field-name', 'synthetic-incognito');
        await input('#field-value', 'synthetic-private-store');
        await clickText('Save');
        assert.match(await evaluate('document.body.innerText'), /1 из 1 cookies/);
        const privateCookies = await evaluate(
          `chrome.cookies.getAll({storeId:${JSON.stringify(stores.id)}})`,
        );
        assert.equal(privateCookies.length, 1);
        assert.equal(privateCookies[0].storeId, stores.id);
        assert(!(await readCookies()).some((c) => c.name === 'synthetic-incognito'));
        await clickText('Remove');
        await clickText('Удалить все cookies этого сайта (1)');
        assert((await readCookies()).some((c) => c.name === 'renamed'));
        await shot('incognito-empty');
      } finally {
        if (windowId) await controller.evaluate((id) => chrome.windows.remove(id), windowId);
        else if (privateTabId) await cdp.send('Target.closeTarget', { targetId: privateTabId });
        await new Promise((resolve) => server.close(resolve));
      }
    },
  );
  assert.equal(errors.length, 0, 'no unhandled popup errors');
  writeFileSync(
    'screenshots/browser-results.json',
    JSON.stringify(
      {
        browser: context.browser().version(),
        extensionId,
        tests: results,
        unhandledErrors: errors,
        profile: 'temporary isolated synthetic profile',
        popup: 'native action target via Extensions.triggerAction',
      },
      null,
      2,
    ),
  );
  console.log(`${results.length} real browser checks passed`);
} catch (error) {
  spawnSync('import', ['-window', 'root', 'screenshots/failure-native.png']);
  throw error;
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
