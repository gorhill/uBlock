# <sub>![logo](https://raw.githubusercontent.com/gorhill/uBlock/master/src/img/browsericons/icon38.png)</sub> µBlock

<sup>[中文](https://github.com/fang5566/uBlock#-%C2%B5block)</sup><br>
<sub>pronounce _you-block_ as in "you decide what enters your browser" / see the "µ" as a stylish "u", to emphasize small resource footprint<br></sub><sup>sorry for the dubious name, we are coders, not marketers</sup>

**An efficient blocker add-on for various browsers. Fast, potent, and lean.**

* [Purpose & General Info](#philosophy)
* [Performance and Efficiency](#performance)
  * [Memory](#memory)
  * [CPU](#cpu)
  * [Blocking](#blocking)
  * [Quick tests](#quick-tests)
* [Installation](#installation)
  * [Chromium](#chromium)
  * [Firefox](#firefox)
  * [Safari](#safari)
* [Release History](#release-history)
* [Wiki](https://github.com/gorhill/uBlock/wiki)

# [![Build Status](https://travis-ci.org/gorhill/uBlock.svg?branch=master)](https://travis-ci.org/gorhill/uBlock)

## Philosophy

µBlock is not an *ad blocker*; it's a general-purpose blocker. µBlock blocks ads through its support of the [Adblock Plus filter syntax](https://adblockplus.org/en/filters). µBlock [extends](https://github.com/gorhill/uBlock/wiki/Filter-syntax-extensions) the syntax and is designed to work with custom rules and filters.

That said, it's important to note that using a blocker is **NOT** [theft](https://twitter.com/LeaVerou/status/518154828166725632). Don't fall for this creepy idea. The _ultimate_ logical consequence of `blocking = theft` is the criminalisation of the inalienable right to privacy.

Ads, "unintrusive" or not, are just the visible portions of privacy-invading apparatus entering your browser when you visit most sites nowadays. **µBlock's main goal is to help users neutralize such privacy-invading apparatus** — in a way that welcomes those users who don't wish to use more technical, involved means (such as [µMatrix](https://github.com/gorhill/uMatrix)).

_EasyList_, _Peter Lowe's Adservers_, _EasyPrivacy_ and _Malware domains_ are enabled by default when you install µBlock. Many more lists are readily available to block trackers, analytics, and more. Hosts files are also supported.

Once you install µBlock, you may easily un-select any of the pre-selected filter lists if you think µBlock blocks too much. For reference, Adblock Plus installs with only _EasyList_ enabled by default.

## Performance

#### Memory

<div align="center">
On average, µBlock <b>really</b> does make your browser run leaner. <sup>[1]</sup><br><br>

Chromium <sup>[2]</sup><br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/benchmarks/mem-usage-overall-chart-20141224.png" /><br><br>

Firefox<br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/benchmarks/mem-usage-overall-chart-20150205.png" /><br><br>

Safari<br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/benchmarks/mem-usage-overall-chart-safari-20150205.png" /><br><br>

</div>

<sup>[1] Details of the benchmark available at <a href="https://github.com/gorhill/uBlock/wiki/Firefox-version:-benchmarking-memory-footprint">Firefox version: benchmarking memory footprint</a>.</sup><br>

<sup>[2] Important note: There is currently a [bug in Chromium 39+ which causes a new memory leak each time the popup UI of an extension is opened](https://code.google.com/p/chromium/issues/detail?id=441500). This affects <i>all</i> extensions. Keep this in mind when measuring Chromium's memory usage. In the benchmarks, I avoided opening the popups completely.</sup><br>

#### CPU

<p align="center">
µBlock is also easy on the CPU<br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/benchmarks/cpu-usage-overall-chart-20141226.png" /><br>
<sup>Details of the benchmark available in <a href="https://github.com/gorhill/uBlock/blob/master/doc/benchmarks/cpu-usage-overall-20141226.ods">this LibreOffice spreadsheet</a>.</sup>
</p>

#### Blocking

<p align="center">
Being lean and efficient doesn't mean blocking less<br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/benchmarks/privex-201502-16.png" /><br>
<sup>For details of benchmark, see 
<a href="https://github.com/gorhill/uBlock/wiki/%C2%B5Block-and-others:-Blocking-ads,-trackers,-malwares">µBlock and others: Blocking ads, trackers, malwares</a>.
</p>

#### Quick tests

- [Index](http://raymondhill.net/ublock/tests.html)
- [Web page components](http://raymondhill.net/ublock/tiles1.html)
- [Popups](http://raymondhill.net/ublock/popup.html)

## Installation

Feel free to read [about the extension's required permissions](https://github.com/gorhill/uBlock/wiki/About-the-required-permissions).

#### Chromium

You can install the latest version [manually](https://github.com/gorhill/uBlock/tree/master/dist#install), from the [Chrome Web Store](https://chrome.google.com/webstore/detail/cjpalhdlnbpafiamejdnhcphjbkeiagm), or from the [Opera store](https://addons.opera.com/en-gb/extensions/details/ublock/).

#### Firefox

Install from [Firefox Add-ons homepage](https://addons.mozilla.org/en-US/firefox/addon/ublock/), or you can install by downloading the latest [uBlock.firefox.xpi](https://github.com/gorhill/uBlock/releases) file, and by dragging the downloaded `xpi` file to your add-on page.

#### Safari

Install the latest µBlock for Safari [from its homepage](https://chrismatic.io/ublock/), or a potentially-outdated version from the [Safari Extension Gallery](https://extensions.apple.com/details/?id=net.gorhill.uBlock-96G4BAKDQ9).

<sup>Safari 6.1 and later (developed on Safari 8/Yosemite; tested on 6.1/Mountain Lion and 7/Mavericks).</sup>

#### Note for all browsers

To benefit from µBlock's higher efficiency, it's advised that you don't use other inefficient blockers at the same time (such as AdBlock or Adblock Plus). µBlock will do [as well or better](#blocking) than most popular ad blockers.

## Release History

See the [releases pages](https://github.com/gorhill/uBlock/releases) for a history of releases and highlights for each release.

## Documentation

[Quick guide: popup user interface](https://github.com/gorhill/uBlock/wiki/Quick-guide:-popup-user-interface)

![Popup](https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/popup-1.png)

For advanced usage, read about [dynamic filtering](https://github.com/gorhill/uBlock/wiki/Dynamic-filtering:-quick-guide) and more on [µBlock's wiki](https://github.com/gorhill/uBlock/wiki).

## About

[µBlock's manifesto](MANIFESTO.md).

Free. Open source. For users by users. No donations sought.

Without the preset lists of filters, this extension is nothing. So if ever you
really do want to contribute something, think about the people working hard
to maintain the filter lists you are using, which were made available to use by
all for free.

You can contribute by helping translate µBlock [on Crowdin](https://crowdin.net/project/ublock).

## License

[GPLv3](https://github.com/gorhill/uBlock/blob/master/LICENSE.txt).
