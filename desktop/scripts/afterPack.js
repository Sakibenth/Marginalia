'use strict';
// electron-builder hook: stamp Marginalia's icon and version details into Marginalia.exe.
// Uses resedit (pure JavaScript), so Windows builds can be made on Linux/macOS without Wine.
const fs = require('fs');
const path = require('path');
const ResEdit = require('resedit');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.exe');
  const pkg = context.packager.appInfo;
  const [maj, min, pat] = pkg.version.split('.').map(n => parseInt(n, 10) || 0);

  const exeObj = ResEdit.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exeObj);

  // replace the app icon (every icon group in the exe -> Marginalia icon)
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico')));
  const groups = res.entries.filter(e => e.type === 14);   // RT_GROUP_ICON
  if (!groups.length) throw new Error('No icon group found in ' + exe);
  for (const g of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, iconFile.icons.map(i => i.data));
  }

  // version / product details shown in Explorer > Properties > Details and Task Manager
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const lang = { lang: 1033, codepage: 1200 };
  vi.setStringValues(lang, {
    ProductName: 'Marginalia', FileDescription: 'Marginalia', CompanyName: pkg.companyName || 'Sakib',
    LegalCopyright: 'Copyright © 2026 Sakib', OriginalFilename: 'Marginalia.exe', InternalName: 'Marginalia',
    FileVersion: pkg.version, ProductVersion: pkg.version,
  });
  vi.setFileVersion(maj, min, pat, 0, 1033);
  vi.setProductVersion(maj, min, pat, 0, 1033);
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exeObj);
  fs.writeFileSync(exe, Buffer.from(exeObj.generate()));
  console.log('  • stamped icon + version info into', path.basename(exe));
};
