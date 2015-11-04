[<img src="https://travis-ci.org/gorhill/uBlock.svg?branch=master" height="18">](https://travis-ci.org/gorhill/uBlock)
[![Crowdin](https://d322cqt584bo4o.cloudfront.net/ublock/localized.png)](https://crowdin.com/project/ublock)

***

**BEWARE! uBlock Origin is COMPLETELY UNRELATED to the web site ublock.org**

The donations sought by the [individual](https://github.com/chrisaljoudi/) behind `ublock.org` are _not_ benefiting any of those who contributed most to create uBlock Origin ([developers](https://github.com/gorhill/uBlock/graphs/contributors), [translators](https://crowdin.com/project/ublock), and all those who put efforts in opening detailed issues). For the differences in features between uBlock Origin and uBlock, you are more likely than anywhere else to find an unbiased explanation in this [Wikipedia article](http://en.wikipedia.org/wiki/UBlock).

***

uBlock Origin is **NOT** an "ad blocker": [it is a wide-spectrum blocker](https://github.com/gorhill/uBlock/wiki/Blocking-mode) -- which happens to be able to function as a mere "ad blocker". The default behavior of uBlock Origin when newly installed is to block ads, trackers and malware sites -- through [_EasyList_](https://easylist.adblockplus.org/en/policy#easylist), [_EasyPrivacy_](https://easylist.adblockplus.org/en/policy#easyprivacy), [_Peter Lowe’s ad/tracking/malware servers_](http://pgl.yoyo.org/adservers/policy.php), various lists of [malware](http://www.malwaredomainlist.com/) [sites](http://www.malwaredomains.com/), and uBlock Origin's [own filter lists](https://github.com/gorhill/uBlock/tree/master/assets/ublock).

*** 

<h1 align="center">
<sub>
<img  src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/icon38@2x.png"
      height="38"
      width="38">
</sub>
uBlock Origin
</h1>
<p align="center">
<sup> <!-- Pronounciation -->
      pronounced <i>you-block origin</i> (<code>/ˈjuːˌblɒk/</code>) — <i>you</i> decide what enters your browser.
</sup>
<br>
<sup> <!-- Languages -->
      <img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/languageicon-36.png" width="18" height="18">
      <sup>
            English,
            <a href="https://github.com/fang5566/uBlock/blob/master/README.md#ublock-origin">Chinese (中文)</a>,
            <a href="https://github.com/delightbot/uBlock/blob/master/README.md#ublock-origin">Korean (한국어)</a>,
            <a href="https://github.com/ialexsilva/uBlock/blob/master/README.md#ublock-origin">Português (Brasil)</a>
      </sup>
</sup>
</p>


**An efficient blocker add-on for various browsers. Fast, potent, and lean.**

* [Documentation](#documentation)
* [Purpose & General Info](#philosophy)
* [Performance and Efficiency](#performance)
  * [Memory](#memory)
  * [CPU](#cpu)
  * [Blocking](#blocking)
  * [Quick tests](#quick-tests)
* [Installation](#installation)
  * [Chromium](#chromium)
  * [Firefox](#firefox--firefox-for-android)
  * [Safari](#safari)
* [Release History](#release-history)
* [Privacy policy](https://github.com/gorhill/uBlock/wiki/Privacy-policy)
* [Wiki](https://github.com/gorhill/uBlock/wiki)

## Documentation

 Basic mode | Advanced-user mode
:----------:|:------------------:
[Popup user interface](https://github.com/gorhill/uBlock/wiki/Quick-guide:-popup-user-interface) | [A point-and-click firewall which can be configured on a per-site basis](https://github.com/gorhill/uBlock/wiki/Dynamic-filtering:-quick-guide) 
<a href="https://github.com/gorhill/uBlock/wiki/Quick-guide:-popup-user-interface"><img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/popup-1.png" /></a><br><sup>.<br>.</sup> | <a href="https://github.com/gorhill/uBlock/wiki/Dynamic-filtering:-quick-guide"><img src="https://cloud.githubusercontent.com/assets/585534/9293685/378d18f0-4402-11e5-9255-8ed3fdbfa957.png" /></a><br><sup>Configure as you wish:<br>picture shows 3rd-party scripts and frames blocked by default everywhere</sup>

Visit the [uBlock Origin's wiki](https://github.com/gorhill/uBlock/wiki) for documentation.

## Philosophy

uBlock Origin (or uBlock₀) is not an *ad blocker*; it's a general-purpose blocker. uBlock₀ blocks ads through its support of the [Adblock Plus filter syntax](https://adblockplus.org/en/filters). uBlock₀ [extends](https://github.com/gorhill/uBlock/wiki/Filter-syntax-extensions) the syntax and is designed to work with custom rules and filters. Furthermore, advanced mode allows uBlock₀ to work in [default-deny mode](https://github.com/gorhill/uBlock/wiki/Dynamic-filtering:-default-deny), which mode will cause [all 3rd-party network requests](https://requestpolicycontinued.github.io/#what-are-cross-site-requests) to be blocked by default, unless allowed by the user.

That said, it's important to note that using a blocker is **NOT** [theft](https://twitter.com/LeaVerou/status/518154828166725632). Don't fall for this creepy idea. The _ultimate_ logical consequence of `blocking = theft` is the criminalisation of the inalienable right to privacy.

Ads, "unintrusive" or not, are just the visible portions of privacy-invading apparatus entering your browser when you visit most sites nowadays. **uBlock₀'s main goal is to help users neutralize such privacy-invading apparatus** — in a way that welcomes those users who don't wish to use more technical, involved means (such as [µMatrix](https://github.com/gorhill/uMatrix)).

_EasyList_, _Peter Lowe's Adservers_, _EasyPrivacy_ and _Malware domains_ are enabled by default when you install uBlock₀. Many more lists are readily available to block trackers, analytics, and more. Hosts files are also supported.

Once you install uBlock₀, you may easily un-select any of the pre-selected filter lists if you think uBlock₀ blocks too much. For reference, Adblock Plus installs with only _EasyList_ enabled by default.

## Performance

#### Memory

<div align="center">
On average, uBlock Origin does make your browser run leaner. <sup>[1]</sup><br><br>

Chromium<br>
<img src="https://cloud.githubusercontent.com/assets/585534/10074141/15f04128-629c-11e5-9155-177fd4909083.png" /><br><br>

Firefox<br>
<img src="https://cloud.githubusercontent.com/assets/585534/10074130/0577118c-629c-11e5-9902-bf367c6a96c3.png" /><br><br>

</div>

<sup>[1] Details of the benchmark available at <a href="https://github.com/gorhill/uBlock/wiki/Firefox-version:-benchmarking-memory-footprint">Firefox version: benchmarking memory footprint</a>.</sup><br>

#### CPU

<p align="center">
uBlock Origin is also easy on the CPU<br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/benchmarks/cpu-usage-overall-chart-20141226.png" /><br>
<sup>Details of the benchmark available in <a href="https://github.com/gorhill/uBlock/blob/master/doc/benchmarks/cpu-usage-overall-20141226.ods">this LibreOffice spreadsheet</a>.</sup>
</p>

#### Blocking

<p align="center">
Being lean and efficient doesn't mean blocking less<br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/benchmarks/privex-201502-16.png" /><br>
<sup>For details of benchmark, see 
<a href="https://github.com/gorhill/uBlock/wiki/uBlock-and-others%3A-Blocking-ads%2C-trackers%2C-malwares">uBlock₀ and others: Blocking ads, trackers, malwares</a>.
</p>

#### Quick tests

- [Index](http://raymondhill.net/ublock/tests.html)
- [Web page components](http://raymondhill.net/ublock/tiles1.html)
- [Popups](http://raymondhill.net/ublock/popup.html)
- [ABP Test Pages](https://testpages.adblockplus.org/)

## Installation

Feel free to read [about the extension's required permissions](https://github.com/gorhill/uBlock/wiki/About-the-required-permissions).

#### Chromium

You can install the latest version [manually](https://github.com/gorhill/uBlock/tree/master/dist#install), from the [Chrome Store](https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm), or from the [Opera store](https://addons.opera.com/en-gb/extensions/details/ublock/) (uBlock Origin is published under the name "µBlock" in the Opera store -- the name can't be changed).

#### Firefox / Firefox for Android

[Firefox Add-ons web site](https://addons.mozilla.org/firefox/addon/ublock-origin/). There is also a development version if you want to test uBlock Origin with the latest changes: see [_uBlock Origin Version History_](https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/versions/)

The Firefox version of uBlock Origin has [an extra feature](https://github.com/gorhill/uBlock/wiki/Inline-script-tag-filtering) currently not yet available on Chromium-based browsers -- which feature is of great help to foil attempts by many web sites to circumvent blockers.

Also of interest: [Deploying uBlock Origin for Firefox with CCK2 and Group Policy](http://decentsecurity.com/ublock-for-firefox-deployment/).

#### Safari

There is no support for Safari for uBlock Origin.

Best is that you install [chrisaljoudi/uBlock](https://github.com/chrisaljoudi/uBlock), which has official support for Safari.

#### Note for all browsers

To benefit from uBlock Origin's higher efficiency, it's advised that you don't use other inefficient blockers at the same time (such as AdBlock or Adblock Plus). uBlock₀ will do [as well or better](#blocking) than most popular ad blockers.

## Release History

See the [releases pages](https://github.com/gorhill/uBlock/releases) for a history of releases and highlights for each release.

## About

[uBlock Origin's manifesto](MANIFESTO.md).

Free. Open source. For users by users. No donations sought.

Without the preset lists of filters, this extension is nothing. So if ever you
really do want to contribute something, think about the people working hard
to maintain the filter lists you are using, which were made available to use by
all for free.

You can contribute by helping translate uBlock₀ [on Crowdin](https://crowdin.net/project/ublock).

## License

[GPLv3](https://github.com/gorhill/uBlock/blob/master/LICENSE.txt).
