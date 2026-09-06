/**
 * Reads COMPUTED styles out of a real Chrome, over the DevTools protocol.
 *
 * Written because a cascade bug is invisible everywhere else: the token was
 * right, the class was on the element, the rule was in the stylesheet, and the
 * colour was still wrong. Only `getComputedStyle` in the browser settles it.
 *
 *   node scripts/_computed.js dark    # emulate prefers-color-scheme
 *   node scripts/_computed.js light
 */
const { spawn } = require('node:child_process');

const SCHEME = process.argv[2] === 'light' ? 'light' : 'dark';
const CHROME = process.env.CHROME_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9444;
const BASE = 'http://localhost:3000';

/** [url, css selector, what it should be] */
const CASES = [
  ['/events', 'a[aria-current="page"]', 'the active filter pill — text-on-accent'],
  ['/events', 'form button[type="submit"]', 'the search button — text-on-accent'],
  ['/', 'main a[href="/events"]', 'a link with text-accent or on a filled button'],
  ['/how-it-works', 'a[href="#buying"]', 'an in-page link — text-accent'],
  ['/trust', 'h2', 'a heading — font-serif from the base layer'],
];

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

(async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}\\cdp-computed`,
    'about:blank',
  ], { stdio: 'ignore' });

  // Chrome takes its time opening the debugging port on a cold profile, and a
  // single sleep is a race that fails about half the time on this machine.
  let targets = null;
  for (let attempt = 0; attempt < 20 && !targets; attempt += 1) {
    await sleep(1500);
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    } catch { /* not listening yet */ }
  }
  if (!targets) throw new Error('Chrome never opened its debugging port');

  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise((res) => {
    const i = (id += 1);
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Page.enable');
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: SCHEME }],
  });

  console.log(`prefers-color-scheme: ${SCHEME}\n`);

  for (const [path, selector, note] of CASES) {
    await send('Page.navigate', { url: BASE + path });
    await sleep(3500);

    const expression = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify({ missing: true });
      const cs = getComputedStyle(el);
      const root = getComputedStyle(document.documentElement);
      return JSON.stringify({
        color: cs.color,
        background: cs.backgroundColor,
        fontFamily: cs.fontFamily.split(',')[0],
        inherited: getComputedStyle(document.body).color,
        accent: root.getPropertyValue('--es-accent').trim(),
        onAccent: root.getPropertyValue('--es-text-on-accent').trim(),
      });
    })()`;

    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    const v = JSON.parse(r.result.value);
    if (v.missing) {
      console.log(`  ${path.padEnd(15)} ${selector}  NOT FOUND`);
      continue;
    }
    const inheritedInstead = v.color === v.inherited;
    console.log(
      `  ${path.padEnd(15)} ${selector}\n`
      + `      ${note}\n`
      + `      color ${v.color}   on ${v.background}   font ${v.fontFamily}\n`
      + `      ${inheritedInstead ? 'INHERITED — a utility lost the cascade' : 'applied'}\n`,
    );
  }

  chrome.kill();
  process.exit(0);
})();
