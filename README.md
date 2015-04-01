<a href = "https://chrismatic.io/ublock/">
<img  src="https://raw.githubusercontent.com/chrisaljoudi/uBlock/master/doc/img/icon64@2x.png"
      height="64"
      width="64">
</a>

[**uBlock**](https://chrismatic.io/ublock/): an efficient blocker add-on for various browsers. Fast, potent, and lean.&nbsp;&nbsp;[<img src="https://travis-ci.org/chrisaljoudi/uBlock.svg?branch=master" height="16">](https://travis-ci.org/chrisaljoudi/uBlock)

* [What is uBlock?](#what-is-ublock)
* [Installation](#installation)
* [Performance & Benchmarks](#performance)
* [Release History](#release-history)
* [Tips](#tips)
* [Wiki](https://github.com/chrisaljoudi/uBlock/wiki)

## What is uBlock?

uBlock is a general-purpose blocker — not an *ad blocker* specifically.

uBlock blocks ads through its support of the [Adblock Plus filter syntax](https://adblockplus.org/en/filters). uBlock [extends](https://github.com/chrisaljoudi/uBlock/wiki/Filter-syntax-extensions) the syntax and is designed to work with custom rules and filters.

uBlock's main goal is to help users neutralize privacy-invading apparatus — ads being one example.

## Installation

[Quick guide: popup user interface](https://github.com/chrisaljoudi/uBlock/wiki/Quick-guide:-popup-user-interface).

* **Safari**: available to install [from the homepage](https://chrismatic.io/ublock/safari/), or from the [Safari Extension Gallery](https://extensions.apple.com/details/?id=net.chrisaljoudi.uBlock-96G4BAKDQ9).

* **Chrome**: available on the [Chrome Web Store](https://chrome.google.com/webstore/detail/ublock/epcnnfbjfcgphgdmggkamkmgojdagdnn), the [Opera store](https://addons.opera.com/en-gb/extensions/details/ublock/), or for [manual](https://github.com/chrisaljoudi/uBlock/tree/master/dist#install) installation.

* **Firefox**: available on the [Firefox Add-ons homepage](https://addons.mozilla.org/en-US/firefox/addon/ublock/), or for [manual]((https://github.com/chrisaljoudi/uBlock/releases)) installation.

 * Due to Mozilla's review process, the version of uBlock available from the Add-ons homepage is often outdated. This isn't in our control.

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

## Release History

See the [releases pages](https://github.com/chrisaljoudi/uBlock/releases) for a history of releases and highlights for each release.

## Tips

* **To benefit from uBlock's higher efficiency,** it's advised that you don't use other inefficient blockers at the same time (such as AdBlock or Adblock Plus). uBlock will do [as well or better](#blocking) than most popular ad blockers.

* It's important to note that blocking ads [is *not* theft](https://twitter.com/LeaVerou/status/518154828166725632). Don't fall for this creepy idea. The _ultimate_ logical consequence of `blocking = theft` is the criminalisation of the inalienable right to privacy.

* _EasyList_, _Peter Lowe's Adservers_, _EasyPrivacy_ and _Malware domains_ are enabled by default when you install uBlock. Many more lists are readily available to block trackers, analytics, and more. Hosts files are also supported.

* Once you install uBlock, you can easily un-select any of the pre-selected filter lists if you think uBlock blocks too much. For reference, Adblock Plus installs with only _EasyList_ enabled by default.

* Feel free to read [about the extension's required permissions](https://github.com/chrisaljoudi/uBlock/wiki/About-the-required-permissions).

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
