# <sub>![logo](https://raw.githubusercontent.com/gorhill/uBlock/master/src/img/browsericons/icon38.png)</sub> µBlock

**An efficient blocker for WebKit- and Blink-based browsers. Fast, potent, and lean.**

* [Purpose & General Info](#philosophy)
* [Performance and Efficiency](#performance)
  * [Memory](#memory)
  * [CPU](#cpu)
  * [Blocking](#blocking)
* [Installation](#installation)
* [Release History](#release-history)
* [Wiki](https://github.com/gorhill/uBlock/wiki)

# Philosophy

µBlock is not an *ad blocker*; it's a general-purpose blocker. µBlock blocks ads through its support of the [Adblock Plus filter syntax](https://adblockplus.org/en/filters). µBlock  [extends](https://github.com/gorhill/uBlock/wiki/Filter-syntax-extensions) the syntax and is designed to work with custom rules and filters.

That said, it's important to note that using a blocker is **NOT** [theft](https://twitter.com/LeaVerou/status/518154828166725632). Don't fall for this creepy idea. The _ultimate_ logical consequence of `blocking = theft` is the criminalisation of the inalienable right to privacy.

Ads, "unintrusive" or not, are just the visible portions of privacy-invading apparatus entering your browser when you visit most sites nowadays. **µBlock's main goal is to help users neutralize such privacy-invading apparatus** — in a way that welcomes those users who don't wish to use more technical, involved means (such as [µMatrix](https://github.com/gorhill/uMatrix)).

_EasyList_, _Peter Lowe's Adservers_, _EasyPrivacy_ are enabled by default when you install µBlock. Many more lists are readily available to block trackers, analytics, and more. Hosts files are also supported.

# Performance

## Memory

<p align="center">
On average, µBlock <b>really</b> does make your browser run leaner<br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/benchmarks/mem-usage-overall-chart-20141224.png" /><br>
<sup>Details of the benchmark available in <a href="https://github.com/gorhill/uBlock/blob/master/doc/benchmarks/mem-usage-overall-20141224.ods">this LibreOffice spreadsheet</a>.</sup>
</p>

**Important note regarding memory usage:**

<sup>There is currently a [bug in Chromium 39+ which causes a new memory leak each time the popup UI of an extension is opened](https://code.google.com/p/chromium/issues/detail?id=441500).</sup>

<sup>This affects *all* extensions.</sup>

<sup>As such, please be informed of that when measuring Chromium's memory usage. In the benchmarks, I avoided opening the popups completely.</sup>

## CPU

<p align="center">
µBlock is also easy on the CPU<br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/benchmarks/cpu-usage-overall-chart-20141226.png" /><br>
<sup>Details of the benchmark available in <a href="https://github.com/gorhill/uBlock/blob/master/doc/benchmarks/cpu-usage-overall-20141226.ods">this LibreOffice spreadsheet</a>.</sup>
</p>

## Blocking

<p align="center">
Being lean and efficient doesn't mean blocking less<br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/benchmarks/privex-201409-30.png" /><br>
<sup>For details of benchmark, see 
<a href="https://github.com/gorhill/uBlock/wiki/%C2%B5Block-and-others:-Blocking-ads,-trackers,-malwares">µBlock and others: Blocking ads, trackers, malwares</a>.
</p>

## Installation

Install µBlock from the [Chrome store](https://chrome.google.com/webstore/detail/cjpalhdlnbpafiamejdnhcphjbkeiagm), the [Opera store](https://addons.opera.com/en-gb/extensions/details/ublock/), or [manually](https://github.com/gorhill/uBlock/tree/master/dist#install).

Feel free to read [about the extension's required permissions](https://github.com/gorhill/uBlock/wiki/About-the-required-permissions).

**Note:**

To benefit from µBlock's higher efficiency, it's advised that you don't use other inefficient blockers at the same time (such as AdBlock or Adblock Plus). µBlock will do [as well or better](#blocking) than most popular ad blockers.

## Release History

See the [releases pages](https://github.com/gorhill/uBlock/releases) for a history of releases and highlights for each release.

## Documentation

µBlock's functionality is self-explanatory and intuitive for the most part. One thing to note after you get started is the big power button in µBlock's popup:

![Popup](https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/popup-1.png)

The big power button is to disable/enable µBlock for the specific current site/hostname (as extracted from the URL of the current page).

**In other words, it applies to the current site only; it is *not* a global power button.** The state of the power switch for a specific site will be remembered. 

For advanced usage, read about [dynamic filtering](https://github.com/gorhill/uBlock/wiki/Dynamic-filtering:-quick-guide) and more on [µBlock's wiki](https://github.com/gorhill/uBlock/wiki).

## About

Free. Open source. For users by users. No donations sought.

Without the preset lists of filters, this extension is nothing. So if ever you
really do want to contribute something, think about the people working hard
to maintain the filter lists you are using, which were made available to use by
all for free.

You can contribute by helping to translate this project. There's an
[entry on Crowdin](https://crowdin.net/project/ublock) where you may contribute to µBlock's localization.

## License

[GPLv3](https://github.com/gorhill/uBlock/blob/master/LICENSE.txt).
