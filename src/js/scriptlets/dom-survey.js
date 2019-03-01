/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-2018 Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

'use strict';

/******************************************************************************/

(function() {
    if ( typeof vAPI !== 'object' ) { return; }

    // https://github.com/gorhill/httpswitchboard/issues/25
    //
    // https://github.com/gorhill/httpswitchboard/issues/131
    //   Looks for inline javascript also in at least one a[href] element.
    //
    // https://github.com/gorhill/uMatrix/issues/485
    //   Mind "on..." attributes.
    //
    // https://github.com/gorhill/uMatrix/issues/924
    //   Report inline styles.
    let inlineScriptCount = 0;
    if (
        document.querySelector('script:not([src])') !== null ||
        document.querySelector('script[src^="data:"]') !== null ||
        document.querySelector('script[src^="blob:"]') !== null ||
        document.querySelector('a[href^="javascript:"]') !== null ||
        document.querySelector('[onabort],[onblur],[oncancel],[oncanplay],[oncanplaythrough],[onchange],[onclick],[onclose],[oncontextmenu],[oncuechange],[ondblclick],[ondrag],[ondragend],[ondragenter],[ondragexit],[ondragleave],[ondragover],[ondragstart],[ondrop],[ondurationchange],[onemptied],[onended],[onerror],[onfocus],[oninput],[oninvalid],[onkeydown],[onkeypress],[onkeyup],[onload],[onloadeddata],[onloadedmetadata],[onloadstart],[onmousedown],[onmouseenter],[onmouseleave],[onmousemove],[onmouseout],[onmouseover],[onmouseup],[onwheel],[onpause],[onplay],[onplaying],[onprogress],[onratechange],[onreset],[onresize],[onscroll],[onseeked],[onseeking],[onselect],[onshow],[onstalled],[onsubmit],[onsuspend],[ontimeupdate],[ontoggle],[onvolumechange],[onwaiting],[onafterprint],[onbeforeprint],[onbeforeunload],[onhashchange],[onlanguagechange],[onmessage],[onoffline],[ononline],[onpagehide],[onpageshow],[onrejectionhandled],[onpopstate],[onstorage],[onunhandledrejection],[onunload],[oncopy],[oncut],[onpaste]') !== null
    ) {
        inlineScriptCount = 1;
    }

    let scriptTags = document.querySelectorAll('script[src]');

    let filteredElementCount = 0;
    if ( vAPI.domFilterer ) {
        filteredElementCount = vAPI.domFilterer.getFilteredElementCount();
    }

    vAPI.messaging.send(
        'scriptlets',
        {
            what: 'domSurveyTransientReport',
            pageURL: window.location.href,
            filteredElementCount: filteredElementCount,
            scriptCount: inlineScriptCount + scriptTags.length,
        }
    );
})();








/*******************************************************************************

    DO NOT:
    - Remove the following code
    - Add code beyond the following code
    Reason:
    - https://github.com/gorhill/uBlock/pull/3721
    - uBO never uses the return value from injected content scripts

**/

void 0;
