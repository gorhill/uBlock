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
<img src="https://github.com/gorhill/uBlock/blob/master/src/img/ublock.svg" height="38" width="38">
</sub>
uBlock Origin (uBO)
</h1>
<p align="center">
<sub><a href="https://github.com/gorhill/uBlock/wiki/uBlock-Origin-is-completely-unrelated-to-the-web-site-ublock.org"><b>BEWARE!</b> uBO is (and has always been) COMPLETELY UNRELATED to the website <code>ublock.org</code></a>.</sub>
</p>

***

<p align="center">
<a href="https://addons.mozilla.org/addon/ublock-origin/"><img src="https://user-images.githubusercontent.com/585534/107280546-7b9b2a00-6a26-11eb-8f9f-f95932f4bfec.png" alt="Get uBlock Origin for Firefox"></a>
<a href="https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm"><img src="https://user-images.githubusercontent.com/585534/107280622-91a8ea80-6a26-11eb-8d07-77c548b28665.png" alt="Get uBlock Origin for Chromium"></a>
<a href="https://microsoftedge.microsoft.com/addons/detail/ublock-origin/odfafepnkmbhccpbejgmiehpchacaeak"><img src="https://user-images.githubusercontent.com/585534/107280673-a5ece780-6a26-11eb-9cc7-9fa9f9f81180.png" alt="Get uBlock Origin for Microsoft Edge"></a>
<a href="https://addons.opera.com/extensions/details/ublock/"><img src="https://user-images.githubusercontent.com/585534/107280692-ac7b5f00-6a26-11eb-85c7-088926504452.png" alt="Get uBlock Origin for Opera"></a>
</p>

***

uBlock Origin (uBO) is a CPU and memory-efficient [wide-spectrum content blocker][Blocking] for Chromium and Firefox. It blocks ads, trackers, coin miners, popups, annoying anti-blockers, malware sites, etc., by default using [EasyList][EasyList], [EasyPrivacy][EasyPrivacy], [Peter Lowe's Blocklist][Peter Lowe's Blocklist], [Online Malicious URL Blocklist][Malicious Blocklist], and uBO [filter lists][uBO Filters]. There are many other lists available to block even more. Hosts files are also supported. uBO uses the EasyList filter syntax and [extends][Extended Syntax] the syntax to work with custom rules and filters.

You may easily unselect any preselected filter lists if you think uBO blocks too much. For reference, Adblock Plus installs with only EasyList, ABP filters, and Acceptable Ads enabled by default.

It is important to note that using a blocker is **NOT** [theft]. Do not fall for this creepy idea. The _ultimate_ logical consequence of `blocking = theft` is the criminalization of the inalienable right to privacy.

Ads, "unintrusive" or not, are just the visible portion of the privacy-invading means entering your browser when you visit most sites. **uBO's primary goal is to help users neutralize these privacy-invading methods** in a way that welcomes those users who do not wish to use more technical means.

***

* [Documentation](#documentation)
* [Installation](#installation)
  * [Chromium](#chromium)
  * [Firefox](#firefox)
* [Release History](#release-history)
* [Translations](#translations)
* [About](#about)
* [License](#license)
* [Privacy Policy]
* [Wiki]

## Documentation

<table>
    <thead>
        <tr>
            <th>Basic Mode</th>
            <th>Advanced Mode</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td align="center">The <a href="https://github.com/gorhill/uBlock/wiki/Quick-guide:-popup-user-interface">simple popup user interface</a> for an install-it-and-forget-it type of installation that is configured optimally by default.</td>
            <td align="center">The <a href="https://github.com/gorhill/uBlock/wiki/Dynamic-filtering:-quick-guide">advanced popup user interface</a> includes a point-and-click firewall that is configurable on a per-site basis.</td>
        </tr>
        <tr>
            <td valign="top"><a href="https://github.com/gorhill/uBlock/wiki/Quick-guide:-popup-user-interface"><img src="https://user-images.githubusercontent.com/585534/232531044-c4ac4dd5-0b60-4c1e-aabb-914be04b846c.png"/></a></td>
            <td valign="top"><a href="https://github.com/gorhill/uBlock/wiki/Dynamic-filtering:-quick-guide"><img src="https://user-images.githubusercontent.com/585534/232531439-a8f81cc3-6622-45c4-8b32-7348cecf6e98.png"/></a></td>
        </tr>
    </tbody>
</table>

Visit the [Wiki][Wiki] for documentation.

For support, questions, or help, visit [/r/uBlockOrigin][Reddit].

## Installation

[Required Permissions][Permissions]

#### Chromium

[Chrome Web Store][Chrome]

[Microsoft Edge Add-ons][Edge] (Published by: [Nicole Rolls][Nicole Rolls])

[Opera Add-ons][Opera]

[Development Builds][Chrome Dev]

uBO should be compatible with any Chromium-based browser.

#### Firefox

[Firefox Add-ons][Mozilla]

[Development Builds][Beta]

uBO [works best][Works Best] on Firefox and is available for desktop and Android versions.

#### All Browsers

Do **NOT** use any other [similarly-purposed blockers][Similarly-Purposed] concurrently with uBO to benefit from its higher efficiency. uBO will [perform][Performance] as well as or better than most other popular ad blockers. These other blockers can prevent uBO's privacy or anti-blocker-defusing features from working correctly.

[Manual Installation][Manual Installation]

#### Enterprise Deployment

[Deploying uBO][Deployment]

## Release History

[Releases Page][Releases]

## Translations

Help translate uBO via [Crowdin][Crowdin].

## About

[Manifesto][Manifesto]

Free. Open-source. For users by users. No donations sought.

If you ever want to contribute something, think about the people working hard to maintain the filter lists you are using, which are available to use by all for free.

## License

[GPLv3][License]


<!----------------------------------------------------------------------------->

[Peter Lowe's Blocklist]: https://pgl.yoyo.org/adservers/
[Malicious Blocklist]: https://gitlab.com/malware-filter/urlhaus-filter#malicious-url-blocklist
[Similarly-Purposed]: https://twitter.com/gorhill/status/1033706103782170625
[Performance]: https://www.debugbear.com/blog/chrome-extension-performance-2021#how-do-ad-blockers-and-privacy-tools-affect-browser-performance
[EasyPrivacy]: https://easylist.to/#easyprivacy
[Chrome Dev]: https://chrome.google.com/webstore/detail/ublock-origin-development/cgbcahbpdhpcegmbfconppldiemgcoii
[EasyList]: https://easylist.to/#easylist
[Mozilla]: https://addons.mozilla.org/addon/ublock-origin/
[Crowdin]: https://crowdin.com/project/ublock
[Chrome]: https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm
[Reddit]: https://www.reddit.com/r/uBlockOrigin/
[Theft]: https://twitter.com/LeaVerou/status/518154828166725632
[Opera]: https://addons.opera.com/extensions/details/ublock/
[Edge]: https://microsoftedge.microsoft.com/addons/detail/ublock-origin/odfafepnkmbhccpbejgmiehpchacaeak
[NPM]: https://www.npmjs.com/package/@gorhill/ubo-core

[Manifesto]: MANIFESTO.md
[License]: LICENSE.txt

[Nicole Rolls]: https://github.com/nicole-ashley


<!---------------------------------[ Internal ]-------------------------------->

[Manual Installation]: https://github.com/gorhill/uBlock/tree/master/dist#install
[Extended Syntax]: https://github.com/gorhill/uBlock/wiki/Static-filter-syntax#extended-syntax
[Privacy Policy]: https://github.com/gorhill/uBlock/wiki/Privacy-policy
[uBO Filters]: https://github.com/uBlockOrigin/uAssets/tree/master/filters
[Permissions]: https://github.com/gorhill/uBlock/wiki/Permissions
[Commit Rate]: https://github.com/gorhill/uBlock/commits/master
[Works Best]: https://github.com/gorhill/uBlock/wiki/uBlock-Origin-works-best-on-Firefox
[Deployment]: https://github.com/gorhill/uBlock/wiki/Deploying-uBlock-Origin
[Blocking]: https://github.com/gorhill/uBlock/wiki/Blocking-mode
[Releases]: https://github.com/gorhill/uBlock/releases
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

