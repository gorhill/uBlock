## Description

**uBO Lite** (uBOL), an efficient [MV3 API-based](https://developer.chrome.com/docs/extensions/mv3/intro/) content blocker.

uBOL is entirely declarative, meaning there is no need for a permanent uBOL process for the filtering to occur, and CSS/JS injection-based content filtering is [performed reliably](https://developer.chrome.com/docs/extensions/reference/scripting/#method-registerContentScripts) by the browser itself rather than by the extension. This means that uBOL itself does not consume CPU/memory resources while content blocking is ongoing -- uBOL's service worker process is required _only_ when you interact with the popup panel or the option pages.

The default ruleset corresponds to at least uBlock Origin's default filterset:

- uBlock Origin's built-in filter lists
- EasyList
- EasyPrivacy
- Peter Lowe’s Ad and tracking server list

You can add more rulesets by visiting the options page -- click the _Cogs_ icon in the popup panel.
