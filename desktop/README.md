# Marginalia Desktop

The desktop (Windows) version of Marginalia: read PDFs, videos, YouTube and websites side by side with a
pressure-sensitive notebook. It packages the web version (`Marginalia*.html`, one folder up) into an app.

## What the app adds over the browser version
- No Python / `.bat` needed: the local server and Reader view are built in (`server.js`).
- Live view can show sites that normally refuse to be embedded (the app drops `X-Frame-Options` /
  `frame-ancestors` for embedded frames only).
- Works offline: PDF.js, jsPDF, Readability, DOMPurify and the fonts are bundled.
- Article links open in your normal browser. Boards are stored in `%APPDATA%\Marginalia`
  and survive updates and uninstalls.

## Files
| File | Purpose |
|---|---|
| `main.js` | App window, menu, link handling, Live-view header rules |
| `server.js` | Built-in local server + safe article fetcher for Reader view |
| `preload.js` | Tells the page it runs in the desktop app |
| `scripts/prepare.js` | Builds `app/` from the newest `../Marginalia*.html`, bundling libraries + fonts |
| `scripts/afterPack.js` | Stamps the icon and version details into `Marginalia.exe` |
| `installer.nsi` | Windows installer script (NSIS) |
| `build/icon.png`, `build/icon.ico` | App icon |
| `LICENSE.txt` | Marginalia's own licence (MIT) |
| `THIRD_PARTY_LICENSES.txt` | Licences of the bundled libraries and fonts (Help → Open-source licences) |

## Rebuilding after you change Marginalia (on Windows)
1. Install Node.js LTS from https://nodejs.org
2. In this folder: `npm install`
3. `npm run dist`: prepares `app/` from your newest `..\Marginalia*.html` and builds
   `dist\Marginalia-Setup-<version>.exe` plus a portable zip.
4. To try it without building: `npm run prepare-app` then `npm start`.

Bump `"version"` in `package.json` for each new release. On Linux/macOS, `npm run dist` builds the
portable zip; build the installer there with `makensis -DVERSION=<version> installer.nsi` (NSIS 3).
