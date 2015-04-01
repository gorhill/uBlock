<h1 align="center">
<a href = "https://chrismatic.io/ublock/">
<img  src="https://raw.githubusercontent.com/chrisaljoudi/uBlock/master/doc/img/icon64@2x.png"
      height="64"
      width="64">
</a>
</h1>
<p align="center">
<sup> <!-- Pronounciation -->
      <i>you</i> decide what enters your browser.
</sup>
<br>
<sup> <!-- Languages -->
      <img src="https://raw.githubusercontent.com/chrisaljoudi/uBlock/master/doc/img/languageicon-36.png" width="18" height="18">
      <sup>
            English,          <a href="https://github.com/fang5566/uBlock/blob/master/README.md#-µblock">
            Chinese (中文),   </a><a href="https://github.com/delightbot/uBlock/blob/master/README.md#ublock">
            Korean (한국어)   </a>
      </sup>
</sup>
</p>


**uBlock:** an efficient blocker add-on for various browsers. Fast, potent, and lean.&nbsp;&nbsp;[<img src="https://travis-ci.org/chrisaljoudi/uBlock.svg?branch=master" height="16">](https://travis-ci.org/chrisaljoudi/uBlock)

* [What is uBlock?](#what-is-ublock)
* [Documentation](#documentation)
* [Performance and Efficiency](#performance)
  * [Memory](#memory)
  * [CPU](#cpu)
  * [Blocking](#blocking)
  * [Quick tests](#quick-tests)
* [Installation](#installation)
  * [General Info](#general-info)
  * [Chrome](#chromium)
  * [Firefox](#firefox)
  * [Safari](#safari)
* [Release History](#release-history)
* [Wiki](https://github.com/chrisaljoudi/uBlock/wiki)

## What is uBlock?

uBlock is a general-purpose blocker — not an *ad blocker* specifically.

uBlock blocks ads through its support of the [Adblock Plus filter syntax](https://adblockplus.org/en/filters). uBlock [extends](https://github.com/chrisaljoudi/uBlock/wiki/Filter-syntax-extensions) the syntax and is designed to work with custom rules and filters.

That said, it's important to note that blocking ads [is *not* theft](https://twitter.com/LeaVerou/status/518154828166725632). Don't fall for this creepy idea. The _ultimate_ logical consequence of `blocking = theft` is the criminalisation of the inalienable right to privacy.

uBlock's main goal is to help users neutralize privacy-invading apparatus — ads being one example.

## Documentation

[Quick guide: popup user interface](https://github.com/chrisaljoudi/uBlock/wiki/Quick-guide:-popup-user-interface)

<a href="https://github.com/chrisaljoudi/uBlock/wiki/Quick-guide:-popup-user-interface"><img src="https://raw.githubusercontent.com/chrisaljoudi/uBlock/master/doc/img/popup-1.png" /></a>

For advanced usage, read about [dynamic filtering](https://github.com/chrisaljoudi/uBlock/wiki/Dynamic-filtering:-quick-guide) and more on [uBlock's wiki](https://github.com/chrisaljoudi/uBlock/wiki).

## Performance

#### Memory

<div align="center">
On average, uBlock <b>really</b> does make your browser run leaner. <sup>[1]</sup><br><br>

Chromium <sup>[2]</sup><br>
<img src="https://raw.githubusercontent.com/chrisaljoudi/uBlock/master/doc/benchmarks/mem-usage-overall-chart-20141224.png" /><br><br>

Firefox<br>
<img src="https://raw.githubusercontent.com/chrisaljoudi/uBlock/master/doc/benchmarks/mem-usage-overall-chart-20150205.png" /><br><br>

Safari<br>
<img src="https://raw.githubusercontent.com/chrisaljoudi/uBlock/master/doc/benchmarks/mem-usage-overall-chart-safari-20150205.png" /><br><br>

</div>

<sup>[1] Details of the benchmark available at <a href="https://github.com/chrisaljoudi/uBlock/wiki/Firefox-version:-benchmarking-memory-footprint">Firefox version: benchmarking memory footprint</a>.</sup><br>

<sup>[2] Important note: There is currently a [bug in Chromium 39+ which causes a new memory leak each time the popup UI of an extension is opened](https://code.google.com/p/chromium/issues/detail?id=441500). This affects <i>all</i> extensions. Keep this in mind when measuring Chromium's memory usage. In the benchmarks, I avoided opening the popups completely.</sup><br>

#### CPU

<p align="center">
uBlock is also easy on the CPU<br>
<img src="https://raw.githubusercontent.com/chrisaljoudi/uBlock/master/doc/benchmarks/cpu-usage-overall-chart-20141226.png" /><br>
<sup>Details of the benchmark available in <a href="https://github.com/chrisaljoudi/uBlock/blob/master/doc/benchmarks/cpu-usage-overall-20141226.ods">this LibreOffice spreadsheet</a>.</sup>
</p>

#### Blocking

<p align="center">
Being lean and efficient doesn't mean blocking less<br>
<img src="https://raw.githubusercontent.com/chrisaljoudi/uBlock/master/doc/benchmarks/privex-201502-16.png" /><br>
<sup>For details of benchmark, see 
<a href="https://github.com/chrisaljoudi/uBlock/wiki/uBlock-and-others%3A-Blocking-ads%2C-trackers%2C-malwares">uBlock and others: Blocking ads, trackers, malwares</a>.
</p>

#### Quick tests

- [Index](http://raymondhill.net/ublock/tests.html)
- [Web page components](http://raymondhill.net/ublock/tiles1.html)
- [Popups](http://raymondhill.net/ublock/popup.html)

## Installation

#### General info

_EasyList_, _Peter Lowe's Adservers_, _EasyPrivacy_ and _Malware domains_ are enabled by default when you install uBlock. Many more lists are readily available to block trackers, analytics, and more. Hosts files are also supported.

Once you install uBlock, you can easily un-select any of the pre-selected filter lists if you think uBlock blocks too much. For reference, Adblock Plus installs with only _EasyList_ enabled by default.

**To benefit from uBlock's higher efficiency,** it's advised that you don't use other inefficient blockers at the same time (such as AdBlock or Adblock Plus). uBlock will do [as well or better](#blocking) than most popular ad blockers.

Feel free to read [about the extension's required permissions](https://github.com/chrisaljoudi/uBlock/wiki/About-the-required-permissions).

#### Chromium

You can install the latest version from the [Chrome Web Store](https://chrome.google.com/webstore/detail/ublock/epcnnfbjfcgphgdmggkamkmgojdagdnn), from the [Opera store](https://addons.opera.com/en-gb/extensions/details/ublock/), or [manually](https://github.com/chrisaljoudi/uBlock/tree/master/dist#install).

#### Firefox

Install from [Firefox Add-ons homepage](https://addons.mozilla.org/en-US/firefox/addon/ublock/), or you can install by downloading the latest [uBlock.firefox.xpi](https://github.com/chrisaljoudi/uBlock/releases) file, and by dragging the downloaded `xpi` file to your add-on page.

<sup>**Note:** When a new version is submitted at _Mozilla Add-ons_ (AMO), it takes **weeks** for that submission to be reviewed and cleared. Any new submission would cancel the pending one, and the new one would be placed at the end of the reviewing queue. So that the version on AMO is way behind the latest release here is completely out of control of the developers.</sup>

#### Safari

Install the latest uBlock for Safari [from its homepage](https://chrismatic.io/ublock/), or a potentially-outdated version from the [Safari Extension Gallery](https://extensions.apple.com/details/?id=net.chrisaljoudi.uBlock-96G4BAKDQ9).

<sup>Safari 6.1 and later (developed on Safari 8/Yosemite; tested on 6.1/Mountain Lion and 7/Mavericks).</sup>

## Release History

See the [releases pages](https://github.com/chrisaljoudi/uBlock/releases) for a history of releases and highlights for each release.

## About

[uBlock's manifesto](MANIFESTO.md).

Free. Open source. For users by users.

If uBlock is useful to you, [donations to support development are much appreciated](https://chrismatic.io/ublock/).

uBlock is made useful because of the filter lists it utilizes. We deeply appreciate
the people working hard to maintain the filter lists we're using,
which were made available to use by all for free.

You can contribute by helping translate uBlock [on Crowdin](https://crowdin.net/project/ublock).

## License

[GPLv3](https://github.com/chrisaljoudi/uBlock/blob/master/LICENSE.txt).
