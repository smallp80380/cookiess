// Render listing compositions using unchanged native-popup captures.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
const output = path.resolve('store/assets');
mkdirSync(output, { recursive: true });
const data = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const shots = [
    ['01-list.png', 'Cookies текущего сайта', 'Все пути. Полные атрибуты.', 'Просматривайте записи, ищите по имени и выбирайте нужные cookies для экспорта или удаления.', 'list-light.png', false],
    ['02-editor.png', 'Редактор атрибутов', 'Точный контроль записи.', 'Имя, значение, domain, path, SameSite и expiration — в одном редакторе с проверкой ввода.', 'editor-light.png', false],
    ['03-import.png', 'Импорт с предпросмотром', 'Сначала проверьте изменения.', 'JSON Cookiess, Cookie-Editor и cookies.txt. Видимые пропуски, ошибки и политика конфликтов.', 'import-dark.png', true],
    ['04-dark.png', 'Светлая и тёмная темы', 'Удобный компактный popup.', 'Работает локально. Разрешение на cookies выдаётся пользователем для выбранных сайтов.', 'list-dark.png', true],
  ];
  for (const [name, title, lead, text, shot, dark] of shots) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await page.setContent(`<html lang="ru"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:${dark ? '#202a24' : '#eaece2'};color:${dark ? '#f0f2e9' : '#252d28'};font-family:Arial,sans-serif}main{width:1280px;height:800px;display:flex;align-items:center;padding:64px;gap:64px}.copy{width:560px}.brand{font-size:22px;letter-spacing:3px;margin-bottom:44px}h1{font-size:52px;line-height:1.08;margin:0 0 26px}h2{font-size:28px;font-weight:400;line-height:1.25}p{font-size:22px;line-height:1.5;max-width:520px}.note{font-size:14px;margin-top:46px;opacity:.7}img{width:460px;height:590px;object-fit:contain;box-shadow:0 14px 42px #0003}</style><main><div class="copy"><div class="brand">COOKIESS · LOCAL</div><h1>${title}</h1><h2>${lead}</h2><p>${text}</p><div class="note">Настоящий popup · Искусственные тестовые cookies</div></div><img alt="Скриншот popup" src="${data(`screenshots/${shot}`)}"></main></html>`);
    await page.locator('img').evaluate((img) => img.decode());
    await page.screenshot({ path: path.join(output, name) });
    await page.close();
  }
  // A small brand tile, distinct from interface screenshots.
  const page = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
  await page.setContent(`<html><style>body{margin:0;background:#476a48;display:grid;place-items:center;height:280px}.mark{background:#f5f4ef;width:164px;height:164px;border-radius:36px;display:grid;place-items:center}img{width:128px;height:128px}</style><div class="mark"><img src="${data('public/icons/128.png')}" alt="Cookiess"></div></html>`);
  await page.locator('img').evaluate((img) => img.decode());
  await page.screenshot({ path: path.join(output, 'promo-440x280.png') });
  await page.close();
} finally {
  await browser.close();
}
console.log('Store assets rendered from real synthetic-popup captures:', output);
