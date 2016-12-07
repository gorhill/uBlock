[![License](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://github.com/gorhill/uBlock/blob/master/LICENSE.txt)

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

Compatible with Safari 10, untested on older versions.

#### Note

To benefit from uBlock Origin's higher efficiency, it's advised that you don't use other inefficient blockers at the same time (such as AdBlock or Adblock Plus). uBlock₀ will do [as well or better](#blocking) than most popular ad blockers.

## Building

To build and load an unpacked extension for development:

1. **Clone** `uBlock-Safari` and [`uAssets`](https://github.com/uBlockOrigin/uAssets) into the same parent directory
1. **Build** by running `./tools/make-safari.sh` in `uBlock-Safari`'s directory
1. **Install** the unpacked extension through Safari's Extension Builder
    1. In Safari, load the Extension Builder (Develop > Show Extension Builder)
    1. Click the `+` button in the bottom left corner and "Add Extension"
    1. Select `dist/build/uBlock.safariextension`
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
echo 'Output is in dist/build/uBlock.safariextension'
```

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
