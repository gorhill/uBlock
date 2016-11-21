<h1 align="center">
<sub>
<img  src="https://raw.githubusercontent.com/gorhill/uBlock/master/doc/img/icon38@2x.png"
      height="38"
      width="38">
</sub>
uBlock Origin <sup>Beta</sup> <br/>
<small>for Microsoft Edge</small>
</h1>
<p align="center">
<sup> <!-- Pronounciation -->
      pronounced <i>you-block origin</i> (<code>/ˈjuːˌblɒk/</code>) — <i>you</i> decide what enters your browser.
</sup>
</p>


**An efficient blocker add-on for Microsoft Edge. Fast, potent, and lean.**

## Note: This port of uBlock Origin to Microsoft Edge is in early development
While most of the code in this extension is shared with [upstream](https://github.com/gorhill/uBlock), the platform layer is not finished and there is no guarantee of stability, performance, or complete feature parity until the extension is published on the Microsoft Store.

* [Issues](#issues)
* [Performance and Efficiency](#performance)
* [Installation](#installation)
* [Release History](#release-history)
* [About](#about)
* [License](#license)

## Issues

Known issues, bugs and missing features are listed on the [Issues page](https://github.com/nikrolls/uBlock-Edge/issues) for this repo. Features documented in the upstream extension and not listed on the Issues page are assumed to be working. If you run into an issue not listed, please [create a new issue](https://github.com/nikrolls/uBlock-Edge/issues) and complete the provided template.

## Performance and Efficiency

Early tests of performance of this extension on the Microsoft Edge browser are positive, though more are required to share useful data here. This fork shares the majority of its code with the Chrome and Firefox versions which have been [proven to be faster than AdBlock Pro](https://github.com/gorhill/uBlock#performance).

## Installation

While in pre-release, you will need to side-load the extension. You need to have the Windows 10 Anniversary Update to use extensions in Edge.

1. Download the latest release from [the Releases page](https://github.com/nikrolls/uBlock-Edge/releases)
2. Extract the zip file somewhere safe (it will need to remain there as long as you use the extension)
3. Browse to `about:flags` in Edge and turn on the option `Enable extension developer features`
4. Restart your browser
5. Go to Extensions in the browser menu and click `Load extension`
6. Select the `uBlock0.edge` folder you extracted earlier

Edge disables side-loaded extensions whenever you restart the browser. However after a few seconds you will get a prompt to re-enable them with a single click.

#### Note

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

[GPLv3](LICENSE.txt).