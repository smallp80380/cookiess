import './style.css';
import { CookieApi, applyImport, previewImport, type ImportItem } from './api';
import { decodeValue } from './decode';
import {
  accessPattern,
  clampLifetime,
  identity,
  partitionIdentity,
  validateCookie,
  type Cookie,
  type SiteContext,
} from './domain';
import { parse, serialize, type Format } from './formats';
import { applyDocumentLanguage, setLanguage, t, type LanguagePreference } from './i18n';
import {
  expiryLabel,
  formatDate,
  formatRelative,
  fromLocalInput,
  toLocalInput,
  visibleCookies,
  type FlagFilter,
  type SortKey,
} from './view';

// Language and theme are read before the first render so the popup never flashes the
// wrong language. Storage failures fall back to the browser language and system theme.
const preferences = await chrome.storage.local
  .get(['theme', 'lang'])
  .catch(() => ({}) as Record<string, unknown>);
const languagePreference: LanguagePreference =
  preferences.lang === 'ru' || preferences.lang === 'en' ? preferences.lang : 'auto';
setLanguage(languagePreference);
applyDocumentLanguage();

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
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
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
function select(label: string, options: [string, string][], value: string): HTMLSelectElement {
  const s = el('select');
  s.setAttribute('aria-label', label);
  for (const [v, text] of options) {
    const o = el('option', '', text);
    o.value = v;
    s.append(o);
  }
  s.value = value;
  return s;
}
const unnamed = (cookie: Cookie): string => cookie.name || t('unnamed');
let context: SiteContext | undefined;
let cookies: Cookie[] = [];
let selected = new Set<string>();
let screen: 'list' | 'editor' | 'import' | 'export' | 'remove' = 'list';
let dirty = false;
let busy = false;
let query = '';
let sort: SortKey = 'name';
let flag: FlagFilter = 'all';
let allowed = false;
let ready = false;
let loadVersion = 0;
let refreshPanel: (() => void) | undefined;
// The last deletion stays in popup memory only, so it can be undone until the popup closes.
let lastDeleted: Cookie[] = [];
const brand = el('header', 'brand');
const logo = el('div', 'wordmark');
logo.append(icon('cookie'), el('strong', '', 'Cookiess'), el('span', 'edition', 'LOCAL'));
const theme = select(
  t('theme'),
  [
    ['system', t('themeSystem')],
    ['light', t('themeLight')],
    ['dark', t('themeDark')],
  ],
  preferences.theme === 'light' || preferences.theme === 'dark' ? preferences.theme : 'system',
);
theme.className = 'theme';
function setTheme(value: string) {
  document.documentElement.dataset.theme = value;
}
setTheme(theme.value);
theme.onchange = () => {
  setTheme(theme.value);
  void chrome.storage.local.set({ theme: theme.value }).catch(() => undefined);
};
const language = select(
  t('language'),
  [
    ['auto', t('languageAuto')],
    ['ru', 'Русский'],
    ['en', 'English'],
  ],
  languagePreference,
);
language.className = 'language';
language.onchange = () => {
  if (!leave()) {
    language.value = languagePreference;
    return;
  }
  void chrome.storage.local
    .set({ lang: language.value })
    .catch(() => undefined)
    .then(() => location.reload());
};
const brandControls = el('div', 'brand-controls');
brandControls.append(language, theme);
brand.append(logo, brandControls);
const site = el('section', 'site');
const host = el('h1', '', t('currentSite'));
const contextLabel = el('p', 'muted', t('contextDefault'));
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
refresh.setAttribute('aria-label', t('refreshLabel'));
const back = button(
  t('back'),
  async () => {
    if (!leave()) return;
    notify('');
    if (!ready || !allowed) await initialize();
    else renderList();
  },
  'back-button',
  'back',
);
back.setAttribute('aria-label', t('backLabel'));
const navigation = el('div', 'site-navigation');
navigation.append(back, refresh);
site.append(navigation, siteText);
const status = el('div', 'status');
status.setAttribute('role', 'status');
status.setAttribute('aria-live', 'polite');
const content = el('main', 'content');
const footer = el('footer', 'actions');
const actionButtons = [
  button(t('import'), () => openImport(), '', 'import'),
  button(t('export'), () => openExport(), '', 'export'),
  button(t('add'), () => openEditor(), 'primary', 'add'),
  button(t('remove'), () => openRemove(), 'danger', 'remove'),
];
footer.append(...actionButtons);
app.append(brand, site, status, content, footer);
function notify(
  message: string,
  kind = 'info',
  action?: { label: string; run: () => void | Promise<void> },
) {
  status.replaceChildren();
  status.dataset.kind = kind;
  status.hidden = !message;
  if (!message) return;
  status.append(el('span', '', message));
  if (action) status.append(button(action.label, action.run, 'status-action'));
}
function notifyList(
  summary: string,
  details: string[],
  kind: string,
  action?: { label: string; run: () => void | Promise<void> },
  limit = 3,
) {
  const shown = details.slice(0, limit);
  const more = details.length - shown.length;
  notify(
    [summary, ...shown, ...(more > 0 ? [t('andMore', { n: more })] : [])].join('\n'),
    kind,
    action,
  );
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
    notify(error instanceof Error ? error.message : t('operationFailed'), 'error');
  } finally {
    lock(false);
  }
}
function leave(): boolean {
  if (dirty && !confirm(t('confirmLeave'))) return false;
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
  lastDeleted = [];
  selected.clear();
  screen = 'list';
  notify('');
  state(t('loadingTitle'), t('loadingText'));
  try {
    const next = await api.context();
    if (version !== loadVersion) return;
    context = next;
    host.textContent = context.host;
    host.title = context.host;
    contextLabel.textContent = t('contextLabel', { store: context.storeId });
    allowed = await api.hasAccess(context);
    if (!allowed) {
      state(
        t('accessTitle'),
        t('accessText', {
          pattern: accessPattern(context.host).replace('*://', '').replace('/*', ''),
        }),
        button(
          t('grantAccess'),
          async () => {
            if (!context) return;
            // request must start in the click's user gesture, before any awaited API call.
            const granted = await api.requestAccess(context);
            if (!granted) {
              notify(t('accessDenied'), 'error');
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
      t('siteUnavailable'),
      error instanceof Error ? error.message : t('loadFailed'),
      button(t('retry'), initialize),
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
  if (
    context &&
    next.tabId === context.tabId &&
    next.host === context.host &&
    next.storeId === context.storeId &&
    new URL(next.url).origin === new URL(context.url).origin &&
    (await api.hasAccess(next))
  ) {
    // Keep the current form and its dirty draft when the site context is unchanged.
    const key = next.partitionKey;
    if (partitionIdentity(key) === partitionIdentity(context.partitionKey)) {
      context = { ...next, partitionKey: key };
      allowed = true;
      ready = true;
      await reload();
      refreshPanel?.();
      notify(t('refreshed'), 'success');
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
async function copyText(text: string, fallback?: HTMLTextAreaElement) {
  try {
    await navigator.clipboard.writeText(text);
    notify(t('copied'), 'success');
  } catch {
    if (!fallback) throw new Error(t('clipboardUnavailable'));
    fallback.focus();
    fallback.select();
    notify(t('clipboardManual'));
  }
}
function download(text: string, format: Format, suffix = '') {
  const blob = new Blob([text], {
    type: format === 'netscape' ? 'text/plain' : 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = `cookiess-${context!.host.replace(/[^a-zA-Z0-9.-]/g, '_')}${suffix}-${new Date().toISOString().slice(0, 10)}.${format === 'netscape' ? 'txt' : 'json'}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function restoreDeleted() {
  if (!context || !lastDeleted.length) return;
  const items = previewImport(lastDeleted, cookies, context, 'skip');
  const result = await applyImport(items, context, api, 'skip');
  const total = lastDeleted.length;
  lastDeleted = [];
  await reload();
  if (screen !== 'list') renderList();
  const problems = [
    ...items
      .filter((i) => i.action === 'skip' && i.reason)
      .map((i) => `${unnamed(i.cookie)}: ${i.reason}`),
    ...result.errors,
  ];
  notifyList(
    t('restored', { done: result.success, total }),
    problems,
    result.success === total ? 'success' : 'error',
  );
}
function offerUndo(message: string, kind: string, removed: Cookie[], details: string[] = []) {
  lastDeleted = removed;
  notifyList(
    message,
    details,
    kind,
    removed.length ? { label: t('undo'), run: restoreDeleted } : undefined,
  );
}
function renderList() {
  refreshPanel = undefined;
  screen = 'list';
  dirty = false;
  content.replaceChildren();
  const tools = el('div', 'tools');
  const search = el('input', 'search');
  search.type = 'search';
  search.placeholder = t('searchPlaceholder');
  search.setAttribute('aria-label', t('searchLabel'));
  search.value = query;
  const filter = select(
    t('filterLabel'),
    [
      ['all', t('filterAll')],
      ['secure', 'Secure'],
      ['httpOnly', 'HttpOnly'],
      ['session', t('filterSession')],
      ['persistent', t('filterPersistent')],
      ['partitioned', t('filterPartitioned')],
    ],
    flag,
  );
  const order = select(
    t('sortLabel'),
    [
      ['name', t('sortName')],
      ['domain', t('sortDomain')],
      ['path', t('sortPath')],
      ['expiry', t('sortExpiry')],
    ],
    sort,
  );
  tools.append(search, filter, order);
  const summary = el('div', 'list-summary');
  const count = el('span');
  const all = el('input');
  all.type = 'checkbox';
  all.setAttribute('aria-label', t('selectAllVisible'));
  summary.append(all, count);
  const list = el('div', 'cookie-list');
  list.setAttribute('aria-label', t('listLabel'));
  content.append(tools, summary, list);
  function draw() {
    const visible = visibleCookies(cookies, query, sort, flag);
    count.textContent =
      t('countSummary', { visible: visible.length, total: cookies.length }) +
      (selected.size ? t('countSelected', { n: selected.size }) : '');
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
        el('h2', '', cookies.length ? t('nothingFound') : t('noCookiesTitle')),
        el('p', 'muted', cookies.length ? t('nothingFoundText') : t('noCookiesText')),
      );
      list.append(empty);
    }
    for (const cookie of visible) {
      const row = el('div', 'cookie-row');
      const label = `${unnamed(cookie)} ${cookie.path}`;
      const checkbox = el('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected.has(identity(cookie));
      checkbox.setAttribute('aria-label', t('selectRow', { label }));
      checkbox.onchange = () => {
        if (checkbox.checked) selected.add(identity(cookie));
        else selected.delete(identity(cookie));
        draw();
      };
      const edit = button('', () => openEditor(cookie), 'cookie-details');
      edit.setAttribute('aria-label', t('editRow', { label }));
      const first = el('div', 'row-first');
      first.append(el('strong', 'cookie-name', unnamed(cookie)));
      const flags = el('span', 'flags');
      for (const f of [
        cookie.secure ? 'S' : '',
        cookie.httpOnly ? 'H' : '',
        cookie.partitionKey ? 'P' : '',
        cookie.session ? 'session' : '',
      ])
        if (f) flags.append(el('small', 'flag', f));
      first.append(flags);
      const value = el('span', 'cookie-value', cookie.value || t('emptyValue'));
      const scope = el('span', 'cookie-scope');
      scope.append(`${cookie.domain} · ${cookie.path}`);
      if (!cookie.session && cookie.expirationDate !== undefined) {
        const expiry = el('span', 'cookie-expiry', ` · ${expiryLabel(cookie)}`);
        expiry.title = formatDate(cookie.expirationDate);
        scope.append(expiry);
      }
      edit.append(first, value, scope);
      const copy = button('', () => copyText(cookie.value), 'icon-button row-copy', 'copy');
      copy.setAttribute('aria-label', t('copyRow', { label }));
      copy.title = t('copyValue');
      const remove = button(
        '',
        async () => {
          if (
            confirm(
              t('confirmRemoveOne', { name: unnamed(cookie), where: cookie.domain + cookie.path }),
            )
          ) {
            await api.remove(cookie, context!);
            await reload();
            offerUndo(t('removedOne'), 'success', [cookie]);
          }
        },
        'icon-button row-remove',
        'remove',
      );
      remove.setAttribute('aria-label', t('removeRow', { label }));
      row.append(checkbox, edit, copy, remove);
      list.append(row);
    }
  }
  search.oninput = () => {
    query = search.value;
    draw();
  };
  filter.onchange = () => {
    flag = filter.value as FlagFilter;
    draw();
  };
  order.onchange = () => {
    sort = order.value as SortKey;
    draw();
  };
  draw();
}
function openEditor(original?: Cookie, template?: Cookie) {
  if (!context || !leave()) return;
  notify('');
  screen = 'editor';
  content.replaceChildren();
  backHeader(original ? t('editTitle') : template ? t('duplicateTitle') : t('newTitle'));
  const initial: Cookie = original ??
    template ?? {
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
  field('name', t('fieldName'), 'text', initial.name);
  const valueInput = field('value', t('fieldValue'), 'textarea', initial.value);
  const decoded = el('details', 'decode');
  const decodedSummary = el('summary', '', t('decodeTitle'));
  const decodedBody = el('div', 'decode-body');
  decoded.append(decodedSummary, decodedBody);
  form.append(decoded);
  function refreshDecoded() {
    const views = decodeValue(valueInput.value);
    decoded.hidden = !views.length;
    decodedBody.replaceChildren(
      ...views.flatMap((v) => [
        el('span', 'decode-kind', t(`decode_${v.kind}`)),
        el('pre', 'decode-text', v.text),
      ]),
    );
  }
  refreshDecoded();
  valueInput.addEventListener('input', refreshDecoded);
  const grid = el('div', 'form-grid');
  form.append(grid);
  for (const [key, label] of [
    ['domain', t('fieldDomain')],
    ['path', t('fieldPath')],
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
  const same = select(
    'SameSite',
    [
      ['unspecified', t('sameSiteUnspecified')],
      ['lax', 'Lax'],
      ['strict', 'Strict'],
      ['no_restriction', 'None'],
    ],
    initial.sameSite,
  );
  same.id = 'field-sameSite';
  inputs.sameSite = same;
  const sameError = el('small', 'field-error');
  errors.sameSite = sameError;
  sameWrapper.append(same, sameError);
  form.append(sameWrapper);
  const expiry = field(
    'expirationDate',
    t('fieldExpiry'),
    'number',
    String(initial.expirationDate ?? Math.floor(Date.now() / 1000) + 86400),
  ) as HTMLInputElement;
  const localWrapper = el('label', 'field');
  localWrapper.append(el('span', '', t('fieldExpiryLocal')));
  const local = el('input');
  local.type = 'datetime-local';
  local.step = '1';
  local.id = 'field-expirationLocal';
  localWrapper.append(local);
  form.append(localWrapper);
  const expiryNote = el('p', 'note expiry-note');
  form.append(expiryNote);
  function refreshExpiry(source: 'number' | 'local' | 'init') {
    if (source === 'local') {
      const seconds = fromLocalInput(local.value);
      if (seconds !== undefined) expiry.value = String(Math.floor(seconds));
    } else local.value = toLocalInput(Number(expiry.value));
    const session = (inputs.session as HTMLInputElement).checked;
    expiry.disabled = session;
    local.disabled = session;
    const seconds = Number(expiry.value);
    if (session || !Number.isFinite(seconds)) {
      expiryNote.textContent = '';
      return;
    }
    const capped = clampLifetime({ ...initial, session: false, expirationDate: seconds });
    expiryNote.textContent = capped.clamped
      ? t('expiryWillClamp', { date: formatDate(capped.cookie.expirationDate!) })
      : formatRelative(seconds);
    expiryNote.dataset.kind = capped.clamped ? 'warning' : '';
  }
  expiry.addEventListener('input', () => refreshExpiry('number'));
  local.addEventListener('input', () => refreshExpiry('local'));
  inputs.session.addEventListener('change', () => refreshExpiry('init'));
  refreshExpiry('init');
  field(
    'partitionKey',
    t('fieldPartition'),
    'textarea',
    initial.partitionKey ? JSON.stringify(initial.partitionKey) : '',
  );
  form.append(el('p', 'note', t('editorNote', { store: context.storeId })));
  form.oninput = () => {
    dirty = true;
  };
  form.onchange = () => {
    dirty = true;
  };
  const controls = el('div', 'form-actions');
  const cancel = button(t('cancel'), () => {
    if (leave()) renderList();
  });
  const save = el('button', 'primary', t('save'));
  save.type = 'submit';
  if (original) {
    const duplicate = button(t('duplicate'), () => {
      openEditor(undefined, { ...original, name: `${original.name}_copy` });
    });
    controls.append(duplicate);
  }
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
        errors.partitionKey.textContent = t('partitionInvalid');
        inputs.partitionKey.focus();
        return;
      }
      const isSession = (inputs.session as HTMLInputElement).checked;
      const draft: Cookie = {
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
      // Chrome caps lifetimes at 400 days; store the capped value the note announced.
      const { cookie, clamped } = clampLifetime(draft);
      const validation = validateCookie(cookie, context);
      if (Object.keys(validation).length) {
        for (const [key, message] of Object.entries(validation)) {
          if (errors[key]) errors[key].textContent = message;
        }
        inputs[Object.keys(validation)[0]]?.focus();
        return;
      }
      if (original && identity(original) !== identity(cookie) && !confirm(t('confirmIdentity')))
        return;
      try {
        await api.save(cookie, original, context!);
        dirty = false;
        await reload();
        renderList();
        notify(clamped ? t('savedClamped') : t('saved'), 'success');
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
  backHeader(t('removeTitle'));
  const panel = el('div', 'form');
  panel.append(
    el(
      'p',
      '',
      t('removeSummary', { selected: selected.size, host: context.host, total: cookies.length }),
    ),
  );
  const backupLabel = el('label', 'check-line');
  const backup = el('input');
  backup.type = 'checkbox';
  backup.id = 'remove-backup';
  backupLabel.append(backup, el('span', '', t('backupBeforeRemove')));
  const removeSelected = button(
    t('removeSelected', { n: selected.size }),
    () =>
      deleteMany(
        cookies.filter((c) => selected.has(identity(c))),
        backup.checked,
      ),
    'danger',
    'remove',
  );
  removeSelected.disabled = !selected.size;
  const all = button(
    t('removeAll', { n: cookies.length }),
    () => deleteMany([...cookies], backup.checked),
    'danger',
  );
  all.disabled = !cookies.length;
  panel.append(backupLabel, removeSelected, all, el('p', 'note', t('undoNote')));
  refreshPanel = openRemove;
  content.append(panel);
}
async function deleteMany(items: Cookie[], backup: boolean) {
  if (!items.length) {
    notify(t('selectFirst'));
    return;
  }
  if (!confirm(t('confirmRemoveMany', { n: items.length, host: context!.host }))) return;
  if (backup) download(serialize(items, 'cookiess').text, 'cookiess', '-backup');
  const removed: Cookie[] = [];
  const errors: string[] = [];
  // Short paths first reduce URL ambiguity without widening selected scope.
  for (const cookie of [...items].sort((a, b) => a.path.length - b.path.length))
    try {
      await api.remove(cookie, context!);
      removed.push(cookie);
    } catch (error) {
      errors.push(
        `${unnamed(cookie)} ${cookie.path}: ${error instanceof Error ? error.message : t('removeFailed')}`,
      );
    }
  await reload();
  renderList();
  const message = t('removedMany', { done: removed.length, total: items.length });
  offerUndo(
    errors.length ? `${message} ${t('errorsCount', { n: errors.length })}` : message,
    errors.length ? 'error' : 'success',
    removed,
    errors,
  );
}
function openImport() {
  if (!context || !leave()) return;
  notify('');
  screen = 'import';
  content.replaceChildren();
  backHeader(t('importTitle'));
  const panel = el('div', 'form');
  const fileLabel = el('label', 'field');
  fileLabel.append(el('span', '', t('importFile')));
  const file = el('input');
  file.type = 'file';
  file.accept = '.json,.txt';
  fileLabel.append(file);
  panel.append(fileLabel);
  const textLabel = el('label', 'field');
  textLabel.append(el('span', '', t('importPaste')));
  const text = el('textarea', 'import-text');
  text.rows = 7;
  textLabel.append(text);
  panel.append(textLabel);
  file.onchange = () =>
    void run(async () => {
      const selectedFile = file.files?.[0];
      if (!selectedFile) return;
      if (selectedFile.size > 10_000_000) throw new Error(t('fileTooLarge'));
      text.value = await selectedFile.text();
      dirty = true;
      invalidate();
    });
  const policyLabel = el('label', 'field');
  policyLabel.append(el('span', '', t('conflictPolicy')));
  const policy = select(
    t('conflictPolicy'),
    [
      ['replace', t('policyReplace')],
      ['skip', t('policySkip')],
    ],
    'replace',
  );
  policyLabel.append(policy);
  panel.append(policyLabel);
  const preview = el('div', 'preview');
  preview.setAttribute('aria-live', 'polite');
  let items: ImportItem[] = [];
  let parseErrors: string[] = [];
  const progress = el('p', 'import-progress');
  progress.hidden = true;
  const cancelImport = el('button', '', t('cancelImport'));
  cancelImport.type = 'button';
  cancelImport.hidden = true;
  let controller: AbortController | undefined;
  // Not wrapped in run(): it must work while the import holds the busy lock.
  cancelImport.onclick = () => {
    controller?.abort();
    cancelImport.disabled = true;
  };
  const apply = button(
    t('applyImport'),
    async () => {
      controller = new AbortController();
      cancelImport.hidden = false;
      cancelImport.disabled = false;
      progress.hidden = false;
      let result;
      try {
        result = await applyImport(items, context!, api, policy.value as 'replace' | 'skip', {
          signal: controller.signal,
          onProgress: (done, total) => {
            progress.textContent = t('importProgress', { done, total });
          },
        });
      } finally {
        cancelImport.hidden = true;
        progress.hidden = true;
        controller = undefined;
      }
      dirty = false;
      await reload();
      const errors = result.errors.length + parseErrors.length;
      const head = result.cancelled
        ? t('importCancelled')
        : errors
          ? t('importPartial')
          : t('importDone');
      notify(
        t('importResult', {
          head,
          success: result.success,
          skipped: result.skipped,
          errors,
        }),
        errors || result.cancelled ? 'error' : 'success',
      );
      preview.replaceChildren(
        el(
          'p',
          '',
          t('importResultLine', { success: result.success, skipped: result.skipped, errors }),
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
  const inspect = button(t('preview'), async () => {
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
        t('previewCount', {
          add: items.filter((i) => i.action === 'add').length,
          replace: items.filter((i) => i.action === 'replace').length,
          skip: items.filter((i) => i.action === 'skip').length,
          errors: parsed.errors.length,
        }),
      ),
    );
    for (const warning of parsed.warnings) preview.append(el('p', 'note', warning));
    for (const error of parsed.errors) preview.append(el('p', 'field-error', error));
    for (const item of items)
      preview.append(
        el(
          'p',
          'preview-item',
          `${t(item.action === 'add' ? 'actionAdd' : item.action === 'replace' ? 'actionReplace' : 'actionSkip')}: ${unnamed(item.cookie)} · ${item.cookie.domain}${item.cookie.path}${item.reason ? ` — ${item.reason}` : ''}`,
        ),
      );
    preview.append(el('p', 'note', t('importNote')));
    apply.disabled = !items.some((i) => i.action !== 'skip');
    preview.scrollIntoView({ block: 'nearest' });
  });
  panel.append(inspect, preview, progress, apply, cancelImport);
  content.append(panel);
}
function openExport() {
  if (!context || !leave()) return;
  notify('');
  screen = 'export';
  content.replaceChildren();
  backHeader(t('exportTitle'));
  const panel = el('div', 'form');
  const scopeLabel = el('label', 'field');
  scopeLabel.append(el('span', '', t('exportScope')));
  const scope = select(
    t('exportScope'),
    [
      ['all', t('exportAll', { n: cookies.length })],
      ['selected', t('exportSelected', { n: selected.size })],
    ],
    selected.size ? 'selected' : 'all',
  );
  scopeLabel.append(scope);
  panel.append(scopeLabel);
  const formatLabel = el('label', 'field');
  formatLabel.append(el('span', '', t('exportFormat')));
  const format = select(
    t('exportFormat'),
    [
      ['cookiess', t('formatCookiess')],
      ['cookie-editor', 'Cookie-Editor JSON'],
      ['netscape', t('formatNetscape')],
    ],
    'cookiess',
  );
  formatLabel.append(format);
  panel.append(formatLabel);
  panel.append(el('p', 'note', t('exportNote')));
  const warning = el('p', 'note');
  const outputLabel = el('label', 'field');
  outputLabel.append(el('span', '', t('exportManual')));
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
      warning.textContent = error instanceof Error ? error.message : t('exportFailed');
    }
  }
  scope.onchange = refreshOutput;
  format.onchange = refreshOutput;
  refreshPanel = refreshOutput;
  refreshOutput();
  panel.append(
    button(
      t('downloadFile'),
      () => {
        refreshOutput();
        if (!output.value) throw new Error(warning.textContent!);
        download(output.value, format.value as Format);
        notify(t('downloadReady'), 'success');
      },
      'primary',
      'export',
    ),
    button(t('copyText'), async () => {
      refreshOutput();
      if (!output.value) throw new Error(warning.textContent!);
      await copyText(output.value, output);
    }),
  );
  content.append(panel);
}
function markStale() {
  ready = false;
  lock(busy);
  notify(t('tabChanged'), 'error');
}
let timer: ReturnType<typeof setTimeout> | undefined;
chrome.cookies.onChanged.addListener(() => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!busy && ready && allowed)
      void reload().catch(() => {
        if (ready) notify(t('reloadFailed'), 'error');
      });
  }, 150);
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (id !== context?.tabId) return;
  const known = context;
  if (change.url) {
    if (new URL(change.url).origin !== new URL(known.url).origin) markStale();
    return;
  }
  // Without host access to the new site Chrome omits change.url. A load start is then the
  // only signal, so re-read the tab: a different origin or a lost URL marks writes stale.
  if (change.status === 'loading' && ready)
    void api.context().then(
      (next) => {
        if (context === known && new URL(next.url).origin !== new URL(known.url).origin)
          markStale();
      },
      () => {
        if (context === known) markStale();
      },
    );
});
chrome.permissions.onRemoved.addListener(() => {
  ready = false;
  lock(busy);
  notify(t('permissionChanged'), 'error');
});
void initialize();
