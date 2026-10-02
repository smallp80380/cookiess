import './style.css';
import { CookieApi, applyImport, previewImport, type ImportItem } from './api';
import { accessPattern, identity, partitionIdentity, validateCookie, type Cookie, type SiteContext } from './domain';
import { parse, serialize, type Format } from './formats';
const api = new CookieApi();
const app = document.querySelector<HTMLDivElement>('#app')!;
const icons: Record<string, string> = {
  cookie:
    '<path d="M18 3a4 4 0 0 0 3 6 9 9 0 1 1-9-7 4 4 0 0 0 6 1Z"/><path d="M7 9h.01M9 16h.01M15 14h.01M6 13h.01"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  remove: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/>',
  import: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  export: '<path d="M12 15V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 7M4 12l2 7a7 7 0 0 0 12-2"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function icon(name: string): SVGSVGElement {
  const span = el('span');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? ''}</svg>`;
  return span.firstElementChild as SVGSVGElement;
}
function button(
  text: string,
  action: () => void | Promise<void>,
  className = '',
  glyph?: string,
): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  if (glyph) b.append(icon(glyph));
  if (text) b.append(el('span', '', text));
  b.onclick = () => void run(action);
  return b;
}
let context: SiteContext | undefined;
let cookies: Cookie[] = [];
let selected = new Set<string>();
let screen: 'list' | 'editor' | 'import' | 'export' | 'remove' = 'list';
let dirty = false;
let busy = false;
let query = '';
let sort = 'name';
let allowed = false;
let ready = false;
let loadVersion = 0;
let refreshPanel: (() => void) | undefined;
const brand = el('header', 'brand');
const logo = el('div', 'wordmark');
logo.append(icon('cookie'), el('strong', '', 'Cookiess'), el('span', 'edition', 'LOCAL'));
const theme = el('select', 'theme');
theme.setAttribute('aria-label', 'Тема');
for (const [value, label] of [
  ['system', 'Системная'],
  ['light', 'Светлая'],
  ['dark', 'Тёмная'],
]) {
  const option = el('option', '', label);
  option.value = value;
  theme.append(option);
}
function setTheme(value: string) {
  document.documentElement.dataset.theme = value;
}
theme.onchange = () => {
  setTheme(theme.value);
  void chrome.storage.local.set({ theme: theme.value });
};
void chrome.storage.local.get('theme').then((data) => {
  theme.value = data.theme === 'light' || data.theme === 'dark' ? data.theme : 'system';
  setTheme(theme.value);
});
brand.append(logo, theme);
const site = el('section', 'site');
const host = el('h1', '', 'Текущий сайт');
const contextLabel = el('p', 'muted', 'Все пути · только контекст вкладки');
const siteText = el('div', 'site-text');
siteText.append(host, contextLabel);
const refresh = button(
  '',
  async () => {
    await refreshCurrentView();
  },
  'icon-button',
  'refresh',
);
refresh.setAttribute('aria-label', 'Обновить сайт и cookies');
const back = button('Назад', async () => {
  if (!leave()) return;
  notify('');
  if (!ready || !allowed) await initialize();
  else renderList();
}, 'back-button', 'back');
back.setAttribute('aria-label', 'Назад к списку');
const navigation = el('div', 'site-navigation');
navigation.append(back, refresh);
site.append(navigation, siteText);
const status = el('div', 'status');
status.setAttribute('role', 'status');
status.setAttribute('aria-live', 'polite');
const content = el('main', 'content');
const footer = el('footer', 'actions');
const actionButtons = [
  button('Import', () => openImport(), '', 'import'),
  button('Export', () => openExport(), '', 'export'),
  button('Add', () => openEditor(), 'primary', 'add'),
  button('Remove', () => openRemove(), 'danger', 'remove'),
];
footer.append(...actionButtons);
app.append(brand, site, status, content, footer);
function notify(message: string, kind = 'info') {
  status.textContent = message;
  status.dataset.kind = kind;
  status.hidden = !message;
}
function lock(value: boolean) {
  busy = value;
  app.classList.toggle('busy', value);
  actionButtons.forEach((b) => (b.disabled = value || !allowed || !ready));
  refresh.disabled = value;
  back.disabled = value || screen === 'list';
}
async function run(action: () => void | Promise<void>) {
  if (busy) return;
  lock(true);
  try {
    await action();
  } catch (error) {
    notify(
      error instanceof Error
        ? error.message
        : 'Операция не выполнена. Обновите список и проверьте доступ.',
      'error',
    );
  } finally {
    lock(false);
  }
}
function leave(): boolean {
  if (dirty && !confirm('Есть несохранённые изменения. Закрыть форму?')) return false;
  dirty = false;
  return true;
}
function state(title: string, message: string, cta?: HTMLButtonElement) {
  content.replaceChildren();
  const box = el('div', 'empty');
  box.append(icon('cookie'), el('h2', '', title), el('p', 'muted', message));
  if (cta) box.append(cta);
  content.append(box);
}
async function initialize() {
  const version = ++loadVersion;
  ready = false;
  allowed = false;
  context = undefined;
  cookies = [];
  selected.clear();
  screen = 'list';
  notify('');
  state('Загрузка', 'Определяем контекст активной вкладки…');
  try {
    const next = await api.context();
    if (version !== loadVersion) return;
    context = next;
    host.textContent = context.host;
    host.title = context.host;
    contextLabel.textContent = `Все пути · store ${context.storeId} · текущая partition`;
    allowed = await api.hasAccess(context);
    if (!allowed) {
      state(
        'Доступ к сайту',
        `Для чтения и изменения cookies разрешите доступ к ${accessPattern(context.host).replace('*://', '').replace('/*', '')}. Родительские domain cookies включены; список ограничен текущим хостом.`,
        button(
          'Разрешить доступ',
          async () => {
            if (!context) return;
            // request must start in the click's user gesture, before any awaited API call.
            const granted = await api.requestAccess(context);
            if (!granted) {
              notify('Доступ не предоставлен. Cookies не прочитаны.', 'error');
              return;
            }
            await initialize();
          },
          'primary',
        ),
      );
      return;
    }
    cookies = await api.list(context);
    ready = true;
    renderList();
  } catch (error) {
    state(
      'Сайт недоступен',
      error instanceof Error ? error.message : 'Не удалось загрузить cookies.',
      button('Повторить', initialize),
    );
  } finally {
    lock(false);
  }
}
async function reload() {
  if (!context || !allowed) return;
  const currentContext = context;
  const next = await api.list(currentContext);
  if (currentContext !== context || !ready) return;
  cookies = next;
  selected = new Set([...selected].filter((id) => cookies.some((c) => identity(c) === id)));
  if (screen === 'list') renderList();
}
async function refreshCurrentView() {
  const next = await api.context();
  if (context && next.tabId === context.tabId && next.host === context.host &&
      next.storeId === context.storeId && new URL(next.url).origin === new URL(context.url).origin &&
      await api.hasAccess(next)) {
    // Keep the current form and its dirty draft when the site context is unchanged.
    const key = next.partitionKey;
    if (partitionIdentity(key) === partitionIdentity(context.partitionKey)) {
      context = { ...next, partitionKey: key };
      allowed = true;
      ready = true;
      await reload();
      refreshPanel?.();
      notify('Cookies обновлены. Текущая форма сохранена.', 'success');
      return;
    }
  }
  if (leave()) await initialize();
}
function backHeader(title: string) {
  refreshPanel = undefined;
  const bar = el('div', 'panel-title');
  bar.append(el('h2', '', title));
  content.append(bar);
}
function renderList() {
  refreshPanel = undefined;
  screen = 'list';
  dirty = false;
  content.replaceChildren();
  const tools = el('div', 'tools');
  const search = el('input', 'search');
  search.type = 'search';
  search.placeholder = 'Поиск по имени, домену, пути';
  search.setAttribute('aria-label', 'Поиск cookies');
  search.value = query;
  const order = el('select');
  order.setAttribute('aria-label', 'Сортировка');
  for (const [value, label] of [
    ['name', 'Имя ↑'],
    ['domain', 'Домен ↑'],
    ['path', 'Путь ↑'],
  ]) {
    const o = el('option', '', label);
    o.value = value;
    order.append(o);
  }
  order.value = sort;
  tools.append(search, order);
  const summary = el('div', 'list-summary');
  const count = el('span');
  const all = el('input');
  all.type = 'checkbox';
  all.setAttribute('aria-label', 'Выбрать все видимые записи');
  summary.append(all, count);
  const list = el('div', 'cookie-list');
  list.setAttribute('aria-label', 'Cookies сайта');
  content.append(tools, summary, list);
  function draw() {
    const needle = query.toLocaleLowerCase();
    const visible = cookies
      .filter((c) => [c.name, c.domain, c.path].some((s) => s.toLocaleLowerCase().includes(needle)))
      .sort(
        (a, b) =>
          a[sort as 'name' | 'domain' | 'path'].localeCompare(
            b[sort as 'name' | 'domain' | 'path'],
          ) || a.path.localeCompare(b.path),
      );
    count.textContent = `${visible.length} из ${cookies.length} cookies${selected.size ? ` · выбрано ${selected.size}` : ''}`;
    all.checked = visible.length > 0 && visible.every((c) => selected.has(identity(c)));
    all.indeterminate = visible.some((c) => selected.has(identity(c))) && !all.checked;
    all.onchange = () => {
      visible.forEach((c) =>
        all.checked ? selected.add(identity(c)) : selected.delete(identity(c)),
      );
      draw();
    };
    list.replaceChildren();
    if (!visible.length) {
      const empty = el('div', 'empty');
      empty.append(
        el('h2', '', cookies.length ? 'Ничего не найдено' : 'Здесь пока нет cookies'),
        el(
          'p',
          'muted',
          cookies.length
            ? 'Попробуйте другой запрос.'
            : 'Добавьте запись или импортируйте локальный файл.',
        ),
      );
      list.append(empty);
    }
    for (const cookie of visible) {
      const row = el('div', 'cookie-row');
      const checkbox = el('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected.has(identity(cookie));
      checkbox.setAttribute('aria-label', `Выбрать ${cookie.name || '(без имени)'} ${cookie.path}`);
      checkbox.onchange = () => {
        if (checkbox.checked) selected.add(identity(cookie));
        else selected.delete(identity(cookie));
        draw();
      };
      const edit = button('', () => openEditor(cookie), 'cookie-details');
      edit.setAttribute(
        'aria-label',
        `Редактировать ${cookie.name || '(без имени)'} ${cookie.path}`,
      );
      const first = el('div', 'row-first');
      first.append(el('strong', 'cookie-name', cookie.name || '(без имени)'));
      const flags = el('span', 'flags');
      for (const flag of [
        cookie.secure ? 'S' : '',
        cookie.httpOnly ? 'H' : '',
        cookie.partitionKey ? 'P' : '',
        cookie.session ? 'session' : '',
      ])
        if (flag) flags.append(el('small', 'flag', flag));
      first.append(flags);
      const value = el('span', 'cookie-value', cookie.value || '(пустое значение)');
      const scope = el('span', 'cookie-scope', `${cookie.domain} · ${cookie.path}`);
      edit.append(first, value, scope);
      const remove = button(
        '',
        async () => {
          if (
            confirm(`Удалить ${cookie.name || '(без имени)'} (${cookie.domain}${cookie.path})?`)
          ) {
            await api.remove(cookie, context!);
            await reload();
            notify('Cookie удалена.', 'success');
          }
        },
        'icon-button row-remove',
        'remove',
      );
      remove.setAttribute('aria-label', `Удалить ${cookie.name || '(без имени)'} ${cookie.path}`);
      row.append(checkbox, edit, remove);
      list.append(row);
    }
  }
  search.oninput = () => {
    query = search.value;
    draw();
  };
  order.onchange = () => {
    sort = order.value;
    draw();
  };
  draw();
}
function openEditor(original?: Cookie) {
  if (!context || !leave()) return;
  notify('');
  screen = 'editor';
  content.replaceChildren();
  backHeader(original ? 'Редактировать cookie' : 'Новая cookie');
  const initial: Cookie = original ?? {
    name: '',
    value: '',
    domain: context.host,
    path: '/',
    hostOnly: true,
    secure: new URL(context.url).protocol === 'https:',
    httpOnly: false,
    sameSite: 'unspecified',
    session: true,
    storeId: context.storeId,
  };
  const form = el('form', 'form');
  const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = {};
  const errors: Record<string, HTMLElement> = {};
  function field(key: string, label: string, kind = 'text', value = '') {
    const wrapper = el('label', 'field');
    wrapper.append(el('span', '', label));
    const input = kind === 'textarea' ? el('textarea') : el('input');
    if (input instanceof HTMLInputElement) input.type = kind;
    input.name = key;
    input.value = value;
    input.autocomplete = 'off';
    if (kind === 'checkbox' && input instanceof HTMLInputElement)
      input.checked = Boolean(initial[key as keyof Cookie]);
    inputs[key] = input;
    input.id = `field-${key}`;
    const error = el('small', 'field-error');
    error.id = `error-${key}`;
    input.setAttribute('aria-describedby', error.id);
    errors[key] = error;
    wrapper.append(input, error);
    form.append(wrapper);
    return input;
  }
  field('name', 'Имя', 'text', initial.name);
  field('value', 'Значение', 'textarea', initial.value);
  const grid = el('div', 'form-grid');
  form.append(grid);
  for (const [key, label] of [
    ['domain', 'Домен'],
    ['path', 'Путь'],
  ]) {
    field(key, label, 'text', initial[key as 'domain' | 'path']);
    grid.append(form.lastElementChild!);
  }
  const checks = el('div', 'checks');
  form.append(checks);
  for (const [key, label] of [
    ['hostOnly', 'Host-only'],
    ['secure', 'Secure'],
    ['httpOnly', 'HttpOnly'],
    ['session', 'Session'],
  ]) {
    field(key, label, 'checkbox');
    checks.append(form.lastElementChild!);
  }
  const sameWrapper = el('label', 'field');
  sameWrapper.append(el('span', '', 'SameSite'));
  const same = el('select');
  same.id = 'field-sameSite';
  for (const [value, label] of [
    ['unspecified', 'Unspecified — без атрибута'],
    ['lax', 'Lax'],
    ['strict', 'Strict'],
    ['no_restriction', 'None'],
  ]) {
    const option = el('option', '', label);
    option.value = value;
    same.append(option);
  }
  same.value = initial.sameSite;
  inputs.sameSite = same;
  const sameError = el('small', 'field-error');
  errors.sameSite = sameError;
  sameWrapper.append(same, sameError);
  form.append(sameWrapper);
  const expiry = field(
    'expirationDate',
    'Срок (Unix seconds)',
    'number',
    String(initial.expirationDate ?? Math.floor(Date.now() / 1000) + 86400),
  );
  expiry.disabled = initial.session;
  inputs.session.onchange = () => {
    expiry.disabled = (inputs.session as HTMLInputElement).checked;
  };
  field(
    'partitionKey',
    'Partition key (JSON; пусто = unpartitioned)',
    'textarea',
    initial.partitionKey ? JSON.stringify(initial.partitionKey) : '',
  );
  form.append(
    el(
      'p',
      'note',
      `Store ${context.storeId}. Смена name/domain/path/partition создаёт новую запись и затем удаляет прежнюю; операция не атомарна.`,
    ),
  );
  form.oninput = () => {
    dirty = true;
  };
  form.onchange = () => {
    dirty = true;
  };
  const controls = el('div', 'form-actions');
  const cancel = button('Cancel', () => {
    if (leave()) renderList();
  });
  const save = el('button', 'primary', 'Save');
  save.type = 'submit';
  controls.append(cancel, save);
  form.append(controls);
  form.onsubmit = (event) => {
    event.preventDefault();
    void run(async () => {
      Object.values(errors).forEach((e) => (e.textContent = ''));
      let partitionKey: Cookie['partitionKey'];
      try {
        const text = inputs.partitionKey.value.trim();
        if (text) {
          const parsed = parse(JSON.stringify([{ ...initial, partitionKey: JSON.parse(text) }]));
          if (parsed.errors.length) throw new Error();
          partitionKey = parsed.cookies[0].partitionKey;
        }
      } catch {
        errors.partitionKey.textContent =
          'Укажите корректный partitionKey JSON с topLevelSite и hasCrossSiteAncestor.';
        inputs.partitionKey.focus();
        return;
      }
      const isSession = (inputs.session as HTMLInputElement).checked;
      const cookie: Cookie = {
        name: inputs.name.value,
        value: inputs.value.value,
        domain: inputs.domain.value,
        path: inputs.path.value,
        hostOnly: (inputs.hostOnly as HTMLInputElement).checked,
        secure: (inputs.secure as HTMLInputElement).checked,
        httpOnly: (inputs.httpOnly as HTMLInputElement).checked,
        sameSite: inputs.sameSite.value as Cookie['sameSite'],
        session: isSession,
        storeId: context!.storeId,
        ...(!isSession ? { expirationDate: Number(expiry.value) } : {}),
        ...(partitionKey ? { partitionKey } : {}),
      };
      const validation = validateCookie(cookie, context);
      if (Object.keys(validation).length) {
        for (const [key, message] of Object.entries(validation)) {
          if (errors[key]) errors[key].textContent = message;
        }
        inputs[Object.keys(validation)[0]]?.focus();
        return;
      }
      if (
        original &&
        identity(original) !== identity(cookie) &&
        !confirm(
          'Identity изменилась. Создать новую cookie и удалить прежнюю? Возможен частичный результат.',
        )
      )
        return;
      try {
        await api.save(cookie, original, context!);
        dirty = false;
        await reload();
        renderList();
        notify('Cookie сохранена; список перечитан.', 'success');
      } catch (error) {
        await reload();
        throw error;
      }
    });
  };
  content.append(form);
  inputs.name.focus();
}
function openRemove() {
  if (!context || !leave()) return;
  notify('');
  screen = 'remove';
  content.replaceChildren();
  backHeader('Удаление');
  const panel = el('div', 'form');
  panel.append(
    el(
      'p',
      '',
      `Выбрано ${selected.size}. Всего на ${context.host}: ${cookies.length}. Поиск не расширяет выбор.`,
    ),
  );
  const removeSelected = button(
    `Удалить выбранные (${selected.size})`,
    () => deleteMany(cookies.filter((c) => selected.has(identity(c)))),
    'danger',
    'remove',
  );
  removeSelected.disabled = !selected.size;
  const all = button(
    `Удалить все cookies этого сайта (${cookies.length})`,
    () => deleteMany([...cookies]),
    'danger',
  );
  all.disabled = !cookies.length;
  panel.append(removeSelected, all);
  refreshPanel = openRemove;
  content.append(panel);
}
async function deleteMany(items: Cookie[]) {
  if (!items.length) {
    notify('Сначала выберите cookies.');
    return;
  }
  if (
    !confirm(
      `Удалить ${items.length} cookies на ${context!.host}? Только текущий store и partition.`,
    )
  )
    return;
  let success = 0;
  const errors: string[] = [];
  // Short paths first reduce URL ambiguity without widening selected scope.
  for (const cookie of [...items].sort((a, b) => a.path.length - b.path.length))
    try {
      await api.remove(cookie, context!);
      success++;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Не удалось удалить cookie.');
    }
  await reload();
  renderList();
  notify(
    `Удалено ${success} из ${items.length}.${errors.length ? ` Ошибок: ${errors.length}. ${errors[0]}` : ''}`,
    errors.length ? 'error' : 'success',
  );
}
function openImport() {
  if (!context || !leave()) return;
  notify('');
  screen = 'import';
  content.replaceChildren();
  backHeader('Import · локальный файл');
  const panel = el('div', 'form');
  const fileLabel = el('label', 'field');
  fileLabel.append(el('span', '', 'Файл JSON / cookies.txt'));
  const file = el('input');
  file.type = 'file';
  file.accept = '.json,.txt';
  fileLabel.append(file);
  panel.append(fileLabel);
  const textLabel = el('label', 'field');
  textLabel.append(el('span', '', 'Или вставьте текст'));
  const text = el('textarea', 'import-text');
  text.rows = 7;
  textLabel.append(text);
  panel.append(textLabel);
  file.onchange = () =>
    void run(async () => {
      const selectedFile = file.files?.[0];
      if (!selectedFile) return;
      if (selectedFile.size > 10_000_000) throw new Error('Файл больше 10 MB.');
      text.value = await selectedFile.text();
      dirty = true;
      invalidate();
    });
  const policyLabel = el('label', 'field');
  policyLabel.append(el('span', '', 'Конфликты identity'));
  const policy = el('select');
  for (const [value, label] of [
    ['replace', 'Заменить существующие'],
    ['skip', 'Пропустить существующие'],
  ]) {
    const o = el('option', '', label);
    o.value = value;
    policy.append(o);
  }
  policyLabel.append(policy);
  panel.append(policyLabel);
  const preview = el('div', 'preview');
  preview.setAttribute('aria-live', 'polite');
  let items: ImportItem[] = [];
  let parseErrors: string[] = [];
  const apply = button(
    'Применить импорт',
    async () => {
      const result = await applyImport(items, context!, api, policy.value as 'replace' | 'skip');
      dirty = false;
      await reload();
      const errors = result.errors.length + parseErrors.length;
      notify(
        `${errors ? 'Частичный импорт' : 'Импорт завершён'}: записано ${result.success}, пропущено ${result.skipped}, ошибок ${errors}.`,
        errors ? 'error' : 'success',
      );
      preview.replaceChildren(
        el(
          'p',
          '',
          `Результат: ${result.success} успешно · ${result.skipped} пропущено · ${errors} ошибок`,
        ),
        ...result.errors.map((e) => el('p', 'field-error', e)),
        ...parseErrors.map((e) => el('p', 'field-error', e)),
      );
      items = [];
      apply.disabled = true;
    },
    'primary',
  );
  apply.disabled = true;
  function invalidate() {
    items = [];
    apply.disabled = true;
    preview.replaceChildren();
  }
  text.oninput = () => {
    dirty = true;
    invalidate();
  };
  policy.onchange = invalidate;
  refreshPanel = invalidate;
  const inspect = button('Предпросмотр', async () => {
    notify('');
    await api.assertContext(context!);
    await reload();
    const parsed = parse(text.value);
    parseErrors = parsed.errors;
    items = previewImport(parsed.cookies, cookies, context!, policy.value as 'replace' | 'skip');
    preview.replaceChildren(
      el(
        'p',
        'preview-count',
        `Добавить ${items.filter((i) => i.action === 'add').length} · заменить ${items.filter((i) => i.action === 'replace').length} · пропустить ${items.filter((i) => i.action === 'skip').length} · ошибок ${parsed.errors.length}`,
      ),
    );
    for (const warning of parsed.warnings) preview.append(el('p', 'note', warning));
    for (const error of parsed.errors) preview.append(el('p', 'field-error', error));
    for (const item of items)
      preview.append(
        el(
          'p',
          'preview-item',
          `${item.action === 'add' ? 'Добавить' : item.action === 'replace' ? 'Заменить' : 'Пропустить'}: ${item.cookie.name || '(без имени)'} · ${item.cookie.domain}${item.cookie.path}${item.reason ? ` — ${item.reason}` : ''}`,
        ),
      );
    preview.append(
      el(
        'p',
        'note',
        'Store источника игнорируется. Только текущий сайт и top-level partition. Существующие cookies не очищаются.',
      ),
    );
    apply.disabled = !items.some((i) => i.action !== 'skip');
    preview.scrollIntoView({ block: 'nearest' });
  });
  panel.append(inspect, preview, apply);
  content.append(panel);
}
function openExport() {
  if (!context || !leave()) return;
  notify('');
  screen = 'export';
  content.replaceChildren();
  backHeader('Export · локальная копия');
  const panel = el('div', 'form');
  const scopeLabel = el('label', 'field');
  scopeLabel.append(el('span', '', 'Область экспорта'));
  const scope = el('select');
  for (const [value, label] of [
    ['all', `Все cookies сайта (${cookies.length})`],
    ['selected', `Выбранные (${selected.size})`],
  ]) {
    const o = el('option', '', label);
    o.value = value;
    scope.append(o);
  }
  scope.value = selected.size ? 'selected' : 'all';
  scopeLabel.append(scope);
  panel.append(scopeLabel);
  const formatLabel = el('label', 'field');
  formatLabel.append(el('span', '', 'Формат'));
  const format = el('select');
  for (const [value, label] of [
    ['cookiess', 'Cookiess JSON · все атрибуты'],
    ['cookie-editor', 'Cookie-Editor JSON'],
    ['netscape', 'Netscape cookies.txt · с потерями'],
  ]) {
    const o = el('option', '', label);
    o.value = value;
    format.append(o);
  }
  formatLabel.append(format);
  panel.append(formatLabel);
  panel.append(
    el(
      'p',
      'note',
      'Поиск не меняет экспорт. Файлы содержат секретные значения: храните их бережно. Partitioned cookies экспортируются только в JSON.',
    ),
  );
  const warning = el('p', 'note');
  const outputLabel = el('label', 'field');
  outputLabel.append(el('span', '', 'Текст для ручного копирования'));
  const output = el('textarea', 'export-text');
  output.readOnly = true;
  output.rows = 8;
  outputLabel.append(output);
  panel.append(warning, outputLabel);
  function refreshOutput() {
    try {
      const items =
        scope.value === 'all' ? cookies : cookies.filter((c) => selected.has(identity(c)));
      const result = serialize(items, format.value as Format);
      output.value = result.text;
      warning.textContent = result.warnings.join(' ');
    } catch (error) {
      output.value = '';
      warning.textContent = error instanceof Error ? error.message : 'Не удалось экспортировать.';
    }
  }
  scope.onchange = refreshOutput;
  format.onchange = refreshOutput;
  refreshPanel = refreshOutput;
  refreshOutput();
  panel.append(
    button(
      'Скачать файл',
      () => {
        refreshOutput();
        if (!output.value) throw new Error(warning.textContent!);
        const blob = new Blob([output.value], {
          type: format.value === 'netscape' ? 'text/plain' : 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const link = el('a');
        link.href = url;
        link.download = `cookiess-${context!.host.replace(/[^a-zA-Z0-9.-]/g, '_')}-${new Date().toISOString().slice(0, 10)}.${format.value === 'netscape' ? 'txt' : 'json'}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        notify('Файл подготовлен для скачивания.', 'success');
      },
      'primary',
      'export',
    ),
    button('Скопировать текст', async () => {
      refreshOutput();
      if (!output.value) throw new Error(warning.textContent!);
      try {
        await navigator.clipboard.writeText(output.value);
        notify('Текст скопирован.', 'success');
      } catch {
        output.focus();
        output.select();
        notify('Буфер недоступен. Текст выделен: нажмите Ctrl+C.');
      }
    }),
  );
  content.append(panel);
}
let timer: ReturnType<typeof setTimeout> | undefined;
chrome.cookies.onChanged.addListener(() => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!busy && ready && allowed)
      void reload().catch(() => {
        if (ready) notify('Не удалось перечитать cookies. Проверьте доступ.', 'error');
      });
  }, 150);
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (
    id === context?.tabId &&
    change.url &&
    new URL(change.url).origin !== new URL(context.url).origin
  ) {
    ready = false;
    lock(busy);
    notify('Сайт вкладки изменился. Нажмите обновление перед записью.', 'error');
  }
});
chrome.permissions.onRemoved.addListener(() => {
  ready = false;
  lock(busy);
  notify('Разрешение изменилось. Обновите контекст сайта.', 'error');
});
void initialize();
