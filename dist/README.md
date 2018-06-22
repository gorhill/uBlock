## INSTALL

### Chromium

- Download and unzip `ublock0.chromium.zip` ([latest release desirable](https://github.com/gorhill/uBlock/releases)).
- Rename the unzipped directory to `ublock`
    - When you later update manually, replace the **content** of the `ublock` folder with the **content** of the latest zipped version.
    - This will ensure that all the extension settings will be preserved
    - As long as the extension loads **from same folder path from which it was originally installed**, all your settings will be preserved.
- Go to chromium/chrome *Extensions*.
- Click to check *Developer mode*.
- Click *Load unpacked extension...*.
- In the file selector dialog:
    - Select the directory `ublock` which was created above.
    - Click *Open*.

The extension will now be available in your chromium/chromium-based browser.

Remember that you have to update manually also. For some users, updating manually is actually an advantage because:
- You can update when **you** want
- If ever a new version sucks, you can easily just re-install the previous one

### Firefox

Compatible with Firefox 52 and beyond. 

#### For stable release version

This works only if you set `xpinstall.signatures.required` to `false` in `about:config`.<sup>[see "Add-on signing in Firefox"](https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox)</sup>

- Download `ublock0.firefox.xpi` ([latest release desirable](https://github.com/gorhill/uBlock/releases)).
    - Right-click and choose _"Save As..."_.
- Drag and drop the previously downloaded `ublock0.firefox.xpi` into Firefox

#### For beta version

- Click on `ublock0.firefox.signed.xpi` ([latest release desirable](https://github.com/gorhill/uBlock/releases)).

#### Location of uBO settings

On Linux, the settings are saved in a JSON file located at `~/.mozilla/firefox/[profile name]/browser-extension-data/uBlock0@raymondhill.net/storage.js`.

When you uninstall the extension, Firefox deletes that file, so all your settings are lost when you uninstall.

### Firefox legacy

Compatible with Firefox 24 to Firefox 56.

- Download `ublock0.firefox-legacy.xpi` ([latest release desirable](https://github.com/gorhill/uBlock/releases)).
    - Right-click and select "Save Link As..."
- Drag and drop the previously downloaded `ublock0.firefox-legacy.xpi` into Firefox

With Firefox 43 and beyond, you may need to toggle the setting `xpinstall.signatures.required` to `false` in `about:config`.<sup>[see "Add-on signing in Firefox"](https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox)</sup>

Your uBlock Origin settings are kept intact even after you uninstall the addon.

On Linux, the settings are saved in a SQlite file located at `~/.mozilla/firefox/[profile name]/extension-data/ublock0.sqlite`.

On Windows, the settings are saved in a SQlite file located at `%APPDATA%\Mozilla\Firefox\Profiles\[profile name]\extension-data\ublock0.sqlite`.

### Build instructions (for developers)

- Clone [uBlock](https://github.com/gorhill/uBlock) and [uAssets](https://github.com/uBlockOrigin/uAssets) repositories in the same parent directory
    - `git clone https://github.com/gorhill/uBlock.git`
    - `git clone https://github.com/uBlockOrigin/uAssets.git`
- Set path to uBlock: `cd uBlock`
- The official version of uBO is in the `master` branch
    - `git checkout master`
- Build the plugin:
    - Chromium: `./tools/make-chromium.sh`
    - Firefox webext: `./tools/make-firefox.sh all`
    - Firefox legacy:
        - `git checkout firefox-legacy`
        - `./tools/make-firefox-legacy.sh all`
- Load the result of the build into your browser:
    - Chromium: load the unpacked extension folder `/uBlock/dist/build/uBlock0.chromium/` in Chromium to use the extension.
    - Firefox: drag-and-drop `/uBlock/dist/build/uBlock0.firefox.xpi` or `/uBlock/dist/build/uBlock0.firefox-legacy.xpi` into Firefox.
   
