# µBlock for Chromium

See [Change log](https://github.com/gorhill/uBlock/wiki/Change-log) for latest changes.

An efficient blocker for Chromium-based browsers. Fast and lean.

![screenshot](https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/ss-chromium-2.png)

Some articles about the origin of the source code behind µBlock:

- [Net request filtering efficiency: HTTP Switchboard vs. Adblock Plus](https://github.com/gorhill/httpswitchboard/wiki/Net-request-filtering-efficiency:-HTTP-Switchboard-vs.-Adblock-Plus)
- [Adblock Plus memory consumption](https://github.com/gorhill/httpswitchboard/wiki/Adblock-Plus-memory-consumption)

Forums:

- [On Reddit](http://www.reddit.com/r/chrome/comments/28xt2j/%C2%B5block_a_fast_and_lean_blocker_for_chromiumbased/)

## Installation

From the [Chrome store](https://chrome.google.com/webstore/detail/µblock/cjpalhdlnbpafiamejdnhcphjbkeiagm), 
or [manually](https://github.com/gorhill/uBlock/tree/master/dist).

To benefit from the higher efficiency, it is of course not advised to use an 
inefficient blocker at the same time. µBlock will do as well or better than the 
popular blockers out there.

## Benchmark

I ran my [reference benchmark](https://github.com/gorhill/httpswitchboard/wiki/Comparative-benchmarks-against-widely-used-blockers:-Top-15-Most-Popular-News-Websites) to compare against three popular blockers.

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

The figures show the number of requests **allowed**, thus lower numbers are better. The point is to show how many 3rd-party servers are hit on average after running the reference benchmark (three repeats in the current instance).

The less hits on 3rd-party servers, the better. All blockers where configured in such a way as to compare apples-vs-apples.

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
