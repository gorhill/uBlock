## Fixes / changes

- [Mind drop events in filter expression field of logger](https://github.com/gorhill/uBlock/commit/c8b7d1a526)
- [Improve `xml-prune` scriptlet](https://github.com/gorhill/uBlock/commit/d7063a052f)
- [Fix message entries overflowing in logger](https://github.com/gorhill/uBlock/commit/49c8310e22)
- [Add support for `application/x-javascript` in `replace=` option](https://github.com/gorhill/uBlock/commit/abeadf18eb)
- [Extend support for differential updates to imported lists](https://github.com/gorhill/uBlock/commit/443c1f81e1)
- [Add detection of mismatched `!#if`-`!#endif` in linter](https://github.com/gorhill/uBlock/commit/9f4b31a96f)
- [Support links to update lists which are differential update-friendly](https://github.com/gorhill/uBlock/commit/5e3f9695b4)
- [Remove "Purge all caches" button from "Filter lists" pane](https://github.com/gorhill/uBlock/commit/bd7ce41224)
- [Add support for `all` list token in updater-link feature](https://github.com/gorhill/uBlock/commit/14926913f7)
- [Fix logging of broad exception filter `#@#+js()`](https://github.com/gorhill/uBlock/commit/4305ea9c0c)
- [Improve `no-xhr-if` scriptlet](https://github.com/gorhill/uBlock/commit/d01ad24291)
- [Ensure cache storage backend is selected before access](https://github.com/gorhill/uBlock/commit/bfa28b960e)
- [Fix popup panel rendering when embedded in logger](https://github.com/gorhill/uBlock/commit/4183ce477a)
- [Add visual hint in support information re. differential update](https://github.com/gorhill/uBlock/commit/7e44db763e)
- [Remove obsolete web accessible resources](https://github.com/gorhill/uBlock/commit/310bfec6a1)
- [Rename `urltransform` to `uritransform`](https://github.com/gorhill/uBlock/commit/cdc5e89f52)
- [Vertically expand/collapse in steps in dom inspector](https://github.com/gorhill/uBlock/commit/885bc3875b)
- [Reset the DOM inspector when URL in top context changes](https://github.com/gorhill/uBlock/commit/c744c87607)
- [Support shadow-piercing combinator `>>>` in `trusted-click-element`](https://github.com/gorhill/uBlock/commit/941077a25c)
- [Isolate DOM inspector layers from page context](https://github.com/gorhill/uBlock/commit/ee83a4304a)
- [Refactoring: Replace DOM events with broadcast channels](https://github.com/gorhill/uBlock/commit/67fb969572)
- [Support non-default sticky lists](https://github.com/gorhill/uBlock/commit/ea7d411bc2)
- [Add enableLazyLoad function](https://github.com/gorhill/uBlock/commit/a8cf08325d) (by @spazmodius )
- [Change frequency of save-to-storage blocking stats](https://github.com/gorhill/uBlock/commit/5a338b7210)
- [Improve `prevent-fetch` scriptlet](https://github.com/gorhill/uBlock/commit/6aeab2adbc)
- [Catch cases of `! Expires:` field with no value](https://github.com/gorhill/uBlock/commit/9ce958432d)

----------

# 1.54.0

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
