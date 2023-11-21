## New

Differential update of filter lists, as a result of discussions at <https://github.com/AdguardTeam/FiltersCompiler/issues/192>. Resulting spec is [here](https://github.com/ameshkov/diffupdates).

![inkscape](https://github.com/gorhill/uBlock/assets/585534/3ee3567b-e24f-4d39-90e2-915b39a114fb)

The goal is to **NOT** be ranked among the "most popular projects" by bandwidth usage (as per [jsDelivr's public stats](https://www.jsdelivr.com/statistics)):

![jsDelivr stats](https://github.com/gorhill/uBlock/assets/585534/96c7e0fa-ffcc-4879-a01e-e340b4f0fa9e)

It is expected that differential updates will lower both requests and bandwidth usage.

To benefit the much shorter update period enabled by differential updates, you must let uBO auto-update the filter lists. Forcing a manual update will prevent differential updates until the next time a list auto-update.

## Fixes / changes

- [Enable path for native `has()` selector in Firefox](https://github.com/gorhill/uBlock/commit/c5724c1cce)
- [Allow scriptlets to be injected in `about:blank`](https://github.com/gorhill/uBlock/commit/3fd2588650)
- [Fix faulty `as` vararg in `set-constant` scriptlet](https://github.com/gorhill/uBlock/commit/c292a90b90)
- [Add support to redirect to `noop.json`](https://github.com/gorhill/uBlock/commit/bd8a91ed3a)
- [More improvements to the `google-ima` shim script](https://github.com/gorhill/uBlock/commit/c1d8f5908d) (by @kzar)
- [All exceptions filters are exempt from requiring a trusted source](https://github.com/gorhill/uBlock/commit/d2b8d990e6)
- [Add `trusted-set-session-storage-item` scriptlet](https://github.com/gorhill/uBlock/commit/f3d6a21e7a)
- [Allow the use of quotes in `set-cookie` scriptlet ](https://github.com/gorhill/uBlock/commit/7c562d0c5c)
- [Allow the use of quotes in `set-(local|session)-storage-item`](https://github.com/gorhill/uBlock/commit/decafc5cbf)
- [Add ability to trigger cookie removal on specific events](https://github.com/gorhill/uBlock/commit/ef311ddbec)
- [Ensure CSSTree does not hold a reference onto last parsed string](https://github.com/gorhill/uBlock/commit/1dba557c9a)
- [Lower minimum Expires value to 4h](https://github.com/gorhill/uBlock/commit/2360bc02f3)
- [Properly reset needle length in unserialized buffer](https://github.com/gorhill/uBlock/commit/8ed1ad9c9d)
- [Add additional flags to regional lists](https://github.com/gorhill/uBlock/commit/0962366524) (by @DandelionSprout)
- [Harden scriptlets which need to serialize function code into string](https://github.com/gorhill/uBlock/commit/7823d98070)
- [Reset `g` regexes before use in `rmnt`/`rpnt`  scriptlets](https://github.com/gorhill/uBlock/commit/cdc3f66a6b)
- [Apply response filtering according to mime type](https://github.com/gorhill/uBlock/commit/6417f54299)
- [Add t/f to set-cookie](https://github.com/gorhill/uBlock/commit/4ab1c36ac9) (by @ryanbr)
- [Have `urltransform=` use the same syntax as `replace=`](https://github.com/gorhill/uBlock/commit/d7c99b46e6)
- [Implement network filter option `replace=`](https://github.com/gorhill/uBlock/commit/7c3e060c01) (Firefox only because [filterResponseData](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/filterResponseData#browser_compatibility))
- [Prevent evaluating the SNFE until fully loaded](https://github.com/gorhill/uBlock/commit/89b272775a)
- [Add support for differential update of filter lists](https://github.com/gorhill/uBlock/commit/d05ff8ffeb)

----------

Older release notes go here.
