[<img src="https://travis-ci.org/gorhill/uBlock.svg?branch=master" height="18">](https://travis-ci.org/gorhill/uBlock)
[![Crowdin](https://d322cqt584bo4o.cloudfront.net/ublock/localized.png)](https://crowdin.com/project/ublock)

***

There is an idea floating around that uBlock Origin is a _lesser_ branch relative to [uBlock](https://github.com/chrisaljoudi/uBlock)<sup>[1]</sup>.

The current reality is that there are *two branches*, not an official one and a lesser one. I keep developing my branch the same way and in the same spirit I have since [the beginning of uBlock in June 23, 2014](http://www.wilderssecurity.com/threads/ublock-a-lean-and-fast-blocker.365273/), so in substance uBlock Origin _is_ the original uBlock.

**uBlock Origin is _completely_ unrelated to the web site `ublock.org`:** the donations sought by `ublock.org` are _not_ benefiting any of those who contributed most to create uBlock ([developers](https://github.com/gorhill/uBlock/graphs/contributors)<sup>[2]</sup>, [translators](https://crowdin.com/project/ublock), and all those who put efforts in opening detailed issues). For the differences in features between uBlock Origin and uBlock, you are more likely than anywhere else to find an unbiased explanation in this [Wikipedia article](http://en.wikipedia.org/wiki/UBlock).

Somewhere toward the end of May, I decided I will not contribute code anymore to this [uBlock branch](https://github.com/chrisaljoudi/uBlock).<sup>[3]</sup>

<sub>[1] [An example](https://www.ublock.org/faq/). [Another one](https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/reviews/716364/).</sub><br>
<sub>[2] Keep in mind these charts do not take into account all the work done on the wiki (doc, benchmarks), which work was for the most part not contributed by the individual behind `ublock.org`. </sub><br>
<sub>[3] Reasons: [this](https://en.wikipedia.org/w/index.php?title=UBlock&type=revision&diff=662527440&oldid=662107368) vs. [this](https://github.com/chrisaljoudi/uBlock/commits/master?author=gorhill), and [this](https://www.reddit.com/r/ublock/comments/38lf1y/any_difference_between_ublock_and_ublock_origin/crwhmwt), and overall because of serious incompatibilities in the spirit of the project.</sub><br>

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
            English,          <a href="https://github.com/fang5566/uBlock/blob/master/README.md#-µblock">
            Chinese (中文),   </a><a href="https://github.com/delightbot/uBlock/blob/master/README.md#ublock">
            Korean (한국어)   </a>
      </sup>
</sup>
</p>


**An efficient blocker add-on for various browsers. Fast, potent, and lean.**

* [Purpose & General Info](#philosophy)
* [Documentation](#documentation)
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
* [Privacy policy](https://github.com/gorhill/uBlock/wiki/Privacy-policy)
* [Wiki](https://github.com/gorhill/uBlock/wiki)

## Philosophy

uBlock Origin (or uBlock₀) is not an *ad blocker*; it's a general-purpose blocker. uBlock₀ blocks ads through its support of the [Adblock Plus filter syntax](https://adblockplus.org/en/filters). uBlock₀ [extends](https://github.com/gorhill/uBlock/wiki/Filter-syntax-extensions) the syntax and is designed to work with custom rules and filters.

That said, it's important to note that using a blocker is **NOT** [theft](https://twitter.com/LeaVerou/status/518154828166725632). Don't fall for this creepy idea. The _ultimate_ logical consequence of `blocking = theft` is the criminalisation of the inalienable right to privacy.

Ads, "unintrusive" or not, are just the visible portions of privacy-invading apparatus entering your browser when you visit most sites nowadays. **uBlock₀'s main goal is to help users neutralize such privacy-invading apparatus** — in a way that welcomes those users who don't wish to use more technical, involved means (such as [µMatrix](https://github.com/gorhill/uMatrix)).

_EasyList_, _Peter Lowe's Adservers_, _EasyPrivacy_ and _Malware domains_ are enabled by default when you install uBlock₀. Many more lists are readily available to block trackers, analytics, and more. Hosts files are also supported.

Once you install uBlock₀, you may easily un-select any of the pre-selected filter lists if you think uBlock₀ blocks too much. For reference, Adblock Plus installs with only _EasyList_ enabled by default.

By the way, looks like I still need to dispel that other myth: I've seen in [many](https://np.reddit.com/r/AskReddit/comments/35s2je/whats_a_product_that_everybody_uses_but_nobody/cr7h8l6) [places](https://twitter.com/1v1MeInBed/status/611658444244951040) [lately](https://np.reddit.com/r/explainlikeimfive/comments/363569/eli5_how_come_adblockublock_doesnt_let_the_ad/crafo5p?context=3) the following assertion:

> ublock blocks ads just like adblock plus, but triggers the ads API to think it got viewed

Completely false. uBlock Origin does not "trigger" any "ads API" (whatever that is). It [prevents network requests from being made](https://github.com/gorhill/uBlock/wiki/Does-uBlock-block-ads-or-just-hide-them%3F) according to filter lists so that your browser does not connect to remote servers, period.

## Documentation

[Quick guide: popup user interface](https://github.com/gorhill/uBlock/wiki/Quick-guide:-popup-user-interface)

<a href="https://github.com/gorhill/uBlock/wiki/Quick-guide:-popup-user-interface"><img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/popup-1.png" /></a>

For advanced usage, read about [dynamic filtering](https://github.com/gorhill/uBlock/wiki/Dynamic-filtering:-quick-guide) and more on [uBlock₀'s wiki](https://github.com/gorhill/uBlock/wiki).

## Performance

#### Memory

<div align="center">
On average, uBlock₀ <b>really</b> does make your browser run leaner. <sup>[1]</sup><br><br>

Chromium <sup>[2]</sup><br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/benchmarks/mem-usage-overall-chart-20141224.png" /><br><br>

Firefox<br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/benchmarks/mem-usage-overall-chart-20150205.png" /><br><br>

</div>

<sup>[1] Details of the benchmark available at <a href="https://github.com/gorhill/uBlock/wiki/Firefox-version:-benchmarking-memory-footprint">Firefox version: benchmarking memory footprint</a>.</sup><br>

<sup>[2] Important note: There is currently a [bug in Chromium v39 to v41 which causes a new memory leak each time the popup UI of an extension is opened](https://code.google.com/p/chromium/issues/detail?id=441500). This affects <i>all</i> extensions. Keep this in mind when measuring Chromium's memory usage. In the benchmarks, I avoided opening the popups completely.</sup><br>

#### CPU

<p align="center">
uBlock₀ is also easy on the CPU<br>
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

You can install the latest version [manually](https://github.com/gorhill/uBlock/tree/master/dist#install), from the [Chrome Store](https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm), or from the [Opera store](https://addons.opera.com/en-gb/extensions/details/ublock/).

#### Firefox / Firefox for Android

[Firefox Add-ons web site](https://addons.mozilla.org/firefox/addon/ublock-origin/), or install manually by downloading the latest [uBlock0.firefox.xpi](https://github.com/gorhill/uBlock/releases) file, and by dragging the downloaded `xpi` file to your add-on page.

Of interest: [Deploying uBlock Origin for Firefox with CCK2 and Group Policy](http://decentsecurity.com/ublock-for-firefox-deployment/).

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
