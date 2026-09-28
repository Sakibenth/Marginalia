'use strict';
// Tells the page it is running inside the desktop app (hides browser-only hints).
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('marginaliaDesktop', { isDesktop: true, platform: process.platform });
