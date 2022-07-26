
[![Badge Commits]][Commit Rate]
[![Badge Issues]][Issues]
[![Badge Localization]][Crowdin]
[![Badge License]][License]
[![Badge NPM]][NPM]
[![Badge Mozilla]][Mozilla]
[![Badge Chrome]][Chrome]

***

<h1 align="center">
<sub>
<img  src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/icon38@2x.png" height="38" width="38">
</sub>
uBlock Origin
</h1>
<p align="center">
<sup> <!-- Pronunciation -->
      pronounced <i>you-block origin</i> (<code>/ˈjuːˌblɒk/</code>) — <i>you</i> decide what enters your browser.
</sup>
<br>
<sub><a href="https://github.com/gorhill/uBlock/wiki/uBlock-Origin-is-completely-unrelated-to-the-web-site-ublock.org"><b>BEWARE!</b> uBlock Origin is (and has always been) COMPLETELY UNRELATED to the web site <code>ublock.org</code></a>.</sub>
</p>

***

<p align="center">
<a href="https://addons.mozilla.org/addon/ublock-origin/"><img src="https://user-images.githubusercontent.com/585534/107280546-7b9b2a00-6a26-11eb-8f9f-f95932f4bfec.png" alt="Get uBlock Origin for Firefox"></a>
<a href="https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm"><img src="https://user-images.githubusercontent.com/585534/107280622-91a8ea80-6a26-11eb-8d07-77c548b28665.png" alt="Get uBlock Origin for Chromium"></a>
<a href="https://microsoftedge.microsoft.com/addons/detail/ublock-origin/odfafepnkmbhccpbejgmiehpchacaeak"><img src="https://user-images.githubusercontent.com/585534/107280673-a5ece780-6a26-11eb-9cc7-9fa9f9f81180.png" alt="Get uBlock Origin for Microsoft Edge"></a>
<a href="https://addons.opera.com/extensions/details/ublock/"><img src="https://user-images.githubusercontent.com/585534/107280692-ac7b5f00-6a26-11eb-85c7-088926504452.png" alt="Get uBlock Origin for Opera"></a>
      <br><sub><a href="https://twitter.com/gorhill/status/1033706103782170625">Do <b>not</b> use uBlock Origin along with other similarly-purposed blockers</a>.</sub>
      <br><sub>See below for <a href="#installation">more installation options.</a></sub>
</p>

***

**An efficient blocker add-on for various browsers. Fast, potent, and lean.**

uBlock Origin is **NOT** an "ad blocker": [it is a wide-spectrum blocker][Blocking] -- which happens to be able to function as a mere "ad blocker". The default behavior of uBlock Origin when newly installed is to block ads, trackers and malware sites -- through [_EasyList_][EasyList], [_EasyPrivacy_][EasyPrivacy], [_Peter Lowe’s ad/tracking/malware servers_][Peters List], [_Online Malicious URL Blocklist_][Malicious Blocklist], and uBlock Origin's [own filter lists][UBlock Filters].

***

* [Documentation](#documentation)
* [Purpose & General Info](#philosophy)
* [Installation](#installation)
  * [Chromium](#chromium)
  * [Firefox](#firefox--firefox-for-android)
  * [Microsoft Edge](#microsoft-edge)
  - [Safari (macOS)](#safari-macos)
* [Release History](#release-history)
* [Privacy policy]
* [Wiki](https://github.com/gorhill/uBlock/wiki)

## Documentation

 Basic mode | Advanced-user mode
:----------:|:------------------:
[Popup user interface] | [A point-and-click firewall which can be configured on a per-site basis][Dynamic Filters] 
<a href="https://github.com/gorhill/uBlock/wiki/Quick-guide:-popup-user-interface"><img src="https://user-images.githubusercontent.com/585534/84045360-b10ee580-a976-11ea-9e91-29c2107b47c2.png" /></a><br><sup>.<br>.</sup> | <a href="https://github.com/gorhill/uBlock/wiki/Dynamic-filtering:-quick-guide"><img src="https://user-images.githubusercontent.com/585534/84045366-b1a77c00-a976-11ea-9121-e8c8f35c66c8.png" /></a><br><sup>Configure as you wish:<br>picture shows 3rd-party scripts and frames blocked by default everywhere</sup>

Visit the [uBlock Origin's wiki][Wiki] for documentation.

For support/questions/help, there is [/r/uBlockOrigin][Reddit] on Reddit.

## Philosophy

uBlock Origin (or uBlock₀) is not an *ad blocker*; it's a general-purpose blocker. uBlock Origin blocks ads through its support of the [Adblock Plus filter syntax][How To Filters]. uBlock Origin [extends][Extended Syntax] the syntax and is designed to work with custom rules and filters. Furthermore, advanced mode allows uBlock Origin to work in [default-deny mode][Default Deny], which mode will cause [all 3rd-party network requests][3rd Party Requests] to be blocked by default, unless allowed by the user.

That said, it's important to note that using a blocker is **NOT** [theft]. Don't fall for this creepy idea. The _ultimate_ logical consequence of `blocking = theft` is the criminalisation of the inalienable right to privacy.

Ads, "unintrusive" or not, are just the visible portions of privacy-invading apparatus entering your browser when you visit most sites nowadays. **uBlock Origin's main goal is to help users neutralize such privacy-invading apparatus** — in a way that welcomes those users who don't wish to use more technical, involved means (such as [uMatrix]).

_EasyList_, _EasyPrivacy_, _Peter Lowe's_, _Online Malicious URL Blocklist_ and uBO's own lists are enabled by default when you install uBlock Origin. Many more lists are readily available to block trackers, analytics, and more. Hosts files are also supported.

Once you install uBlock Origin, you may easily un-select any of the pre-selected filter lists if you think uBlock Origin blocks too much. For reference, Adblock Plus installs with only _EasyList_, _ABP filters_ and _Acceptable Ads_ enabled by default.

## Installation

Feel free to read [about the extension's required permissions][Permissions].

#### Chromium

You can install the latest version [manually][Manual Installation], from the [Chrome Web Store][Chrome], or from the [Opera add-ons][Opera].

There is also a development version in the Chrome Web Store if you want to test uBlock Origin with the latest changes: see [_uBlock Origin dev build_][Chrome Dev].

It is expected that uBlock Origin is compatible with any Chromium-based browsers.

#### Firefox / Firefox for Android

[Firefox Add-ons web site][Mozilla].

There is also a development version if you want to test uBlock Origin with the latest changes: for installation, see [Install / Firefox webext / For beta version][Beta]

uBlock Origin is compatible with [SeaMonkey], [Pale Moon], and possibly other browsers based on Firefox: for installation, see [Install / Firefox legacy][Firefox Legacy].

uBO may also be installed as a [Debian package][Debian Package]:

- Firefox 56-: `apt-get install xul-ext-ublock-origin`
- Firefox 55+: `apt-get install webext-ublock-origin`

There is no guarantee the package will be available on your specific platform -- in which case, you will have to install from [Firefox Add-ons web site][Mozilla].

#### Microsoft Edge

Publisher: [Nicole Rolls].

Chromium-based Edge: Stable version available in [Microsoft Edge Add-ons][Edge].

#### Safari (macOS)

Developer: [@el1t].

Development version available at <https://github.com/el1t/uBlock-Safari#ublock-originfor-safari>.

Warning: It is not possible for extensions like uBlock Origin to work with Safari 13+. See <https://github.com/el1t/uBlock-Safari/issues/158>.

Note that issues specific to the Safari fork are the responsibility of the current maintainer, I have no control over the code base of the fork.

#### Note for all browsers

To benefit from uBlock Origin's higher efficiency, it's advised that you don't use other content blockers at the same time (such as Adblock Plus, AdBlock). uBlock Origin will do [as well or better][Performance] than most popular ad blockers. Other blockers can also prevent uBlock Origin's privacy or anti-blocker-defusing features from working properly.

#### Deploying

Below is documentation to assist administrators in deploying uBlock Origin:

- [Deploying uBlock Origin][Deploying]
    - Firefox: [Deploying uBlock Origin for Firefox with CCK2 and Group Policy][Deploy Firefox] (external)
    - Google Chrome: [Managing Google Chrome with adblocking and security][Deploy Chrome] (external)

## Release History

See the [releases pages][Releases] for a history of releases and highlights for each release.

## About

[uBlock Origin's manifesto][Manifesto].

Free. Open source. For users by users. No donations sought.

Without the preset lists of filters, this extension is nothing. So if ever you
really do want to contribute something, think about the people working hard
to maintain the filter lists you are using, which were made available to use by
all for free.

You can contribute by helping translate uBlock Origin on [Crowdin].

## License

[GPLv3][License].


<!----------------------------------------------------------------------------->

[Malicious Blocklist]: https://gitlab.com/curben/urlhaus-filter#urlhaus-malicious-url-blocklist
[3rd Party Requests]: https://requestpolicycontinued.github.io/#what-are-cross-site-requests
[How To Filters]: https://help.eyeo.com/en/adblockplus/how-to-write-filters
[Deploy Firefox]: https://decentsecurity.com/ublock-for-firefox-deployment/
[Debian Package]: https://packages.debian.org/stable/source/ublock-origin
[Deploy Chrome]: https://decentsecurity.com/ublock-for-google-chrome-deployment/
[Performance]: https://www.debugbear.com/blog/chrome-extension-performance-2021#how-do-ad-blockers-and-privacy-tools-affect-browser-performance
[Peters List]: https://pgl.yoyo.org/adservers/policy.php
[EasyPrivacy]: https://easylist.github.io/#easyprivacy
[Chrome Dev]: https://chrome.google.com/webstore/detail/ublock-origin-dev-build/cgbcahbpdhpcegmbfconppldiemgcoii
[SeaMonkey]: https://www.seamonkey-project.org/
[Pale Moon]: https://www.palemoon.org/
[EasyList]: https://easylist.github.io/#easylist
[Mozilla]: https://addons.mozilla.org/firefox/addon/ublock-origin/
[Crowdin]: https://crowdin.com/project/ublock
[Chrome]: https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm
[Reddit]: https://www.reddit.com/r/uBlockOrigin/
[Theft]: https://twitter.com/LeaVerou/status/518154828166725632
[Opera]: https://addons.opera.com/extensions/details/ublock/
[Edge]: https://microsoftedge.microsoft.com/addons/detail/ublock-origin/odfafepnkmbhccpbejgmiehpchacaeak
[NPM]: https://www.npmjs.com/package/@gorhill/ubo-core

[Manifesto]: MANIFESTO.md
[License]: LICENSE.txt

[Nicole Rolls]: https://github.com/nicole-ashley/uBlock-Edge
[@el1t]: https://github.com/el1t


<!---------------------------------[ Internal ]-------------------------------->

[Popup User Interface]: https://github.com/gorhill/uBlock/wiki/Quick-guide:-popup-user-interface
[Manual Installation]: https://github.com/gorhill/uBlock/tree/master/dist#install
[Extended Syntax]: https://github.com/gorhill/uBlock/wiki/Static-filter-syntax#extended-syntax
[Dynamic Filters]: https://github.com/gorhill/uBlock/wiki/Dynamic-filtering:-quick-guide
[Firefox Legacy]: https://github.com/gorhill/uBlock/blob/master/dist/README.md#firefox-legacy
[Privacy Policy]: https://github.com/gorhill/uBlock/wiki/Privacy-policy
[UBlock Filters]: https://github.com/uBlockOrigin/uAssets/tree/master/filters
[Default Deny]: https://github.com/gorhill/uBlock/wiki/Dynamic-filtering:-default-deny
[Permissions]: https://github.com/gorhill/uBlock/wiki/Permissions
[Commit Rate]: https://github.com/gorhill/uBlock/commits/master
[Deploying]: https://github.com/gorhill/uBlock/wiki/Deploying-uBlock-Origin
[Blocking]: https://github.com/gorhill/uBlock/wiki/Blocking-mode
[Releases]: https://github.com/gorhill/uBlock/releases
[UMatrix]: https://github.com/gorhill/uMatrix
[Issues]: https://github.com/uBlockOrigin/uBlock-issues/issues
[Beta]: https://github.com/gorhill/uBlock/blob/master/dist/README.md#for-beta-version
[Wiki]: https://github.com/gorhill/uBlock/wiki


<!----------------------------------[ Badges ]--------------------------------->

[Badge Localization]: https://d322cqt584bo4o.cloudfront.net/ublock/localized.svg
[Badge Commits]: https://img.shields.io/github/commit-activity/m/gorhill/ublock?label=Commits
[Badge Mozilla]: https://img.shields.io/amo/rating/ublock-origin?label=Firefox
[Badge License]: https://img.shields.io/badge/License-GPLv3-blue.svg
[Badge Chrome]: https://img.shields.io/chrome-web-store/rating/cjpalhdlnbpafiamejdnhcphjbkeiagm?label=Chrome
[Badge Issues]: https://img.shields.io/github/issues/uBlockOrigin/uBlock-issues
[Badge NPM]: https://img.shields.io/npm/v/@gorhill/ubo-core

