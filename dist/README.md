## INSTALL

#### Chromium

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

#### Firefox

Although uBlock Origin is a restartless addon, I found that **installing** a newer version over an older one often will glitch the installation. These steps always worked fine:

- Download `ublock0.firefox.xpi` ([latest release desirable](https://github.com/gorhill/uBlock/releases)). 
- Uninstall current uBlock Origin if already installed
- Quit Firefox completely
- Launch Firefox
- Drag and drop the previously downloaded `ublock0.firefox.xpi` into Firefox

uBlock<sub>0</sub> settings are kept intact even after you uninstall the addon.

On Linux, the settings are saved in a SQlite file located at `~/.mozilla/firefox/[profile name]/extension-data/ublock0.sqlite`.

On Windows, I don't know where that SQlite file is located. Feel free to submit a pull request if you do know.
