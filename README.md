[![Commit rate](https://img.shields.io/github/commit-activity/m/gorhill/ublock?label=Commits)](https://github.com/gorhill/uBlock/commits/master)
[![Issues](https://img.shields.io/github/issues/uBlockOrigin/uBlock-issues)](https://github.com/uBlockOrigin/uBlock-issues/issues)
[![Crowdin](https://d322cqt584bo4o.cloudfront.net/ublock/localized.svg)](https://crowdin.com/project/ublock)
[![License](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://github.com/gorhill/uBlock/blob/master/LICENSE.txt)
[![NPM](https://img.shields.io/npm/v/@gorhill/ubo-core)](https://www.npmjs.com/package/@gorhill/ubo-core)
[![Mozilla Add-ons](https://img.shields.io/amo/rating/ublock-origin?label=Firefox)](https://addons.mozilla.org/firefox/addon/ublock-origin/)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/rating/cjpalhdlnbpafiamejdnhcphjbkeiagm?label=Chrome)](https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm)

*** 

<h1 align="center">
<sub>
<img  src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/icon38@2x.png" height="38" width="38">
</sub>
uBlock Origin
</h1>
<p align="center">
<sup> <!-- Pronounciation -->
      pronounced <i>you-block origin</i> (<code>/ˈjuːˌblɒk/</code>) — <i>you</i> decide what enters your browser.
</sup>
<br>
<sub><a href="https://github.com/gorhill/uBlock/wiki/uBlock-Origin-is-completely-unrelated-to-the-web-site-ublock.org"><b>BEWARE!</b> uBlock Origin is (and has always been) COMPLETELY UNRELATED to the web site <code>ublock.org</code></a>.</sub>
</p>

***

<p align="center">
<a href="https://addons.mozilla.org/addon/ublock-origin/"><img src="https://user-images.githubusercontent.com/585534/107280546-7b9b2a00-6a26-11eb-8f9f-f95932f4bfec.png" alt="Get uBlock Origin for Firefox"></a> 
<a href="https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm"><img src="https://user-images.githubusercontent.com/585534/107280622-91a8ea80-6a26-11eb-8d07-77c548b28665.png" alt="Get uBlock Origin for Chromium"></a>
<a href="https://microsoftedge.microsoft.com/addons/detail/odfafepnkmbhccpbejgmiehpchacaeak"><img src="https://user-images.githubusercontent.com/585534/107280673-a5ece780-6a26-11eb-9cc7-9fa9f9f81180.png" alt="Get uBlock Origin for Microsoft Edge"></a>
<a href="https://addons.opera.com/extensions/details/ublock/"><img src="https://user-images.githubusercontent.com/585534/107280692-ac7b5f00-6a26-11eb-85c7-088926504452.png" alt="Get uBlock Origin for Opera"></a>
      <br><sub><a href="https://twitter.com/gorhill/status/1033706103782170625">Do <b>not</b> use uBlock Origin along with other similarly-purposed blockers</a>.</sub>
      <br><sub>See below for <a href="#installation">more installation options.</a></sub>
</p>

***

**An efficient blocker add-on for various browsers. Fast, potent, and lean.**

uBlock Origin is **NOT** an "ad blocker": [it is a wide-spectrum blocker](https://github.com/gorhill/uBlock/wiki/Blocking-mode) -- which happens to be able to function as a mere "ad blocker". The default behavior of uBlock Origin when newly installed is to block ads, trackers and malware sites -- through [_EasyList_](https://easylist.github.io/#easylist), [_EasyPrivacy_](https://easylist.github.io/#easyprivacy), [_Peter Lowe’s ad/tracking/malware servers_](https://pgl.yoyo.org/adservers/policy.php), [_Online Malicious URL Blocklist_](https://gitlab.com/curben/urlhaus-filter#urlhaus-malicious-url-blocklist), and uBlock Origin's [own filter lists](https://github.com/uBlockOrigin/uAssets/tree/master/filters).

***

* [Documentation](#documentation)
* [Purpose & General Info](#philosophy)
* [Installation](#installation)
  * [Chromium](#chromium)
  * [Firefox](#firefox--firefox-for-android)
  * [Microsoft Edge](#microsoft-edge)
  - [Safari (macOS)](#safari-macos)
* [Release History](#release-history)
* [Privacy policy](https://github.com/gorhill/uBlock/wiki/Privacy-policy)
* [Wiki](https://github.com/gorhill/uBlock/wiki)

## Documentation

 Basic mode | Advanced-user mode
:----------:|:------------------:
[Popup user interface](https://github.com/gorhill/uBlock/wiki/Quick-guide:-popup-user-interface) | [A point-and-click firewall which can be configured on a per-site basis](https://github.com/gorhill/uBlock/wiki/Dynamic-filtering:-quick-guide) 
<a href="https://github.com/gorhill/uBlock/wiki/Quick-guide:-popup-user-interface"><img src="https://user-images.githubusercontent.com/585534/84045360-b10ee580-a976-11ea-9e91-29c2107b47c2.png" /></a><br><sup>.<br>.</sup> | <a href="https://github.com/gorhill/uBlock/wiki/Dynamic-filtering:-quick-guide"><img src="https://user-images.githubusercontent.com/585534/84045366-b1a77c00-a976-11ea-9121-e8c8f35c66c8.png" /></a><br><sup>Configure as you wish:<br>picture shows 3rd-party scripts and frames blocked by default everywhere</sup>

Visit the [uBlock Origin's wiki](https://github.com/gorhill/uBlock/wiki) for documentation.

For support/questions/help, there is [/r/uBlockOrigin](https://www.reddit.com/r/uBlockOrigin/) on Reddit.

## Philosophy

uBlock Origin (or uBlock₀) is not an *ad blocker*; it's a general-purpose blocker. uBlock Origin blocks ads through its support of the [Adblock Plus filter syntax](https://adblockplus.org/en/filters). uBlock Origin [extends](https://github.com/gorhill/uBlock/wiki/Filter-syntax-extensions) the syntax and is designed to work with custom rules and filters. Furthermore, advanced mode allows uBlock Origin to work in [default-deny mode](https://github.com/gorhill/uBlock/wiki/Dynamic-filtering:-default-deny), which mode will cause [all 3rd-party network requests](https://requestpolicycontinued.github.io/#what-are-cross-site-requests) to be blocked by default, unless allowed by the user.

That said, it's important to note that using a blocker is **NOT** [theft](https://twitter.com/LeaVerou/status/518154828166725632). Don't fall for this creepy idea. The _ultimate_ logical consequence of `blocking = theft` is the criminalisation of the inalienable right to privacy.

Ads, "unintrusive" or not, are just the visible portions of privacy-invading apparatus entering your browser when you visit most sites nowadays. **uBlock Origin's main goal is to help users neutralize such privacy-invading apparatus** — in a way that welcomes those users who don't wish to use more technical, involved means (such as [uMatrix](https://github.com/gorhill/uMatrix)).

_EasyList_, _EasyPrivacy_, _Peter Lowe's_, _Online Malicious URL Blocklist_ and uBO's own lists are enabled by default when you install uBlock Origin. Many more lists are readily available to block trackers, analytics, and more. Hosts files are also supported.

Once you install uBlock Origin, you may easily un-select any of the pre-selected filter lists if you think uBlock Origin blocks too much. For reference, Adblock Plus installs with only _EasyList_, _ABP filters_ and _Acceptable Ads_ enabled by default.

## Installation

Feel free to read [about the extension's required permissions](https://github.com/gorhill/uBlock/wiki/Permissions).

#### Chromium

You can install the latest version [manually](https://github.com/gorhill/uBlock/tree/master/dist#install), from the [Chrome Web Store](https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm), or from the [Opera add-ons](https://addons.opera.com/extensions/details/ublock/).

There is also a development version in the Chrome Web Store if you want to test uBlock Origin with the latest changes: see [_uBlock Origin dev build_](https://chrome.google.com/webstore/detail/ublock-origin-dev-build/cgbcahbpdhpcegmbfconppldiemgcoii).

It is expected that uBlock Origin is compatible with any Chromium-based browsers.

#### Firefox / Firefox for Android

[Firefox Add-ons web site](https://addons.mozilla.org/addon/ublock-origin/).

There is also a development version if you want to test uBlock Origin with the latest changes: for installation, see [Install / Firefox webext / For beta version](https://github.com/gorhill/uBlock/blob/master/dist/README.md#for-beta-version)

uBlock Origin is compatible with [SeaMonkey](http://www.seamonkey-project.org/), [Pale Moon](https://www.palemoon.org/), and possibly other browsers based on Firefox: for installation, see [Install / Firefox legacy](https://github.com/gorhill/uBlock/blob/master/dist/README.md#firefox-legacy).

uBO may also be installed as a [Debian package](https://packages.debian.org/stable/source/ublock-origin):

- Firefox 56-: `apt-get install xul-ext-ublock-origin`
- Firefox 55+: `apt-get install webext-ublock-origin`

There is no guarantee the package will be available on your specific platform -- in which case, you will have to install from [Firefox Add-ons web site](https://addons.mozilla.org/addon/ublock-origin/).

#### Microsoft Edge

Publisher: [Nik Rolls](https://github.com/nikrolls/uBlock-Edge).

Chromium-based Edge: Stable version available in [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/odfafepnkmbhccpbejgmiehpchacaeak).

#### Safari (macOS)

Developer: [@el1t](https://github.com/el1t).

Development version available at <https://github.com/el1t/uBlock-Safari#ublock-originfor-safari>.

Warning: It is not possible for extensions like uBlock Origin to work with Safari 13+. See <https://github.com/el1t/uBlock-Safari/issues/158>.

Note that issues specific to the Safari fork are the responsibility of the current maintainer, I have no control over the code base of the fork.

#### Note for all browsers

To benefit from uBlock Origin's higher efficiency, it's advised that you don't use other content blockers at the same time (such as Adblock Plus, AdBlock). uBlock Origin will do [as well or better](https://www.debugbear.com/blog/chrome-extension-performance-2021#how-do-ad-blockers-and-privacy-tools-affect-browser-performance) than most popular ad blockers. Other blockers can also prevent uBlock Origin's privacy or anti-blocker-defusing features from working properly.

#### Deploying

Below is documentation to assist administrators in deploying uBlock Origin:

- [Deploying uBlock Origin](https://github.com/gorhill/uBlock/wiki/Deploying-uBlock-Origin)
    - Firefox: [Deploying uBlock Origin for Firefox with CCK2 and Group Policy](http://decentsecurity.com/ublock-for-firefox-deployment/) (external)
    - Google Chrome: [Managing Google Chrome with adblocking and security](https://decentsecurity.com/ublock-for-google-chrome-deployment/) (external)

## Release History

See the [releases pages](https://github.com/gorhill/uBlock/releases) for a history of releases and highlights for each release.

## About

[uBlock Origin's manifesto](MANIFESTO.md).

Free. Open source. For users by users. No donations sought.

Without the preset lists of filters, this extension is nothing. So if ever you
really do want to contribute something, think about the people working hard
to maintain the filter lists you are using, which were made available to use by
all for free.

You can contribute by helping translate uBlock Origin [on Crowdin](https://crowdin.net/project/ublock).

## License

[GPLv3](https://github.com/gorhill/uBlock/blob/master/LICENSE.txt).
