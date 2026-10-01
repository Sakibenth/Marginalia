# Installing Marginalia on Windows

Requirements: Windows 10 or 11, 64-bit. About 280 MB once installed. No administrator rights needed.

## 1. Download

Get **`Marginalia-Setup-1.2.0.exe`** (84.5 MB) from the [latest release](../../../releases/latest).

To check the download is complete and unchanged, open Command Prompt in your Downloads folder and run:

```
certutil -hashfile Marginalia-Setup-1.2.0.exe SHA256
```

It should print `ed11e9d9fd21232fffe2cc3006e085491892d6774f66614440eba73d80caed95`.

## 2. Get past the Windows warning

Marginalia isn't signed with a paid certificate yet, so Windows will probably show
**"Windows protected your PC"**. Click **More info**, then **Run anyway**. Your browser may also call the
download uncommon; choose **Keep**.

On some Windows 11 PCs, **Smart App Control** blocks unsigned apps with no Run anyway button. Marginalia
can't be installed on those PCs until a signed version is released.

## 3. Install

Click **Next**, keep or change the folder (default `%LOCALAPPDATA%\Programs\Marginalia`), click
**Install**, then **Finish**. If Marginalia is already running, setup closes it first. Shortcuts are added
to the Start menu and the desktop. To update later, run a newer installer over the top; your boards are kept.

## 4. First launch

On some PCs Windows is missing a system file that the app's security sandbox needs. Marginalia detects
this, switches to **compatibility mode** and restarts itself once, so the window may close and reopen
during the first launch.

If the window stays blank, use **Help → Restart in safe mode** (turns off graphics acceleration).
**Help → About Marginalia** shows which mode you're in.

## 5. Your notes

Boards save automatically and stay on this computer in `%APPDATA%\Marginalia`. To back up or move
to another PC, open the boards list, choose **Export all boards**, and import that file on the other
computer. Export a board as a PDF to share it with someone who doesn't use Marginalia.

## 6. Uninstall

**Settings → Apps → Installed apps → Marginalia → Uninstall.** Your boards are kept in
`%APPDATA%\Marginalia`; delete that folder too if you want to remove everything.

## Problems?

**Help → Open log file** opens `%APPDATA%\Marginalia\logs\main.log`. Attach it when you
[open an issue](../../../issues). It records what the app did at startup and contains none of your notes.
