## Description

**uBO Lite** (uBOL), an experimental **permission-less** [MV3 API-based](https://developer.chrome.com/docs/extensions/mv3/intro/) content blocker.

uBOL is entirely declarative, meaning there is no need for a permanent uBOL process for the filtering to occur, and CSS/JS injection-based content filtering is [performed reliably](https://developer.chrome.com/docs/extensions/reference/scripting/#method-registerContentScripts) by the browser itself rather than by the extension. This means that uBOL itself does not consume CPU/memory resources while content blocking is ongoing -- uBOL's service worker process is required _only_ when you interact with the popup panel or the option pages.

uBOL does not require broad "read/modify data" [permission](https://developer.chrome.com/docs/extensions/mv3/declare_permissions/) at install time, hence its limited capabilities out of the box compared to uBlock Origin or other content blockers requiring broad "read/modify data" permissions at install time. <details><summary>**However, [...]**</summary>
 uBOL allows you to *explicitly* grant extended permissions on specific sites of your choice so that it can better filter on those sites using declarative cosmetic and scriptlet injections.

To grant extended permissions on a given site, open the popup panel and click the _Sun_ icon:

![uBOL's popup panel: no permission](https://user-images.githubusercontent.com/585534/191071717-2b13b931-ecc8-4d12-a35d-4b2af251f758.png)

The browser will then warn you about the effects of granting the additional permissions requested by the extension on the current site, and you will have to tell the browser whether you accept or decline the request:

![uBOL's popup panel: browser warning](https://user-images.githubusercontent.com/585534/191071828-1d4cb8d2-001f-4cb2-aef8-18fe637a578a.png)

If you accept uBOL's request for additional permissions on the current site, it will be able to better filter content for the current site:

![uBOL's popup panel: permissions to inject content](https://user-images.githubusercontent.com/585534/191071768-836daa7a-43fc-4823-a19d-bfb115b32305.png)

When the _Sun_ icon is blue, this means you explicitly granted extended permissions on the current site. The badge number beside the _Sun_ icon represents the number of distinct CSS/JS resources which can/will be injected on the current site, leading to better content filtering on that site.

You can revoke formerly granted extended permissions by simply clicking the _Sun_ icon again. You can view/manage all the sites for which you granted extended permissions by clicking the "Details" button of uBOL's card in your browser's extensions page.
</details>

The default ruleset corresponds to uBlock Origin's default filterset:

- uBlock Origin's built-in filter lists
- EasyList
- EasyPrivacy
- Peter Lowe’s Ad and tracking server list

You can add more rulesets by visiting the options page -- click the _Cogs_ icon in the popup panel.

Keep in mind this is still a work in progress, with these end goals:
- No broad host permissions at install time -- extended permissions are granted explicitly by the user on a per-site basis.
- Entirely declarative for reliability and CPU/memory efficiency.
