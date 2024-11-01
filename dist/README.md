# INSTALL

## Chromium

1. Download and unzip `ublock0.chromium.zip` ([latest release desirable](https://github.com/gorhill/uBlock/releases)).
2. Rename the unzipped directory to `ublock`.
   - When you update manually, replace the **content** of the `ublock` folder with the **content** of the latest zipped version. This ensures all extension settings are preserved.
   - As long as the extension loads from the same folder path as it was originally installed, your settings will be kept.
3. Open Chromium/Chrome and go to *Extensions*.
4. Click to enable *Developer mode*.
5. Click *Load unpacked extension...*.
6. In the file selector dialog:
   - Select the `ublock` directory you created.
   - Click *Open*.

The extension will now be available in your Chromium/Chromium-based browser.

**Note:** You must update manually. For some users, manual updates are beneficial because:
- You can update when **you** want.
- If a new version is unsatisfactory, you can easily reinstall the previous one.

## Firefox

Compatible with Firefox 52 and beyond.

### For Stable Release Version

This method only works if you set `xpinstall.signatures.required` to `false` in `about:config`.<sup>[see "Add-on signing in Firefox"](https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox)</sup>

1. Download `ublock0.firefox.xpi` ([latest release desirable](https://github.com/gorhill/uBlock/releases)).
   - Right-click and choose _"Save As..."_.
2. Drag and drop the downloaded `ublock0.firefox.xpi` into Firefox.

### For Beta Version

- Click on `ublock0.firefox.signed.xpi` ([latest release desirable](https://github.com/gorhill/uBlock/releases)).

### Location of uBO Settings

On Linux, the settings are saved in a JSON file located at:
```
~/.mozilla/firefox/[profile name]/browser-extension-data/uBlock0@raymondhill.net/storage.js
```
When you uninstall the extension, Firefox deletes this file, and all your settings will be lost.

### Firefox Legacy

Compatible with Firefox 24-56, [Pale Moon](https://www.palemoon.org/), and [SeaMonkey](https://www.seamonkey-project.org/).

1. Download `ublock0.firefox-legacy.xpi` ([latest release desirable](https://github.com/gorhill/uBlock-for-firefox-legacy/releases)).
   - Right-click and select "Save Link As..."
2. Drag and drop the downloaded `ublock0.firefox-legacy.xpi` into Firefox.

For Firefox 43 and beyond, you may need to toggle the setting `xpinstall.signatures.required` to `false` in `about:config`.<sup>[see "Add-on signing in Firefox"](https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox)</sup>

Your uBlock Origin settings are preserved even after uninstalling the addon.

- On Linux, settings are saved in a SQLite file located at:
```
~/.mozilla/firefox/[profile name]/extension-data/ublock0.sqlite
```
- On Windows, settings are saved in a SQLite file located at:
```
%APPDATA%\Mozilla\Firefox\Profiles\[profile name]\extension-data\ublock0.sqlite
```

## Build Instructions (for Developers)

1. Clone the [uBlock repository](https://github.com/gorhill/uBlock):
   ```bash
   git clone https://github.com/gorhill/uBlock.git
   ```
2. Set the path to uBlock:
   ```bash
   cd uBlock
   ```
3. The official version of uBO is in the `master` branch:
   ```bash
   git checkout master
   ```
4. Build the plugin:
   - Chromium: 
     ```bash
     make chromium
     ```
   - Firefox:
     ```bash
     make firefox
     ```
   - NPM package:
     ```bash
     make npm
     ```
5. Load the result of the build into your browser:
   - **Chromium:**
     - Navigate to `chrome://extensions/`
     - Check _"Developer mode"_
     - Click _"Load unpacked"_
     - Select `/uBlock/dist/build/uBlock0.chromium/`
   - **Firefox:**
     - Navigate to `about:debugging#/runtime/this-firefox`
     - Click _"Load Temporary Add-on..."_ 
     - Select `/uBlock/dist/build/uBlock0.firefox/`
