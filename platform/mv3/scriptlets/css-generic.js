/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-present Raymond Hill

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

/* jshint esversion:11 */

'use strict';

/******************************************************************************/

/// name css-generic

/******************************************************************************/

// Important!
// Isolate from global scope
(function uBOL_cssGeneric() {

/******************************************************************************/

// $rulesetId$

{
    const excludeHostnameSet = new Set(self.$excludeHostnameSet$);

    let hn;
    try { hn = document.location.hostname; } catch(ex) { }
    while ( hn ) {
        if ( excludeHostnameSet.has(hn) ) { return; }
        const pos = hn.indexOf('.');
        if ( pos === -1 ) { break; }
        hn = hn.slice(pos+1);
    }
    excludeHostnameSet.clear();
}

const genericSelectorLists = new Map(self.$genericSelectorLists$);

/******************************************************************************/

const queriedHashes = new Set();
const maxSurveyTimeSlice = 4;
const styleSheetSelectors = [];
const stopAllRatio = 0.95; // To be investigated

let surveyCount = 0;
let surveyMissCount = 0;
let styleSheetTimer;
let processTimer;
let domChangeTimer;
let lastDomChange = Date.now();

/******************************************************************************/

// https://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
const hashFromStr = (type, s) => {
    const len = s.length;
    const step = len + 7 >>> 3;
	let hash = type;
	for ( let i = 0; i < len; i += step ) {
		hash = (hash << 5) - hash + s.charCodeAt(i) | 0;
	}
	return hash & 0x00FFFFFF;
};

/******************************************************************************/

// Extract all classes/ids: these will be passed to the cosmetic
// filtering engine, and in return we will obtain only the relevant
// CSS selectors.

// https://github.com/gorhill/uBlock/issues/672
// http://www.w3.org/TR/2014/REC-html5-20141028/infrastructure.html#space-separated-tokens
// http://jsperf.com/enumerate-classes/6

const uBOL_idFromNode = (node, out) => {
    const raw = node.id;
    if ( typeof raw !== 'string' || raw.length === 0 ) { return; }
    const s = raw.trim();
    const hash = hashFromStr(0x23 /* '#' */, s);
    if ( queriedHashes.has(hash) ) { return; }
    out.push(hash);
    queriedHashes.add(hash);
};

// https://github.com/uBlockOrigin/uBlock-issues/discussions/2076
//   Performance: avoid using Element.classList
const uBOL_classesFromNode = (node, out) => {
    const s = node.getAttribute('class');
    if ( typeof s !== 'string' ) { return; }
    const len = s.length;
    for ( let beg = 0, end = 0, token = ''; beg < len; beg += 1 ) {
        end = s.indexOf(' ', beg);
        if ( end === beg ) { continue; }
        if ( end === -1 ) { end = len; }
        token = s.slice(beg, end);
        beg = end;
        const hash = hashFromStr(0x2E /* '.' */, token);
        if ( queriedHashes.has(hash) ) { continue; }
        out.push(hash);
        queriedHashes.add(hash);
    }
};

/******************************************************************************/

const pendingNodes = {
    nodeLists: [],
    buffer: [
        null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null,
    ],
    j: 0,
    add(nodes) {
        if ( nodes.length === 0 ) { return; }
        this.nodeLists.push(nodes);
    },
    next() {
        if ( this.nodeLists.length === 0 ) { return 0; }
        const maxSurveyBuffer = this.buffer.length;
        const nodeLists = this.nodeLists;
        let ib = 0;
        do {
            const nodeList = nodeLists[0];
            let j = this.j;
            let n = j + maxSurveyBuffer - ib;
            if ( n > nodeList.length ) {
                n = nodeList.length;
            }
            for ( let i = j; i < n; i++ ) {
                this.buffer[ib++] = nodeList[j++];
            }
            if ( j !== nodeList.length ) {
                this.j = j;
                break;
            }
            this.j = 0;
            this.nodeLists.shift();
        } while ( ib < maxSurveyBuffer && nodeLists.length !== 0 );
        return ib;
    },
    hasNodes() {
        return this.nodeLists.length !== 0;
    },
};

/******************************************************************************/

const uBOL_processNodes = ( ) => {
    const t0 = Date.now();
    const hashes = [];
    const nodes = pendingNodes.buffer;
    const deadline = t0 + maxSurveyTimeSlice;
    let processed = 0;
    for (;;) {
        const n = pendingNodes.next();
        if ( n === 0 ) { break; }
        for ( let i = 0; i < n; i++ ) {
            const node = nodes[i];
            nodes[i] = null;
            uBOL_idFromNode(node, hashes);
            uBOL_classesFromNode(node, hashes);
        }
        processed += n;
        if ( performance.now() >= deadline ) { break; }
    }
    for ( const hash of hashes ) {
        const selectorList = genericSelectorLists.get(hash);
        if ( selectorList === undefined ) { continue; }
        styleSheetSelectors.push(selectorList);
        genericSelectorLists.delete(hash);
    }
    surveyCount += 1;
    if ( styleSheetSelectors.length === 0 ) {
        surveyMissCount += 1;
        if (
            surveyCount >= 100 &&
            (surveyMissCount / surveyCount) >= stopAllRatio
        ) {
            stopAll('too many misses in surveyor');
        }
        return;
    }
    if ( styleSheetTimer !== undefined ) { return; }
    styleSheetTimer = self.requestAnimationFrame(( ) => {
        styleSheetTimer = undefined;
        uBOL_injectStyleSheet();
    });
};

/******************************************************************************/

const uBOL_processChanges = mutations => {
    for ( let i = 0; i < mutations.length; i++ ) {
        const mutation = mutations[i];
        for ( const added of mutation.addedNodes ) {
            if ( added.nodeType !== 1 ) { continue; }
            pendingNodes.add([ added ]);
            if ( added.firstElementChild === null ) { continue; }
            pendingNodes.add(added.querySelectorAll('[id],[class]'));
        }
    }
    if ( pendingNodes.hasNodes() === false ) { return; }
    lastDomChange = Date.now();
    if ( processTimer !== undefined ) { return; }
    processTimer = self.setTimeout(( ) => {
        processTimer = undefined;
        uBOL_processNodes();
    }, 64);
};

/******************************************************************************/

const uBOL_injectStyleSheet = ( ) => {
    try {
        const sheet = new CSSStyleSheet();
        sheet.replace(`@layer{${styleSheetSelectors.join(',')}{display:none!important;}}`);
        document.adoptedStyleSheets = [
            ...document.adoptedStyleSheets,
            sheet
        ];
    } catch(ex) {
    }
    styleSheetSelectors.length = 0;
};

/******************************************************************************/

pendingNodes.add(document.querySelectorAll('[id],[class]'));
uBOL_processNodes();

let domMutationObserver = new MutationObserver(uBOL_processChanges);
domMutationObserver.observe(document, {
    childList: true,
    subtree: true,
});

const needDomChangeObserver = ( ) => {
    domChangeTimer = undefined;
    if ( domMutationObserver === undefined ) { return; }
    if ( (Date.now() - lastDomChange) > 20000 ) {
        return stopAll('no more DOM changes');
    }
    domChangeTimer = self.setTimeout(needDomChangeObserver, 20000);
};

needDomChangeObserver();

/******************************************************************************/

const stopAll = reason => {
    if ( domChangeTimer !== undefined ) {
        self.clearTimeout(domChangeTimer);
        domChangeTimer = undefined;
    }
    domMutationObserver.disconnect();
    domMutationObserver.takeRecords();
    domMutationObserver = undefined;
    genericSelectorLists.clear();
    queriedHashes.clear();
    console.info(`uBOL: Generic cosmetic filtering stopped because ${reason}`);
};

/******************************************************************************/

})();

/******************************************************************************/
