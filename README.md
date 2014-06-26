# µBlock for Chromium

See [Change log](https://github.com/gorhill/uBlock/wiki/Change-log) for latest changes.

An efficient blocker for Chromium-based browsers. Fast and lean.

Chromium on Linux 64-bit:
![screenshot](https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/ss-chromium-2.png)

Opera 22 on Windows 7 32-bit:
![screenshot](https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/ss-opera-1.png)

<sup>The above screenshots were taken after running my 
[reference benchmark](https://github.com/gorhill/httpswitchboard/wiki/Comparative-benchmarks-against-widely-used-blockers:-Top-15-Most-Popular-News-Websites) 
plus a bit of random browsing. All blockers were active at the same time, 
thus they had to deal with exactly the same workload. Before the screenshot was 
taken, I left the browser idle for many minutes so as to let the browser's 
garbage collector kicks in.</sup>

#### Dispelling a few myths flying around

- "µBlock does not support element hiding".
    - Yes it does. If you don't believe it, try entering `twitter.com##body` in the 
_"Your filters"_ text area and see what happens when you visit twitter.com.
    - What it doesn't support [yet](https://github.com/gorhill/uBlock/issues/4), 
is the UI counterpart to "element hiding", i.e. being able to click on an element 
to extract filters out of it.
- "The memory usage isn't actually ABP's fault, _EasyList_ is like 40,000+ lines of rules that all have to be parsed by ABP".
    - Hum, µBlock also parse _EasyList_. And _EasyPrivacy_. And _Malware domains_ lists. 
And _Peter Lowes's Ad server_ list. Out of the box. Yet uses less than half the 
memory of ABP.
    - And for a fun memory test, you can try yourself the 
[infamous vim test](https://github.com/gorhill/httpswitchboard/wiki/Adblock-Plus-memory-consumption), 
once with only ABP as the active extension, and once with only µBlock as the active extension. (Other 
extensions may also add their own memory footprint.)

#### Regarding reviews in various web store

- [My answer to web store reviews where appropriate](https://github.com/gorhill/uBlock/wiki/My-answer-to-web-store-reviews-where-appropriate)

#### Some articles about the origin of the source code behind µBlock

- [Net request filtering efficiency: HTTP Switchboard vs. Adblock Plus](https://github.com/gorhill/httpswitchboard/wiki/Net-request-filtering-efficiency:-HTTP-Switchboard-vs.-Adblock-Plus)
- [Adblock Plus memory consumption](https://github.com/gorhill/httpswitchboard/wiki/Adblock-Plus-memory-consumption)

#### Forums

- [On Reddit](http://www.reddit.com/r/chrome/comments/28xt2j/%C2%B5block_a_fast_and_lean_blocker_for_chromiumbased/)
- [On Hacker News](https://news.ycombinator.com/item?id=7936809)

## Installation

From the [Chrome store](https://chrome.google.com/webstore/detail/µblock/cjpalhdlnbpafiamejdnhcphjbkeiagm), 
or [manually](https://github.com/gorhill/uBlock/tree/master/dist).

To benefit from the higher efficiency, it is of course not advised to use an 
inefficient blocker at the same time. µBlock will do as well or better than the 
popular blockers out there.

## Documentation

I think it is pretty obvious, except for this I suppose:

![Popup](https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/popup-1.png)

The big fat power button is to disable/enable µBlock **for the specific hostname
which can be extracted from the URL address of the current page**. (It applies to 
the current web site only, it is **not** a global power button.) The state of the power 
switch for a specific site will be remembered.

## Benchmarks

I ran my [reference benchmark](https://github.com/gorhill/httpswitchboard/wiki/Comparative-benchmarks-against-widely-used-blockers:-Top-15-Most-Popular-News-Websites) 
to compare against other popular blockers.

Results -- figures are *3rd party* / *all*:

#### µBlock 0.1.0.4

* Domains: **66** / 67
* Hosts: 117 / 171
* Scripts: 239 / 321
* Outbound cookies: 8 / 42
* Net requests: 1,035 / 1,877

#### Adblock Plus 1.8.3

* Domains: **72** / 73
* Hosts: 124 / 177
* Scripts: 243 / 328
* Outbound cookies: 8 / 44
* Net requests: 1,041 / 1,913

#### Ghostery 5.3.0

* Domains: **83** / 84
* Hosts: 140 / 211
* Scripts: 239 / 343
* Outbound cookies: 17 / 57
* Net requests: 1,046 / 1,930

#### Adguard 1.0.2.9

* Domains: **89** / 90
* Hosts: 145 / 217
* Scripts: 262 / 349
* Outbound cookies: 18 / 68
* Net requests: 1,064 / 1,904

#### Disconnect 5.18.14

* Domains: **95** / 96
* Hosts: 163 / 239
* Scripts: 283 / 381
* Outbound cookies: 18 / 74
* Net requests: 1,087 / 1,989

#### No blocker

* Domains: **380** / 381
* Hosts: 566 / 644
* Scripts: 490 / 592
* Outbound cookies: 245 / 315
* Net requests: 1,950 / 2,871

The figures show the number of requests **allowed**, thus lower numbers are better. 
The point is to show how many 3rd-party servers are hit on average after running 
the reference benchmark (three repeats in the current instance).

The less hits on 3rd-party servers, the better. All blockers were configured 
in such a way as to compare apples-vs-apples:

- **µBlock:** out-of-the-box settings -- no change.
- **Adblock Plus:** _"EasyList"_, _"EasyPrivacy"_, _"Malware Domains"_ checked. _"Acceptable ads"_ unchecked.
- **Ghostery:** _"Advertising"_, _"Analytics"_, _"Beacons"_, _"Privacy"_ checked. _"Widgets"_ not checked. _"GhostRank"_ unchecked. 
- **Adguard:** _"English"_, _"Spyware and tracking"_, _"Phishing and malware protection"_ checked. _"Social media"_ not checked. _"Acceptable ads"_ unchecked.
- **Disconnect:** out-of-the-box settings -- no change.

## About

µBlock is born out of [HTTP Switchboard](https://github.com/gorhill/httpswitchboard).
All the niceties of HTTPSB have been removed, and what is left is a straightforward
blocker which support EasyList and the likes, and also support host files. 
Cosmetic filters ("element hiding") are supported.

There is nothing more to it. But it does what popular blockers out there do, at a
fraction of CPU and memory usage for the same blocking power.

Free. Open source. No donations sought. For users by users.

## License

[GPLv3](https://github.com/gorhill/uBlock/blob/master/LICENSE.txt).
