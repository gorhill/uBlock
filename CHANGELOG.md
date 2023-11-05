## New

Differential update of filter lists, as a result of discussions at <https://github.com/AdguardTeam/FiltersCompiler/issues/192>. Resulting spec is [here](https://github.com/ameshkov/diffupdates).

![inkscape](https://github.com/gorhill/uBlock/assets/585534/6d9fb4e2-8e33-4efe-9a65-854d125f045f)

The goal is to **NOT** be ranked among the "most popular projects" by bandwidth usage (as per [jsDelivr's public stats](https://www.jsdelivr.com/statistics)):

![jsDelivr stats](https://github.com/gorhill/uBlock/assets/585534/30a0522b-f9ff-4ff7-8902-6c78e0d61dd1)

It is expected that differential updates will lower both requests and bandwidth usage.

To benefit the much shorter update period enabled by differential updates, you must let uBO auto-update the filter lists. Forcing a manual update will prevent differential updates until the next time a list auto-update.

## Fixes / changes

- [Have `urltransform=` use the same syntax as `replace=`](https://github.com/gorhill/uBlock/commit/d7c99b46e6)
- [Implement network filter option `replace=`](https://github.com/gorhill/uBlock/commit/7c3e060c01) (Firefox only because [filterResponseData](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/filterResponseData#browser_compatibility))
- [Prevent evaluating the SNFE until fully loaded](https://github.com/gorhill/uBlock/commit/89b272775a)
- [Add support for differential update of filter lists](https://github.com/gorhill/uBlock/commit/d05ff8ffeb)

==========

Older release notes go here.
