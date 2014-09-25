# µBlock for Chromium

See [releases page](https://github.com/gorhill/uBlock/releases) for recent changes. 
See [Wiki](https://github.com/gorhill/uBlock/wiki) for more information.

An efficient blocker for Chromium-based browsers. Fast and lean. Written from scratch. Development 
through benchmarking.

**µBlock is not an "ad blocker", it's a blocker in the broad sense**, which happens to block ads through its support of [Adblock Plus filter syntax](https://adblockplus.org/en/filters). µBlock  [adds to the syntax](https://github.com/gorhill/uBlock/wiki/Filter-syntax-extensions).

_EasyList_, _EasyPrivacy_ and _Peter Lowe's Adservers_ list are enabled by default when you install µBlock. Many more lists are readily available to protect yourself from trackers, analytics, data mining, and more ads. Hosts files are supported.

In my opinion, ads are just the visible portions of privacy-invading apparatus entering your browser when you visit most sites nowadays.

My main goal with µBlock is to help users neutralize as much as can be privacy-invading apparatus (of which ads, "unintrusive" or not, are just the visible portion) for users who do not want to deal with more technical means like [HTTP Switchboard](https://github.com/gorhill/httpswitchboard#http-switchboard-for-chromium).

<p align="center">
µBlock: page loaded. ABP: page still loading.<br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/abp-vs-ublock-page-1.png" /><br>
<sup>Image excerpted from https://www.youtube.com/watch?v=SzJr4hmPlgQ.</sup>
</p>

<p align="center">
Chromium on Linux 64-bit<br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/ss-chromium-2.png" /><br><br>
Opera 22 on Windows 7 32-bit<br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/ss-opera-1.png" /><br>
<sup>The screenshots above were taken after visiting links in 
<a href="https://github.com/gorhill/uBlock/wiki/Reference-benchmark">reference benchmark</a> 
plus a bit of random browsing. All blockers were active at the same time, 
thus they had to deal with exactly the same workload. Before the screenshots were 
taken, I left the browser idle for many minutes so as to let the browser's 
garbage collector kicks in. Also, after a while idling, it's good to open the dev
console for each extension and force a garbage collection cycle by clicking a couple of times 
the trashcan icon in the _Timeline_ tab (this caused a ~15MB drop for µBlock and Adguard in Opera) 
as garbage collectors sometimes work in a very lazy way, so I did this for each extension.</sup>
</p>

<p align="center">
Being lean doesn't mean blocking less.<br>
<img src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/privacy-benchmark.png" /><br>
<sup>For details of benchmark, see 
<a href="https://github.com/gorhill/uBlock/wiki/%C2%B5Block-and-others:-Blocking-ads,-trackers,-malwares">µBlock and others: Blocking ads, trackers, malwares</a>.
</p>

## Installation

From the [Chrome store](https://chrome.google.com/webstore/detail/µblock/cjpalhdlnbpafiamejdnhcphjbkeiagm), 
the [Opera store](https://addons.opera.com/en-gb/extensions/details/ublock/), or [manually](https://github.com/gorhill/uBlock/tree/master/dist#install).

To benefit from the higher efficiency, it is of course not advised to use an 
inefficient blocker at the same time. µBlock will do as well or better than the 
popular blockers out there.

Also of interest: [About the required permissions](https://github.com/gorhill/uBlock/wiki/About-the-required-permissions).

## Documentation

I think it is pretty obvious, except for this I suppose:

![Popup](https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/popup-1.png)

The big power button is to disable/enable µBlock **for the specific hostname
which can be extracted from the URL address of the current page**. (It applies to 
the current web site only, it is **not** a global power button.) The state of the power 
switch for a specific site will be remembered.

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
