# Участие в разработке

## Подготовка

Node.js 22.12+ и npm.

```sh
npm ci
npm run dev   # пересборка dist/ при изменениях; затем «Обновить» в chrome://extensions
```

## Перед pull request

```sh
npm run typecheck
npm run lint
npm run format:check   # или npm run format
npm run test:coverage
npm run package && python3 scripts/verify-package.py
```

Изменения интерфейса проверяйте браузерным набором (Linux, Xvfb, xdotool, Chromium 154+):

```sh
CHROMIUM_PATH=/path/to/chromium xvfb-run -a npm run test:browser
```

Набор обновляет `screenshots/`; коммитьте новые снимки вместе с изменением интерфейса.

## Правила

- **Только синтетические данные.** Никогда не прикладывайте настоящие cookies, экспорт сессий, HAR-файлы или скриншоты с реальными значениями — ни в коде, ни в issue, ни в PR.
- **Без сети.** Расширение не делает сетевых запросов, не грузит удалённый код и не пишет значения cookies в storage или логи. Изменения, нарушающие это, не принимаются.
- **Новые разрешения** в `public/manifest.json` обсуждаются в issue до реализации: они меняют политику конфиденциальности и карточку магазина.
- **Строки интерфейса** добавляются в `src/locales/ru.ts` и `src/locales/en.ts` (TypeScript проверяет, что ключи совпадают; тест — что совпадают подстановки).
- Чистую логику держите в тестируемых модулях (`src/domain.ts`, `src/formats.ts`, `src/view.ts`, `src/decode.ts`), а не в `src/main.ts`.
- Заметные изменения записывайте в `CHANGELOG.md`, статус задач — в `ROADMAP.md`.

## Релизы

Каждый push в `main`, прошедший CI, публикует релиз `vX.Y.Z.N`. Новую линейку начинают сменой `version` в `package.json` и `public/manifest.json`.
