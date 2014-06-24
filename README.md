# µBlock for Chromium

See [Change log](https://github.com/gorhill/uBlock/wiki/Change-log) for latest changes.

An efficient blocker for Chromium-based browsers. Fast and lean.

![screenshot](https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/ss-chromium-2.png)

Some articles about the origin of the source code behind µBlock:

- [Net request filtering efficiency: HTTP Switchboard vs. Adblock Plus](https://github.com/gorhill/httpswitchboard/wiki/Net-request-filtering-efficiency:-HTTP-Switchboard-vs.-Adblock-Plus)
- [Adblock Plus memory consumption](https://github.com/gorhill/httpswitchboard/wiki/Adblock-Plus-memory-consumption)

## Installation

From the [Chrome store](https://chrome.google.com/webstore/detail/µblock/cjpalhdlnbpafiamejdnhcphjbkeiagm), 
or [manually](/gorhill/uBlock/tree/master/dist).

To benefit from the higher efficiency, it is of course not advised to use an 
inefficient blocker at the same time. µBlock will do as well or better than the 
popular blockers out there.

## About

µBlock is born out of [HTTP Switchboard](https://github.com/gorhill/httpswitchboard).
All the niceties of HTTPSB have been removed, and what is left is a straightforward
blocker which support EasyList and the likes, and also support host files. 
Cosmetic filters ("element hiding") are supported.

There is nothing more to it. But it does what popular blockers out there do, at a
fraction of CPU and memory usage for the same blocking power.

Free. Open source. No donations sought. For users by users.

## License

<a href="https://github.com/gorhill/httpswitchboard/blob/master/LICENSE.txt">GPLv3</a>.
