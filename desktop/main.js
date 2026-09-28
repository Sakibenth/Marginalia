'use strict';
const { app, BrowserWindow, Menu, session, shell, dialog, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { startServer, makeElectronFetch } = require('./server');

// Boards live in this app's storage, which is tied to the address the app is served from.
// Fixed ports keep that address (and therefore your boards) the same every time. They sit
// below Windows' dynamic range (49152+), which Hyper-V/WSL/Docker often reserve.
const PORTS = [38417, 38418, 38419, 38427, 41529];

// ---------------------------------------------------------------- logging
const USER_DATA = app.getPath('userData');
const LOG_DIR = path.join(USER_DATA, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'main.log');
function log(...parts) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    try { if (fs.statSync(LOG_FILE).size > 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old'); } catch (_) { /* no log yet */ }
    const line = parts.map(p => (typeof p === 'string' ? p : (p && p.stack) || JSON.stringify(p))).join(' ');
    fs.appendFileSync(LOG_FILE, new Date().toISOString() + '  ' + line + '\n');
  } catch (_) { /* never let logging break the app */ }
}

// ---------------------------------------------------------------- safe mode (graphics acceleration off)
// Some GPU drivers (often on laptops with two graphics chips) stop Chromium from drawing the window.
// If that is detected, Marginalia restarts itself in safe mode and remembers it.
const SAFE_FLAG = path.join(USER_DATA, 'safe-mode.txt');
const SAFE_MODE = process.argv.includes('--safe-mode') || fs.existsSync(SAFE_FLAG);
if (SAFE_MODE) app.disableHardwareAcceleration();

// Compatibility mode (Chromium sandbox off). On some Windows 11 PCs every helper process dies at start
// with 0xC0000135 / STATUS_DLL_NOT_FOUND (electron/electron#37862). Only there, Marginalia restarts
// with the sandbox off and remembers it. Everywhere else the sandbox stays on.
const DLL_NOT_FOUND = -1073741515;                       // 0xC0000135
const COMPAT_FLAG = path.join(USER_DATA, 'compat-no-sandbox.txt');
const COMPAT_MODE = process.argv.includes('--no-sandbox') || fs.existsSync(COMPAT_FLAG);
if (COMPAT_MODE) app.commandLine.appendSwitch('no-sandbox');

let restarting = false;                                   // restart only once, however many crashes arrive
function restartWith(args) {
  if (restarting) return true;
  restarting = true;
  app.relaunch({ args: process.argv.slice(1).filter(a => a !== '--safe-mode' && a !== '--no-sandbox').concat(args || []) });
  app.exit(0);
  return true;
}
function writeFlag(file, reason) {
  try { fs.mkdirSync(USER_DATA, { recursive: true }); fs.writeFileSync(file, reason + '\n' + new Date().toISOString() + '\n'); } catch (_) { /* ignore */ }
}
function enterCompatModeAndRestart(reason) {
  if (restarting) return true;
  if (COMPAT_MODE) { log('helpers still failing with the sandbox off (not restarting again):', reason); return false; }
  log('helper processes cannot start with the sandbox on (' + reason + ') — restarting in compatibility mode (sandbox off)');
  writeFlag(COMPAT_FLAG, reason);
  try { fs.unlinkSync(SAFE_FLAG); } catch (_) { /* earlier "graphics" crashes were this problem, not the GPU */ }
  return restartWith([]);
}
function enterSafeModeAndRestart(reason) {
  if (restarting) return true;
  if (SAFE_MODE) { log('problem in safe mode too (not restarting again):', reason); return false; }
  log('switching to safe mode and restarting because:', reason);
  writeFlag(SAFE_FLAG, reason);
  return restartWith([]);
}
function onHelperCrash(kind, d) {
  if (d.exitCode === DLL_NOT_FOUND) return enterCompatModeAndRestart(kind + ' exited with 0xC0000135 (DLL not found)');
  return enterSafeModeAndRestart(kind + ' ' + d.reason);
}

let win = null, baseUrl = '', booted = false, shown = false, loaded = false;

log('──── Marginalia', app.getVersion(), 'starting | electron', process.versions.electron, '| windows', require('os').release(),
    '| safe mode:', SAFE_MODE, '| compatibility (no sandbox):', COMPAT_MODE, '| exe:', process.execPath);

function fatal(title, err) {
  log('FATAL', title, err);
  try {
    dialog.showErrorBox('Marginalia could not start', title + '\n\n' + String((err && err.message) || err) +
      '\n\nA log was saved to:\n' + LOG_FILE);
  } catch (_) { /* ignore */ }
  app.exit(1);
}
process.on('uncaughtException', e => (booted ? log('uncaughtException', e) : fatal('Unexpected error during start-up', e)));
process.on('unhandledRejection', e => (booted ? log('unhandledRejection', e) : fatal('Unexpected error during start-up', e)));

app.setAppUserModelId('app.marginalia.desktop');   // proper taskbar grouping / name on Windows

if (!app.requestSingleInstanceLock()) {
  log('another Marginalia is already running — handing over to it and exiting');
  app.quit();
} else {
  app.on('second-instance', () => {
    log('second launch detected — bringing the window to the front');
    if (win) { if (!win.isVisible()) win.show(); if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(boot);
}

app.on('child-process-gone', (e, d) => {
  log('child process gone:', d.type, d.reason, 'exit', d.exitCode);
  if (d.exitCode === DLL_NOT_FOUND) onHelperCrash(d.type + ' process', d);             // sandbox incompatibility: always
  else if (d.type === 'GPU' && d.reason !== 'clean-exit' && !loaded) onHelperCrash('graphics process', d);
});

// What the GPU is really doing, once Chromium has finished probing it (the value at 'ready' can be preliminary).
let gpuLogged = false;
async function logGraphics() {
  try {
    const st = app.getGPUFeatureStatus();
    log('graphics now: canvas', st['2d_canvas'], '| compositing', st.gpu_compositing, '| rasterization', st.rasterization, '| webgl', st.webgl);
    const info = await app.getGPUInfo('basic').catch(() => null);
    if (info && info.gpuDevice) log('graphics devices:', info.gpuDevice.map(d => (d.active ? '*' : '') + (d.vendorString || d.vendorId) + ' ' + (d.deviceString || d.deviceId) + ' driver ' + (d.driverVersion || '?')).join(' | '));
    if (win) log('page graphics:', await win.webContents.executeJavaScript(
      "(()=>{try{const c=document.createElement('canvas');const g=c.getContext('webgl');const x=g&&g.getExtension('WEBGL_debug_renderer_info');" +
      "return JSON.stringify({dpr:devicePixelRatio,screen:screen.width+'x'+screen.height,webglRenderer:g?(x?g.getParameter(x.UNMASKED_RENDERER_WEBGL):'webgl on'):'webgl off'})}catch(e){return 'err '+e.message}})()"));
  } catch (e) { log('graphics check failed:', e.message); }
}
function isAppUrl(url) { return url === baseUrl || url.startsWith(baseUrl + '/'); }
function openOutside(url) { if (/^https?:\/\//i.test(url)) shell.openExternal(url); }
function showWindow(why) {
  if (!win || shown) return;
  shown = true;
  log('showing window (' + why + ')');
  win.maximize(); win.show(); win.focus();
}

async function boot() {
  const started = Date.now();
  log('app ready; gpu feature status:', app.getGPUFeatureStatus());
  const { port, preferred } = await startServer({ root: path.join(__dirname, 'app'), ports: PORTS, fetchImpl: makeElectronFetch(net), log });
  baseUrl = 'http://127.0.0.1:' + port;
  log('built-in server listening on', baseUrl, preferred ? '' : '(fallback port)');

  // Live view: many sites forbid being shown inside other pages (X-Frame-Options / CSP frame-ancestors).
  // Inside this app we drop those two restrictions for embedded frames only, so any site can be read there.
  session.defaultSession.webRequest.onHeadersReceived((details, done) => {
    if (details.resourceType !== 'subFrame' || !details.responseHeaders) return done({});
    const headers = {};
    for (const [k, v] of Object.entries(details.responseHeaders)) {
      const key = k.toLowerCase();
      if (key === 'x-frame-options') continue;
      if (key === 'content-security-policy') {
        headers[k] = v.map(p => p.split(';').filter(d => !/^\s*frame-ancestors\b/i.test(d)).join(';'));
        continue;
      }
      headers[k] = v;
    }
    done({ responseHeaders: headers });
  });
  // Nothing in Marginalia needs camera/mic/location etc. — refuse permission requests.
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'clipboard-sanitized-write' || perm === 'fullscreen'));

  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600,
    backgroundColor: '#0b0b12', title: 'Marginalia', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true,
    },
  });
  const wc = win.webContents;
  win.once('ready-to-show', () => { log('first paint after', Date.now() - started, 'ms'); showWindow('ready'); });
  // Never stay invisible: show the window after a few seconds even if the page hasn't drawn yet.
  setTimeout(() => showWindow('watchdog — page had not drawn yet'), 5000);
  // After the page has loaded AND the window is visible, take a snapshot of it. A blank snapshot means
  // the graphics driver isn't drawing anything -> restart in safe mode (graphics acceleration off).
  const verifyPainting = () => {
    if (!loaded || !shown || verifyPainting.done) return;
    verifyPainting.done = true;
    setTimeout(async () => {
      try {
        const img = await wc.capturePage();
        const sz = img.getSize();
        const empty = img.isEmpty() || !sz.width || !sz.height;
        log('paint check:', empty ? 'NOTHING DRAWN' : 'ok (' + sz.width + 'x' + sz.height + ')');
        if (empty) enterSafeModeAndRestart('window showed nothing (graphics driver)');
      } catch (e) { log('paint check failed:', e.message); }
    }, 2500);
  };
  win.on('show', verifyPainting);
  setTimeout(() => { if (!loaded) log('page still not loaded after 15 s'); }, 15000);

  wc.on('did-start-loading', () => log('page: start loading'));
  wc.on('did-finish-load', async () => {
    loaded = true;
    let state = '?';
    try { state = await wc.executeJavaScript("JSON.stringify({ready:!!window.__marginaliaReady, canvas:!!document.getElementById('drawCanvas'), libs:[typeof pdfjsLib,typeof Readability,typeof DOMPurify].join(',')})"); } catch (e) { state = 'check failed: ' + e.message; }
    log('page: loaded', state);
    verifyPainting();
    setTimeout(async () => {
      try { log('page: state after 3 s', await wc.executeJavaScript("JSON.stringify({ready:!!window.__marginaliaReady})")); } catch (_) { /* ignore */ }
    }, 3000);
    if (!gpuLogged) { gpuLogged = true; setTimeout(logGraphics, 4000); }
  });
  wc.on('did-fail-load', (e, code, desc, url, isMain) => {
    log('page: FAILED to load', code, desc, url, isMain ? '(main page)' : '(sub resource)');
    if (isMain && code !== -3) {
      showWindow('load failed');
      const html = '<body style="background:#0b0b12;color:#e4e2ee;font-family:Segoe UI,sans-serif;padding:48px">' +
        '<h2>Marginalia could not open its page</h2><p>Error: ' + desc + ' (' + code + ')</p>' +
        '<p>Try closing and reopening Marginalia. A log was saved to:<br><code>' + LOG_FILE.replace(/</g, '') + '</code></p></body>';
      wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    }
  });
  wc.on('render-process-gone', (e, d) => {
    log('page process gone:', d.reason, 'exit', d.exitCode);
    if (d.reason !== 'clean-exit' && !onHelperCrash('page process', d)) {
      showWindow('page crashed');
      dialog.showErrorBox('Marginalia', 'The page stopped unexpectedly (' + d.reason + '). Please restart Marginalia.\n\nLog: ' + LOG_FILE);
    }
  });
  wc.on('unresponsive', () => log('page: unresponsive'));
  wc.on('responsive', () => log('page: responsive again'));
  let consoleLines = 0;
  wc.on('console-message', (e, level, message, line, source) => {
    const lvl = typeof level === 'number' ? level : (e && e.level);
    const msg = message != null ? message : (e && e.message);
    const text = String(msg);
    if (text.startsWith('[perf]')) return log(text.slice(0, 400));                // stroke timing samples: always keep
    if (/willReadFrequently|Unrecognized feature|allow-scripts and allow-same-origin|Feature-Policy/.test(text)) return;  // harmless noise
    if (lvl >= 2 && consoleLines++ < 40) log('page console:', text.slice(0, 300), source ? '@ ' + String(source).slice(-60) + ':' + line : '');
  });

  // Links (article links, "Open original", etc.) open in your normal browser.
  wc.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!isAppUrl(url)) { e.preventDefault(); openOutside(url); } });
  wc.on('page-title-updated', e => e.preventDefault());

  buildMenu();
  wc.loadURL(baseUrl + '/index.html').catch(err => log('loadURL rejected:', err && err.message));
  booted = true;

  if (!preferred) {
    dialog.showMessageBox(win, {
      type: 'warning', title: 'Marginalia',
      message: 'Marginalia started on a different port than usual.',
      detail: 'Another program is using port ' + PORTS[0] + '. Your boards are stored per port, so you may see an empty board list until that program is closed and Marginalia is restarted.',
    });
  }
}

// A small menu: no Edit-menu shortcuts, so Ctrl+Z / Ctrl+A / Ctrl+D etc. reach Marginalia's canvas.
function buildMenu() {
  const menu = Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'quit', label: 'Exit' }] },
    { label: 'View', submenu: [
      { role: 'reload', label: 'Reload' },
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'toggleDevTools', label: 'Developer tools' },
    ] },
    { label: 'Help', submenu: [
      { label: 'Keyboard shortcuts', click: () => win && win.webContents.executeJavaScript("typeof openHelp==='function'&&openHelp()") },
      { type: 'separator' },
      { label: SAFE_MODE ? 'Turn off safe mode (use graphics acceleration)' : 'Restart in safe mode (no graphics acceleration)',
        click: () => {
          if (SAFE_MODE) { try { fs.unlinkSync(SAFE_FLAG); } catch (_) { /* ignore */ } app.relaunch({ args: process.argv.slice(1).filter(a => a !== '--safe-mode') }); app.exit(0); }
          else enterSafeModeAndRestart('chosen from the Help menu');
        } },
      { label: 'Open log file', click: () => shell.openPath(LOG_FILE) },
      ...(COMPAT_MODE && !process.argv.includes('--no-sandbox') ? [{ label: 'Try again with the sandbox on', click: () => { try { fs.unlinkSync(COMPAT_FLAG); } catch (_) { /* ignore */ } restartWith([]); } }] : []),
      { label: 'Open data folder', click: () => shell.openPath(USER_DATA) },
      { label: 'Open-source licences', click: () => shell.openPath(path.join(app.isPackaged ? process.resourcesPath : __dirname, 'THIRD_PARTY_LICENSES.txt')) },
      { type: 'separator' },
      { label: 'About Marginalia', click: () => dialog.showMessageBox(win, {
          title: 'About Marginalia', message: 'Marginalia ' + app.getVersion() + (SAFE_MODE ? '  (safe mode)' : '') + (COMPAT_MODE ? '  (compatibility mode)' : ''),
          detail: 'Read PDFs, videos and websites side by side with a pressure-sensitive notebook.\n\nYour boards are stored on this computer in:\n' + USER_DATA,
        }) },
    ] },
  ]);
  Menu.setApplicationMenu(menu);
}

app.on('window-all-closed', () => { log('window closed — quitting'); app.quit(); });
