/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-present Raymond Hill

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

// Scriptlets to count the number of script tags in a document.

(( ) => {
    if ( typeof vAPI !== 'object' ) { return; }

    const t0 = Date.now();
    const tMax = t0 + 50;

    if ( vAPI.domSurveyScripts instanceof Object === false ) {
        vAPI.domSurveyScripts = {
            busy: false,
            inlineScriptCount: -1,
            externalScriptCount: -1,
            surveyTime: t0,
        };
    }
    const surveyResults = vAPI.domSurveyScripts;

    if ( surveyResults.busy ) { return; }
    surveyResults.busy = true;

    if ( surveyResults.surveyTime < vAPI.domMutationTime ) {
        surveyResults.inlineScriptCount = -1;
        surveyResults.externalScriptCount = -1;
    }
    surveyResults.surveyTime = t0;

    if ( surveyResults.externalScriptCount === -1 ) {
        const reInlineScript = /^(data:|blob:|$)/;
        let inlineScriptCount = 0;
        let externalScriptCount = 0;
        for ( const script of document.scripts ) {
            if ( reInlineScript.test(script.src) ) {
                inlineScriptCount = 1;
                continue;
            }
            externalScriptCount += 1;
            if ( externalScriptCount === 99 ) { break; }
        }
        if ( inlineScriptCount !== 0 || externalScriptCount === 99 ) {
            surveyResults.inlineScriptCount = inlineScriptCount;
        }
        surveyResults.externalScriptCount = externalScriptCount;
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/756
    //   Keep trying to find inline script-like instances but only if we
    //   have the time-budget to do so.
    if ( surveyResults.inlineScriptCount === -1 && Date.now() < tMax ) {
        if ( document.querySelector('a[href^="javascript:"]') !== null ) {
            surveyResults.inlineScriptCount = 1;
        }
    }

    if ( surveyResults.inlineScriptCount === -1 && Date.now() < tMax ) {
        surveyResults.inlineScriptCount = 0;
        const onHandlers = new Set([
            'onabort', 'onblur', 'oncancel', 'oncanplay',
            'oncanplaythrough', 'onchange', 'onclick', 'onclose',
            'oncontextmenu', 'oncuechange', 'ondblclick', 'ondrag',
            'ondragend', 'ondragenter', 'ondragexit', 'ondragleave',
            'ondragover', 'ondragstart', 'ondrop', 'ondurationchange',
            'onemptied', 'onended', 'onerror', 'onfocus',
            'oninput', 'oninvalid', 'onkeydown', 'onkeypress',
            'onkeyup', 'onload', 'onloadeddata', 'onloadedmetadata',
            'onloadstart', 'onmousedown', 'onmouseenter', 'onmouseleave',
            'onmousemove', 'onmouseout', 'onmouseover', 'onmouseup',
            'onwheel', 'onpause', 'onplay', 'onplaying',
            'onprogress', 'onratechange', 'onreset', 'onresize',
            'onscroll', 'onseeked', 'onseeking', 'onselect',
            'onshow', 'onstalled', 'onsubmit', 'onsuspend',
            'ontimeupdate', 'ontoggle', 'onvolumechange', 'onwaiting',
            'onafterprint', 'onbeforeprint', 'onbeforeunload', 'onhashchange',
            'onlanguagechange', 'onmessage', 'onoffline', 'ononline',
            'onpagehide', 'onpageshow', 'onrejectionhandled', 'onpopstate',
            'onstorage', 'onunhandledrejection', 'onunload',
            'oncopy', 'oncut', 'onpaste'
        ]);
        const nodeIter = document.createNodeIterator(
            document.body,
            NodeFilter.SHOW_ELEMENT
        );
        for (;;) {
            const node = nodeIter.nextNode();
            if ( node === null ) { break; }
            if ( node.hasAttributes() === false ) { continue; }
            for ( const attr of node.getAttributeNames() ) {
                if ( onHandlers.has(attr) === false ) { continue; }
                surveyResults.inlineScriptCount = 1;
                break;
            }
        }
    }

    surveyResults.busy = false;

    // IMPORTANT: This is returned to the injector, so this MUST be
    //            the last statement.
    let total = surveyResults.externalScriptCount;
    if ( surveyResults.inlineScriptCount !== -1 ) {
        total += surveyResults.inlineScriptCount;
    }
    return total;
})();
