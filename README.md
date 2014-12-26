# µBlock for Chromium

**Foreword:** Using a blocker is **NOT** [theft](https://twitter.com/LeaVerou/status/518154828166725632). Do not fall for this creepy idea. The _ultimate_ logical consequence of "blocking = theft" is the criminalisation of the inalienable right to privacy.

See [releases page](https://github.com/gorhill/uBlock/releases) for recent changes.
See [Wiki](https://github.com/gorhill/uBlock/wiki) for more information.

An efficient blocker for Chromium-based browsers. Fast and lean. Written from scratch. Development
through benchmarking.

**µBlock is not an "ad blocker", it's a blocker in the broad sense**, which happens to block ads through its support of [Adblock Plus filter syntax](https://adblockplus.org/en/filters). µBlock  [extends](https://github.com/gorhill/uBlock/wiki/Filter-syntax-extensions) the syntax.

_EasyList_, _Peter Lowe's Adservers_ , _EasyPrivacy_ and _Fanboy's Social Block List_ are enabled by default when you install µBlock. Many more lists are readily available to protect yourself from trackers, analytics, data mining, and more ads. Hosts files are supported.

Ads are just the visible portions of privacy-invading apparatus entering your browser when you visit most sites nowadays.

My main goal with µBlock is to help users neutralize as much as can be privacy-invading apparatus (of which ads, "unintrusive" or not, are just the visible portion) for users who do not want to deal with more technical means like [µMatrix](https://github.com/gorhill/uMatrix).

<p align="center">
µBlock: on average, it <b>really</b> does make your browser run leaner<br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/benchmarks/mem-usage-overall-chart-20141224.png" /><br>
<sup>Details of the benchmark available in <a href="https://github.com/gorhill/uBlock/blob/master/doc/benchmarks/mem-usage-overall-20141224.ods">this LibreOffice spreadsheet</a>.</sup>
</p>

<p align="center">
µBlock: it is also easy on the CPU<br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/benchmarks/cpu-usage-overall-chart-20141226.png" /><br>
<sup>An overview of the CPU ovearhead added by extensions.<br>Details of the benchmark available in <a href="https://github.com/gorhill/uBlock/blob/master/doc/benchmarks/cpu-usage-overall-20141226.ods">this LibreOffice spreadsheet</a>.</sup>
</p>

<p align="center">
Being lean doesn't mean blocking less.<br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/benchmarks/privex-201409-30.png" /><br>
<sup>For details of benchmark, see latest
<a href="https://github.com/gorhill/uBlock/wiki/%C2%B5Block-and-others:-Blocking-ads,-trackers,-malwares">µBlock and others: Blocking ads, trackers, malwares</a>.
</p>

## Installation

From the [Chrome store](https://chrome.google.com/webstore/detail/cjpalhdlnbpafiamejdnhcphjbkeiagm), the [Opera store](https://addons.opera.com/en-gb/extensions/details/ublock/), or [manually](https://github.com/gorhill/uBlock/tree/master/dist#install).

To benefit from the higher efficiency, it is of course not advised to use an
inefficient blocker at the same time. µBlock will do as well or better than the
popular blockers out there.

Also of interest: [About the required permissions](https://github.com/gorhill/uBlock/wiki/About-the-required-permissions).

## Documentation

I think it is pretty obvious, except for this I suppose:

![Popup](https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/popup-1.png)&emsp; ![Popup](https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/popup-2.png)

The big power button is to disable/enable µBlock **for the specific hostname
which can be extracted from the URL address of the current page**. (It applies to
the current web site only, it is **not** a global power button.) The state of the power
switch for a specific site will be remembered.

The right-hand screenshot shows optional [dynamic filtering](https://github.com/gorhill/uBlock/wiki/Dynamic-filtering) at work.

## About

µBlock is born out of [HTTP Switchboard](https://github.com/gorhill/httpswitchboard).
All the niceties of HTTPSB have been removed, and what is left is a straightforward
blocker which support EasyList and the likes, and also support host files.
Cosmetic filters ("element hiding") are supported.

There is nothing more to it. But it does what popular blockers out there do, at a
fraction of CPU and memory usage for the same blocking power. Also, no unique user id
and no home means no phoning home (some popular blockers do this, just be careful).

Free. Open source. For users by users. No donations sought.

Without the preset lists of filters, this extension is nothing. So if ever you
really do want to contribute something, think about the people working hard
to maintain the filter lists you are using, which were made available to use by
all for free.

You may contribute by helping to translate this project. I created an
[entry on Crowdin](https://crowdin.net/project/ublock), where you may contribute
to the translation work.

## License

[GPLv3](https://github.com/gorhill/uBlock/blob/master/LICENSE.txt).
