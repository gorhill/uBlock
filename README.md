[![Build](https://travis-ci.org/el1t/uBlock-Safari.svg?branch=safari)](https://travis-ci.org/el1t/uBlock-Safari)
[![License](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://github.com/gorhill/uBlock/blob/master/LICENSE.txt)

***

=======
##### BEWARE! uBlock Origin is COMPLETELY UNRELATED to the web site ublock.org

The donations sought by the [individual](https://github.com/chrisaljoudi/) behind `ublock.org` (_"to keeps uBlock development possible"_, [a misrepresentation](https://en.wikipedia.org/wiki/UBlock_Origin#uBlock_.28ublock.org.29)) are _not_ benefiting any of those who contributed most to create uBlock Origin ([developers](https://github.com/gorhill/uBlock/graphs/contributors), [translators](https://crowdin.com/project/ublock), and all those who put efforts in opening detailed issues). For the differences between uBlock Origin and uBlock, see the unbiased [Wikipedia article](https://en.wikipedia.org/wiki/UBlock_Origin).

***

uBlock Origin is **NOT** an "ad blocker": [it is a wide-spectrum blocker](https://github.com/gorhill/uBlock/wiki/Blocking-mode) -- which happens to be able to function as a mere "ad blocker". The default behavior of uBlock Origin when newly installed is to block ads, trackers and malware sites -- through [_EasyList_](https://easylist.github.io/#easylist), [_EasyPrivacy_](https://easylist.github.io/#easyprivacy), [_Peter Lowe’s ad/tracking/malware servers_](https://pgl.yoyo.org/adservers/policy.php), various lists of [malware](http://www.malwaredomainlist.com/) [sites](http://www.malwaredomains.com/), and uBlock Origin's [own filter lists](https://github.com/uBlockOrigin/uAssets/tree/master/filters).

*** 

<h1 align="center">
<sub>
<img  src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/icon38@2x.png"
      height="38"
      width="38">
</sub>
uBlock Origin<br>
<small>for Safari</small>
</h1>
<p align="center">
<sup> <!-- Pronounciation -->
      pronounced <i>you-block origin</i> (<code>/ˈjuːˌblɒk/</code>) — <i>you</i> decide what enters your browser.
</sup>
</p>


**An efficient blocker add-on for various browsers. Fast, potent, and lean.**

## Regarding this Safari port

The majority of this code is shared with [upstream](https://github.com/gorhill/uBlock). Platform specific portions are under development.
Much of the platform shim from the original uBlock Safari version is still being used.

* [Installation](#installation)
* [Building](#building)
* [Release History](#release-history)
* [Further Documentation](#further-documentation)
* [About](#about)
* [License](#license)

## Installation

Until relatively stable, this extension must be installed [manually](https://github.com/el1t/uBlock-Safari/tree/safari/dist#install).
=======
Feel free to read [about the extension's required permissions](https://github.com/gorhill/uBlock/wiki/About-the-required-permissions).

#### Chromium

You can install the latest version [manually](https://github.com/gorhill/uBlock/tree/master/dist#install), from the [Chrome Store](https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm), or from the [Opera store](https://addons.opera.com/extensions/details/ublock/).

It is expected that uBlock Origin is compatible with any Chromium-based browsers.

Compatible with Safari 10, untested on older versions.

#### Note

To benefit from uBlock Origin's higher efficiency, it's advised that you don't use other inefficient blockers at the same time (such as AdBlock or Adblock Plus). uBlock₀ will do [as well or better](#blocking) than most popular ad blockers.

## Building

### Development

To build and load an unpacked extension for development:

1. **Clone** `uBlock-Safari` and [`uAssets`](https://github.com/uBlockOrigin/uAssets) into the same parent directory
1. **Build** by running `./tools/make-safari.sh` in `uBlock-Safari`'s directory
1. **Install** the unpacked extension through Safari's Extension Builder
    1. In Safari, load the Extension Builder (Develop > Show Extension Builder)
    1. Click the `+` button in the bottom left corner and "Add Extension"
    1. Select `dist/build/uBlock0.safariextension`
    1. Click install and enter your password
    1. You will have to reinstall from this panel every time you restart Safari

> If you don't see a Develop menu in Safari, you can run
> `defaults write com.apple.Safari IncludeDevelopMenu -bool true`
> or go to `Preferences > Advanced > Show Develop menu in menu bar`.

Example clone and build:

```bash
# Clone
git clone https://github.com/uBlockOrigin/uAssets.git
git clone https://github.com/el1t/uBlock-Safari.git
# Build
cd uBlock-Safari
./tools/make-safari.sh
echo 'Output is in dist/build/uBlock0.safariextension'
```

### Release

To build and sign for release (certificates required):

1. **Clone** `uBlock-Safari` and [`uAssets`](https://github.com/uBlockOrigin/uAssets) into the same parent directory
1. **Build** by running `./tools/make-safari.sh all` in `uBlock-Safari`'s directory
    1. Requires `xar-mackyle`, which will be built if not found

## Release History

See the [releases pages](https://github.com/el1t/uBlock-Safari/releases) for a history of releases and highlights for each release.

## Further Documentation

Visit the upstream [uBlock Origin wiki](https://github.com/gorhill/uBlock/wiki) for further documentation.

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
