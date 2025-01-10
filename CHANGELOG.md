- [Add `decline` value to `set-cookie` scriptlet](https://github.com/gorhill/uBlock/commit/4b12247da1)
- [Improve `abort-on-stack-trace` scriptlet](https://github.com/gorhill/uBlock/commit/b617926c1c)
- [Improve `href-sanitizer` scriptlet](https://github.com/gorhill/uBlock/commit/551c6bc6eb)

----------

# 1.62.0

## Fixes / changes

- [Fix deserialization of ArrayBuffer shared by multiple TypedArrays](https://github.com/gorhill/uBlock/commit/c92a518218)
- [Improve `trusted-suppress-native-method` scriptlet](https://github.com/gorhill/uBlock/commit/cb6c11ab6f)
- [Improve `urlskip=` filter option](https://github.com/gorhill/uBlock/commit/a7aa755f18)
- [Improve `parse-properties-to-match` scriptlet helper](https://github.com/gorhill/uBlock/commit/7494eaf621)
- [Improve `href-sanitizer` scriptlet](https://github.com/gorhill/uBlock/commit/9bf8d53ebe)
- [Improve quote usage in filter options and scriptlets](https://github.com/gorhill/uBlock/commit/8ba71f09d7)
- [Improve `trusted-suppress-native-method` scriptlet](https://github.com/gorhill/uBlock/commit/7ed3470844)
- [Improve `trusted-replace-argument` scriptlet](https://github.com/gorhill/uBlock/commit/3417fe3d5d)
- [Block media elements unconditionally when max size is set to 0](https://github.com/gorhill/uBlock/commit/36db7f8327)
    - Regression from <https://github.com/gorhill/uBlock/commit/73ce4e6bcf>
- [Visually separate scriptlet parameters in active line](https://github.com/gorhill/uBlock/commit/076e9fa73e)
- [Mitigate potentially delayed execution of scriptlets in Firefox](https://github.com/gorhill/uBlock/commit/b1a00145bd)
- [Improve `prevent-setTimeout`/`prevent-setInterval` scriptlets](https://github.com/gorhill/uBlock/commit/3b7fa79a68)
- [Improve `trusted-replace-argument` scriptlet](https://github.com/gorhill/uBlock/commit/adced29b5b)
- [Add `-safebase64` directive to `urlskip=` option](https://github.com/gorhill/uBlock/commit/bcc058eba7)
- [Improve `urlskip=` filter option](https://github.com/gorhill/uBlock/commit/77ed83ff2f)
- [Improve `spoof-css` scriptlet](https://github.com/gorhill/uBlock/commit/5f5e3d730f)
- [Improve `trusted-set-attr` scriptlet](https://github.com/gorhill/uBlock/commit/c8174d6032)
- [Add support for EasyList `{ remove: true }` cosmetic filter syntax](https://github.com/gorhill/uBlock/commit/ff5fc61753)
- [Keep moving related scriptlets into separate files](https://github.com/gorhill/uBlock/commit/e5a088738d)
- [Improve `prevent-xhr` scriptlet](https://github.com/gorhill/uBlock/commit/ce4908b341)
- [Improve `trusted-suppress-native-method` scriptlet](https://github.com/gorhill/uBlock/commit/41616df866)
- [Improve `set-cookie` scriptlet](https://github.com/gorhill/uBlock/commit/e613282698)

----------

# 1.61.2

## Fixes / changes

- [Better handle unexpected conditions when deserializing](https://github.com/gorhill/uBlock/commit/4c299bfca9)
- [Fix potential infinite async loop](https://github.com/gorhill/uBlock/commit/335d947c10) (issue found by @Rob--W)

----------

# 1.61.0

## Fixes / changes

- [Improve `prevent-refresh` scriptlet](https://github.com/gorhill/uBlock/commit/8884f259c1)
- [Improve `googlesyndication_adsbygoogle.js` scriptlet](https://github.com/gorhill/uBlock/commit/f645e8f0d2)
- [Offer ability to skip redirects in strict-blocked page](https://github.com/gorhill/uBlock/commit/20b54185fa)
- [Add `-blocked` directive to `urlskip=` option](https://github.com/gorhill/uBlock/commit/d04dc4c767)
- [Add `trusted-set-attr` scriptlet](https://github.com/gorhill/uBlock/commit/11ca4a3923)
- [Remove `64:ff9b:` as private network block](https://github.com/gorhill/uBlock/commit/2621c908c3)
- [Ensure `urlskip=` redirects only to `https:`](https://github.com/gorhill/uBlock/commit/32f27c5131)
- [Add support to `urlskip=` media resources](https://github.com/gorhill/uBlock/commit/ce9fc5dc14)
- [Add `-uricomponent` to `urlskip=` option](https://github.com/gorhill/uBlock/commit/01eebffc1f)
- [Add `forbidden`/`forever` as safe cookie values](https://github.com/gorhill/uBlock/commit/4d982d9972) (by @ryanbr)
- [Add regex extraction transformation step to `urlskip=` option](https://github.com/gorhill/uBlock/commit/c86ed5287b)
- [Improve `prevent-window-open` scriptlet](https://github.com/gorhill/uBlock/commit/85877b12ed)
- [Add support to parse Adguard's `[$domain=/.../]` regex-based modifier](https://github.com/gorhill/uBlock/commit/58bfe4c846)
- [Validate result type of XPath expressions](https://github.com/gorhill/uBlock/commit/c746633693)
- [Fix npm test suite](https://github.com/gorhill/uBlock/commit/818cb2d801)
- [Add ability to lookup parameter name in `urlskip=`](https://github.com/gorhill/uBlock/commit/64b2086ba4)
- [Mind that BroadcastChannel contructor can throw in Firefox](https://github.com/gorhill/uBlock/commit/6d2b3375f8)
- [Add `trusted-override-element-method` scriptlet](https://github.com/gorhill/uBlock/commit/95b0ce5e3a)
- [Add `trusted-prevent-dom-bypass` scriptlet](https://github.com/gorhill/uBlock/commit/1abc864742)
- [Improve `prevent-xhr` scriptlet; add `trusted-prevent-xhr` scriptlet](https://github.com/gorhill/uBlock/commit/fe49ced2ac)
- [Skip dns resolution when requests are proxied through http](https://github.com/gorhill/uBlock/commit/4305bfbdb1)
- [Blocking large media elements also prevents autoplay, regardless of size](https://github.com/gorhill/uBlock/commit/73ce4e6bcf)
- [Do not discard `!#else` block for unknown preprocessor tokens](https://github.com/gorhill/uBlock/commit/6cac645830)
- [Add ability to decode base64 in `urlskip=`](https://github.com/gorhill/uBlock/commit/e81e70937f)
- [Fix images not properly downloading on click](https://github.com/gorhill/uBlock/commit/aec0bd39e3)

----------

# 1.60.0

## Fixes / changes

- [Add advanced setting `dnsResolveEnabled`](https://github.com/gorhill/uBlock/commit/760b2ffce6)
- [Fix contextual menu quirks](https://github.com/gorhill/uBlock/commit/0a6dc47a72)
- [Fix exception thrown in `spoof-css` in Firefox](https://github.com/gorhill/uBlock/commit/11c3a16036)
- [Throttle down repeated scriptlet logging information](https://github.com/gorhill/uBlock/commit/e8f6f3ddff)
- [Improve scriptlet helper `proxy-apply`](https://github.com/gorhill/uBlock/commit/547fae4842)
- [Add an entry in _Report_ page for badware/phishing category](https://github.com/gorhill/uBlock/commit/e18a3707c7)
- [New static network filter option `urlskip=`](https://github.com/gorhill/uBlock/commit/266ec4894b)
- [Rewrite cname uncloaking code to account for new `ipaddress=` option](https://github.com/gorhill/uBlock/commit/6acf97bf51)
- [Avoid using dns.resolve() for proxied DNS resolution](https://github.com/gorhill/uBlock/commit/d5f14ffa32)
- [Add support for `lan`/`loopback` values to `ipaddress=` option](https://github.com/gorhill/uBlock/commit/030d7334e4)
- [New static network filter option `ipaddress=`](https://github.com/gorhill/uBlock/commit/c6dedd253f)
- [Add ability to quote static network option values](https://github.com/gorhill/uBlock/commit/20115697e5)
- [Improve `prevent-fetch` scriptlet](https://github.com/gorhill/uBlock/commit/e8202af11d)
- [Apply CSP/PP injections to `object` resources](https://github.com/gorhill/uBlock/commit/89f02098fd)
- [Improve `xml-prune` scriptlet](https://github.com/gorhill/uBlock/commit/c8307f58a3)
- [Add support for `application/dash+xml` in `replace=` option](https://github.com/gorhill/uBlock/commit/91125d29cf)
- [Add ability to directly evaluate static network filtering engine](https://github.com/gorhill/uBlock/commit/b7ed3b45ed)
- [Fix `prevent-window-open` for when logger is open](https://github.com/gorhill/uBlock/commit/f552f655cb)
- [Improve `prevent-window-open` scriptlet](https://github.com/gorhill/uBlock/commit/7f11d6216e)
- [Improve `validate-constant` scriptlet helper](https://github.com/gorhill/uBlock/commit/ae5dc6299e)
- [Improve `trusted-replace-outbound-text` scriptlet](https://github.com/gorhill/uBlock/commit/0dcb985601)
- [Improve `prevent-xhr` scriptlet](https://github.com/gorhill/uBlock/commit/3a249f395c)
- [Add noop resources for redirect purpose](https://github.com/gorhill/uBlock/commit/59a9a43a83)
- [Use helper function to lookup safe cookie values](https://github.com/gorhill/uBlock/commit/79e10323ad)
- [Add `checked`/`unchecked` to `set-cookie`](https://github.com/gorhill/uBlock/commit/3e2171f550) (by @ryanbr)
- [Add `allowed`/`denied` to `set-local-storage-item`](https://github.com/gorhill/uBlock/commit/41c2258f91) (by @ryanbr)
- [Fix plain exceptions not overriding block filters using `header=` option](https://github.com/gorhill/uBlock/commit/1cb660b94e)
- [Improve various scriptlets](https://github.com/gorhill/uBlock/commit/56dfdd2568)
- [Improve `href-sanitizer` scriptlet](https://github.com/gorhill/uBlock/commit/db3dc69bcc)
- [Improve `remove-attr.js` scriptlet](https://github.com/gorhill/uBlock/commit/fb037e97d0)
- [Improve `trusted-replace-node-text` scriptlet](https://github.com/gorhill/uBlock/commit/4f0d1301ab)

----------

# 1.59.0

## Fixes / changes

- [Improve `href-sanitizer` scriptlet](https://github.com/gorhill/uBlock/commit/84be9cde6d)
- [Improve `trusted-replace-node-text` scriptlet](https://github.com/gorhill/uBlock/commit/8afd9e233d)
- [Improve `set-constant` scriptlet](https://github.com/gorhill/uBlock/commit/77feb25c4d)
- [Improve `prevent-fetch` scriptlet](https://github.com/gorhill/uBlock/commit/e785b99338)
- [Improve `href-sanitizer` scriptlet](https://github.com/gorhill/uBlock/commit/66e3a1ad47)
- [Fix CSP/PP header injection in non-document resources](https://github.com/gorhill/uBlock/commit/c90f4933df)
- [Add `trusted-suppress-native-method` scriptlet](https://github.com/gorhill/uBlock/commit/97d11c03c2)
- [Add support for `$currentISODate$` in `trusted-set-cookie` scriptlet](https://github.com/gorhill/uBlock/commit/a3576ea651)
- [Add `essential` and `nonessential` to set-cookie](https://github.com/gorhill/uBlock/commit/37d31a82d8) (by @ryanbr)
- [Fix distance calculation in picker](https://github.com/gorhill/uBlock/commit/9569969b55)
- [Fix bad serialization of Date objects](https://github.com/gorhill/uBlock/commit/c154aaa69c)
- [Fix race condition when loading redirect/scriptlet resources](https://github.com/gorhill/uBlock/commit/896737d098)
- [Improve logging in `prevent-addEventListener` scriptlet](https://github.com/gorhill/uBlock/commit/8eb3b19c69)
- [Add `:matches-prop()` pseudo CSS operator](https://github.com/gorhill/uBlock/commit/aca7674bac)
- [Improve `set-cookie` scriptlet](https://github.com/gorhill/uBlock/commit/b4d8750f44)
- [Improve `trusted-replace-node-text` scriptlet](https://github.com/gorhill/uBlock/commit/cb0f65e035)
- [Improve `trusted-replace-(fetch|xhr)-response` scriptlets](https://github.com/gorhill/uBlock/commit/9072772f61)
- [Improve `prevent-addEventListener` scriptlet](https://github.com/gorhill/uBlock/commit/91ee5bdeae)
- [Add `isodate` as available placeholder for auto-comment](https://github.com/gorhill/uBlock/commit/d5208ee5dd)
- [Improve `trusted-replace-outbound-text` scriptlet](https://github.com/gorhill/uBlock/commit/fa6740a059)
- [Classify generic cosmetic filters with comma as highly generic](https://github.com/gorhill/uBlock/commit/8f81833efc)
- [Raise max buffer size for response body filtering](https://github.com/gorhill/uBlock/commit/82a3992896)
- [Trim end of class tokens in generic cosmetic filtering's surveyor](https://github.com/gorhill/uBlock/commit/8ea1bac80b)
- [Improve `trusted-set-cookie` scriptlet](https://github.com/gorhill/uBlock/commit/0e1e4b82c5)

----------

# 1.58.0

## Fixes / changes

- [Fallback to `requestAnimationFrame` when `requestIdleCallback` is not available](https://github.com/gorhill/uBlock/commit/59ffc96e89)
- [Improve `trusted-click-element` scriptlet](https://github.com/gorhill/uBlock/commit/ee67cd6284)
- [Replace EasyDutch with AdGuard Dutch](https://github.com/gorhill/uBlock/commit/ca7d2ad61d)
- [Add checksum validation when loading trie buffers in selfie](https://github.com/gorhill/uBlock/commit/0e6d607484)
- [Catch exceptions in API calls for the sake of old Chromium versions](https://github.com/gorhill/uBlock/commit/bb479b0a66)
- [Add `accept`/`reject` to `set-local-storage-item`](https://github.com/gorhill/uBlock/commit/363ad6795c) (by @ryanbr)
- [Use raw string for regex patterns in python scripts](https://github.com/gorhill/uBlock/commit/923452b788)
- [Improve `noeval-if` scriptlet](https://github.com/gorhill/uBlock/commit/4d8ee35ef7)
- [Improve `trusted-set-local-storage-item` scriptlet](https://github.com/gorhill/uBlock/commit/2ccc3135c1)
- [Fix potential corruption when reading serialized data](https://github.com/gorhill/uBlock/commit/c098eb8625)
- [Improve `remove-[attr|class]` scriptlets](https://github.com/gorhill/uBlock/commit/91dfcbef2a)
- [Improve dashboard layout at high zoom factor](https://github.com/gorhill/uBlock/commit/6152f5269e)
- [Add a console pane to the logger](https://github.com/gorhill/uBlock/commit/3b4f02db21)
- [Improve `spoof-css` scriptlet](https://github.com/gorhill/uBlock/commit/277e90a4a7)
- [Fix bad date computation in auto-comment feature](https://github.com/gorhill/uBlock/commit/a5f6c35bb0)
- [Fix regression breaking import of `file://` lists](https://github.com/gorhill/uBlock/commit/c223a8cd39)
- [Add `trusted-replace-outbound-text` scriptlet](https://github.com/gorhill/uBlock/commit/21e1ee30ee)
- [Improve `[trusted-]set-cookie` scriptlets](https://github.com/gorhill/uBlock/commit/49ff7cffb1)

----------

# 1.57.2

## Fixes / changes

- [Fix stray lists in redesigned cache storage](https://github.com/gorhill/uBlock/commit/defd68ef7d)

----------

# 1.57.0

## Fixes / changes

- [Do not block large media resources when loaded as top-level document](https://github.com/gorhill/uBlock/commit/3919a16bb8)
- [Properly manage cache storage regarding managed user filters](https://github.com/gorhill/uBlock/commit/90ab1a76ab)
- [Improve `[trusted-]set-cookie` scriptlets](https://github.com/gorhill/uBlock/commit/11a48561e0)
- [Fixed Belgian and Nepali flags for Windows Chromium users](https://github.com/gorhill/uBlock/commit/499c80bd8a) (by @DandelionSprout)
- [Mind that `tabs.sendMessage` can throw](https://github.com/gorhill/uBlock/commit/3f7374c1f1)
- [Improve `set-cookie` scriptlet](https://github.com/gorhill/uBlock/commit/9146134874)
- [Append wildcard character only when filter starts & ends with `/`](https://github.com/gorhill/uBlock/commit/1cb190e102)
- [Fix failure to create popup logger window sometimes](https://github.com/gorhill/uBlock/commit/c8762945d9)
- [Improve json-prune-related scriptlets](https://github.com/gorhill/uBlock/commit/e7a0f8c781)
- [Support maximizing editor to viewport size](https://github.com/gorhill/uBlock/commit/664dd95700)
- [Add advanced setting to force popup panel orientation](https://github.com/gorhill/uBlock/commit/0d77ccded7)
- [Add checkboxes to "My filters" pane](https://github.com/gorhill/uBlock/commit/46ea5519c1)
- [Assume UTF-8 when no encoding can be looked up](https://github.com/gorhill/uBlock/commit/63acdcbdeb)
- [Fix issue with "My filters" pane on mobile](https://github.com/gorhill/uBlock/commit/24d94e559d)
- [Support aborting "Pick" mode in element picker](https://github.com/gorhill/uBlock/commit/a557f62112)
- [Remove sections with no lists in "Filter lists" pane](https://github.com/gorhill/uBlock/commit/0f4e50db07)
- [Add "Social widgets", "Cookie notices" sections in "Filter lists" pane](https://github.com/gorhill/uBlock/commit/21a76e32a1)
- [No longer disable generic cosmetic filters by default on mobile](https://github.com/gorhill/uBlock/commit/7a768e7b1a)
- [Improve `spoof-css` scriptlet](https://github.com/gorhill/uBlock/commit/603239970d)
- [Make asset updater compatible with non-persistent background page](https://github.com/gorhill/uBlock/commit/96704f2fda)
- [Move dragbar to the top of element picker dialog](https://github.com/gorhill/uBlock/commit/953c978d59)
    - [Move "Quit" button to top bar in element picker](https://github.com/gorhill/uBlock/commit/6266c4718d)
- [Add advanced setting `requestStatsDisabled`](https://github.com/gorhill/uBlock/commit/e02ea69c86)
- [First lookup matching stock lists when importing URLs](https://github.com/gorhill/uBlock/commit/2b16a10b82)
- [Reset filter lists in worker when creating filters via "Block element"](https://github.com/gorhill/uBlock/commit/b0067b79d5)
- [Remove trusted-source requirement when using `badfilter`](https://github.com/gorhill/uBlock/commit/3c299b8632)
- [Redesign cache storage](https://github.com/gorhill/uBlock/commit/086766a924)
- [Don't match network filter-derived regexes against non-network URIs](https://github.com/gorhill/uBlock/commit/2262a129ec)
- [Remove obsolete trusted directives](https://github.com/gorhill/uBlock/commit/439a059cca)
- [Support logging details of calls to `json-prune-fetch-response`](https://github.com/gorhill/uBlock/commit/e527a8f9af)
- [Escape special whitespace characters in attribute values](https://github.com/gorhill/uBlock/commit/be3e366019)

----------

# 1.56.0

## Fixes / changes

- [Mind that multiple `uritransform` may apply to a single request](https://github.com/gorhill/uBlock/commit/2a5a444482)
- [Fix incorrect built-in filtering expression in logger](https://github.com/gorhill/uBlock/commit/9bff0c2f94)
- [Fix improper invalidation of valid `uritransform` exception filters](https://github.com/gorhill/uBlock/commit/21ec5a277c)
- [Improve `prevent-addEventListener` scriptlet](https://github.com/gorhill/uBlock/commit/b22b3d729b)
- [Fix Chartbeat flicker control `div`'s](https://github.com/gorhill/uBlock/commit/397d6d47b9) (by @ryanbr)
- [Fix potential exfiltration of browsing history by a rogue list author through `permissions=`](https://github.com/gorhill/uBlock/commit/7b138b58c6)
- [Ignore event handler-related attributes in `set-attr` scriptlet](https://github.com/gorhill/uBlock/commit/3037ae5f04) (suggested by @distinctmondaylilac)
- [Fix potential exfiltration of browsing history by a rogue list author through `csp=`](https://github.com/gorhill/uBlock/commit/db5656f607) (reported by @distinctmondaylilac)
- [Output scriptlet logging information to the logger](https://github.com/gorhill/uBlock/commit/869a653fdf)
- [Fix decompiling of scriptlet parameters](https://github.com/gorhill/uBlock/commit/49dd68ef3d)
- [Add support for `extraMatch` in `trusted-click-element` scriptlet](https://github.com/gorhill/uBlock/commit/45e62c939f)
- [Remove minimum height constraint from "My filters" pane](https://github.com/gorhill/uBlock/commit/f624c835c2)
- [Unregister all scriptlets when disabling uBO on a specific site](https://github.com/gorhill/uBlock/commit/13dcd844a7)
- [Allow `uritransform` to process the hash part of a URL](https://github.com/gorhill/uBlock/commit/b19094339f)
- [Remember presentation state of "My rules" pane](https://github.com/gorhill/uBlock/commit/3d1b100646)
- [Fix improperly assembled `!#include` sublists](https://github.com/gorhill/uBlock/commit/0e00010b91)
- [Mark procedural filters with pseudo-elements selector as invalid](https://github.com/gorhill/uBlock/commit/757b8be9cd)
- [Prevent access to picker when "My filters" is not enabled](https://github.com/gorhill/uBlock/commit/bc641fc024)
- [Provide visual feedback when applying changes in "Filter lists" pane](https://github.com/gorhill/uBlock/commit/c4bb8a0f64)
- [Empty query parameters must still use `=`](https://github.com/gorhill/uBlock/commit/1cac61a9a4)
- [Add support to toggle no-scripting switch with keyboard shortcut](https://github.com/gorhill/uBlock/commit/936444883f)
- [Do not exceed rate-limited calls to `handlerBehaviorChanged()`](https://github.com/gorhill/uBlock/commit/63fe18a761)
- [Shield some code paths against potentially tampered global properties](https://github.com/gorhill/uBlock/commit/534d877e95) (in scriptlets)
- [Do not prevent applying changes when lists are updating](https://github.com/gorhill/uBlock/commit/f6b726136c)
- [Add `elements` vararg to `prevent-addEventListener` scriptlet](https://github.com/gorhill/uBlock/commit/060f9d68fc)
- [Do not use tab character as field separator](https://github.com/gorhill/uBlock/commit/a9eb9630cf) (in logger)
- [Prevent `:others()` from hiding `html` tag](https://github.com/gorhill/uBlock/commit/9a104bcbd2)

----------

# 1.55.0

## Fixes / changes

- [Discard repeating adjacent entries in the logger](https://github.com/gorhill/uBlock/commit/55e4cee6e8)
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
