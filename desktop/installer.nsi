; Marginalia installer (NSIS 3, Modern UI 2).  Build:  makensis -DVERSION=1.0.0 installer.nsi
Unicode true
SetCompressor /SOLID lzma
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "1.2.1"
!endif
!define APPNAME   "Marginalia"
!define PUBLISHER "Sakib"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Marginalia"
!define SRCDIR    "dist/win-unpacked"

Name "${APPNAME}"
OutFile "dist/Marginalia-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Marginalia"
InstallDirRegKey HKCU "${UNINSTKEY}" "InstallLocation"
RequestExecutionLevel user            ; per-user install: no administrator prompt
BrandingText "${APPNAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName"     "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "CompanyName"     "${PUBLISHER}"
VIAddVersionKey "LegalCopyright"  "Copyright (c) 2026 ${PUBLISHER}"
VIAddVersionKey "FileVersion"     "${VERSION}"
VIAddVersionKey "ProductVersion"  "${VERSION}"

!define MUI_ICON   "build/icon.ico"
!define MUI_UNICON "build/icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to Marginalia"
!define MUI_WELCOMEPAGE_TEXT  "Marginalia lets you read PDFs, videos, YouTube and websites side by side with a pressure-sensitive notebook.$\r$\n$\r$\nThis will install Marginalia ${VERSION} for your Windows account (no administrator rights needed).$\r$\n$\r$\nIf Marginalia is running (even invisibly in the background), setup will close it for you."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Marginalia.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start Marginalia now"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Marginalia" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  ; close any Marginalia that is still running (including one stuck in the background)
  DetailPrint "Closing Marginalia if it is running..."
  nsExec::Exec 'taskkill /F /T /IM "Marginalia.exe"'
  Pop $0
  Sleep 1000
  ; remove files from a previous version first (keeps your boards, which live in AppData\Roaming)
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "${SRCDIR}/*.*"
  WriteUninstaller "$INSTDIR\Uninstall Marginalia.exe"

  CreateShortcut "$SMPROGRAMS\Marginalia.lnk" "$INSTDIR\Marginalia.exe" "" "$INSTDIR\Marginalia.exe" 0
  CreateShortcut "$DESKTOP\Marginalia.lnk"    "$INSTDIR\Marginalia.exe" "" "$INSTDIR\Marginalia.exe" 0

  WriteRegStr   HKCU "${UNINSTKEY}" "DisplayName"     "${APPNAME}"
  WriteRegStr   HKCU "${UNINSTKEY}" "DisplayVersion"  "${VERSION}"
  WriteRegStr   HKCU "${UNINSTKEY}" "Publisher"       "${PUBLISHER}"
  WriteRegStr   HKCU "${UNINSTKEY}" "DisplayIcon"     "$INSTDIR\Marginalia.exe"
  WriteRegStr   HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall Marginalia.exe"'
  WriteRegStr   HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall Marginalia.exe" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" 280000
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\Marginalia.lnk"
  Delete "$DESKTOP\Marginalia.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
  ; Your boards are NOT deleted: they stay in %APPDATA%\Marginalia so a reinstall picks them up.
SectionEnd
