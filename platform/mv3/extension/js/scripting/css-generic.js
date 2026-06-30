/*******************************************************************************

    AdNauseam Lite - a comprehensive, MV3-compliant content blocker
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

/******************************************************************************/

// Important!
// Isolate from global scope
(function uBOL_cssGeneric() {

const genericSelectorMaps = self.genericSelectorMaps ?? [];
self.genericSelectorMaps = undefined;

const genericDetails = self.genericDetails ?? [];
self.genericDetails = undefined;

if ( genericDetails.length === 0 ) { return; }
if ( document.documentElement === null ) { return; }

/******************************************************************************/

const maxSurveyTimeSlice = 4;
const maxSurveyNodeSlice = 64;
const seenHashes = new Set();
const pendingHashes = new Set();
const pendingSelectors = [];
const stopAllRatio = 0.95; // To be investigated

let surveyCount = 0;
let surveyMissCount = 0;
let styleSheetTimer;
let processTimer;
let domChangeTimer;
let lastDomChange = Date.now();

/******************************************************************************/

const pendingNodes = {
    addedNodes: [],
    nodeSet: new Set(),
    add(node) {
        this.addedNodes.push(node);
    },
    next(out) {
        for ( const added of this.addedNodes ) {
            if ( this.nodeSet.has(added) ) { continue; }
            this.nodeSet.add(added);
            if ( added.firstElementChild === null ) { continue; }
            for ( const descendant of added.querySelectorAll('[id],[class]') ) {
                this.nodeSet.add(descendant);
            }
        }
        this.addedNodes.length = 0;
        for ( const node of this.nodeSet ) {
            this.nodeSet.delete(node);
            out.push(node);
            if ( out.length === maxSurveyNodeSlice ) { break; }
        }
    },
    hasNodes() {
        return this.addedNodes.length !== 0 || this.nodeSet.size !== 0;
    },
};

/******************************************************************************/

// http://www.cse.yorku.ca/~oz/hash.html#djb2
//   Must mirror dnrRulesetFromRawLists's version

const hashFromStr = (type, s) => {
    const len = s.length;
    const step = len + 7 >>> 3;
    let hash = (type << 5) + type ^ len;
    for ( let i = 0; i < len; i += step ) {
        hash = (hash << 5) + hash ^ s.charCodeAt(i);
    }
    return hash & 0xFFFF;
};

/******************************************************************************/

// Extract all classes/ids: these will be passed to the cosmetic
// filtering engine, and in return we will obtain only the relevant
// CSS selectors.

// https://github.com/gorhill/uBlock/issues/672
// http://www.w3.org/TR/2014/REC-html5-20141028/infrastructure.html#space-separated-tokens
// http://jsperf.com/enumerate-classes/6

const uBOL_idFromNode = node => {
    const raw = node.id;
    if ( typeof raw !== 'string' || raw.length === 0 ) { return; }
    const hash = hashFromStr(0x23 /* '#' */, raw.trim());
    if ( seenHashes.has(hash) ) { return; }
    seenHashes.add(hash);
    pendingHashes.add(hash);
};

// https://github.com/uBlockOrigin/uBlock-issues/discussions/2076
//   Performance: avoid using Element.classList
const uBOL_classesFromNode = node => {
    const s = node.getAttribute('class');
    if ( typeof s !== 'string' ) { return; }
    const len = s.length;
    for ( let beg = 0, end = 0; beg < len; beg += 1 ) {
        end = s.indexOf(' ', beg);
        if ( end === beg ) { continue; }
        if ( end === -1 ) { end = len; }
        const token = s.slice(beg, end).trimEnd();
        beg = end;
        if ( token.length === 0 ) { continue; }
        const hash = hashFromStr(0x2E /* '.' */, token);
        if ( seenHashes.has(hash) ) { continue; }
        seenHashes.add(hash);
        pendingHashes.add(hash);
    }
};

/******************************************************************************/

const processPendingHashes = ( ) => {
    for ( const hash of pendingHashes ) {
        for ( const selectorMap of genericSelectorMaps ) {
            const selectors = selectorMap.get(hash);
            if ( selectors === undefined ) { continue; }
            selectorMap.delete(hash);
            pendingSelectors.push(selectors);
        }
    }
};

/******************************************************************************/

const exceptPendingSelectors = ( ) => {
    if ( exceptionSet.size === 0 ) { return pendingSelectors.join(',\n'); }
    const selectorSet = new Set(pendingSelectors.map(a => a.split(',\n')).flat());
    return Array.from(selectorSet.difference(exceptionSet)).join(',\n');
};

/******************************************************************************/

const uBOL_processNodes = ( ) => {
    const t0 = Date.now();
    const nodes = [];
    const deadline = t0 + maxSurveyTimeSlice;
    for (;;) {
        pendingNodes.next(nodes);
        if ( nodes.length === 0 ) { break; }
        for ( const node of nodes ) {
            uBOL_idFromNode(node);
            uBOL_classesFromNode(node);
        }
        nodes.length = 0;
        if ( performance.now() >= deadline ) { break; }
    }
    surveyCount += 1;
    processPendingHashes();
    const styleSheetSelectors = exceptPendingSelectors();
    pendingHashes.clear();
    pendingSelectors.length = 0;
    if ( styleSheetSelectors === '' ) {
        surveyMissCount += 1;
        if ( surveyCount >= 64 ) {
            if ( (surveyMissCount / surveyCount) >= stopAllRatio ) {
                stopAll(`too many misses in surveyor (${surveyMissCount}/${surveyCount})`);
            }
        }
        return;
    }
    if ( styleSheetTimer !== undefined ) { return; }
    surveyMissCount = 0;
    styleSheetTimer = self.requestAnimationFrame(( ) => {
        styleSheetTimer = undefined;
        self.cssAPI.insert(`${styleSheetSelectors}{display:none!important;}`);
    });
};

/******************************************************************************/

const uBOL_processChanges = mutations => {
    for ( const mutation of mutations ) {
        if ( mutation.type === 'childList' ) {
            for ( const added of mutation.addedNodes ) {
                if ( added.nodeType !== 1 ) { continue; }
                if ( added.parentElement === null ) { continue; }
                pendingNodes.add(added);
            }
        } else if ( mutation.attributeName === 'class' ) {
            uBOL_classesFromNode(mutation.target);
        } else {
            uBOL_idFromNode(mutation.target);
        }
    }
    if ( pendingNodes.hasNodes() === false ) {
        if ( pendingHashes.size === 0 ) { return; }
    }
    lastDomChange = Date.now();
    if ( processTimer !== undefined ) { return; }
    processTimer = self.setTimeout(( ) => {
        processTimer = undefined;
        uBOL_processNodes();
    }, 64);
};

/******************************************************************************/

const stopAll = ( ) => {
    if ( domChangeTimer !== undefined ) {
        self.clearTimeout(domChangeTimer);
        domChangeTimer = undefined;
    }
    if ( domMutationObserver ) {
        domMutationObserver.disconnect();
        domMutationObserver.takeRecords();
        domMutationObserver = undefined;
    }
    genericSelectorMaps.length = 0;
};

/******************************************************************************/

// Perform once:
// - Inject highly generics
// - Collate exceptions matching current context

const exceptionSet = new Set();
for ( const entry of genericDetails ) {
    const { highlyGeneric, exceptions, hostnames } = entry;
    if ( highlyGeneric ) {
        pendingSelectors.push(highlyGeneric);
    }
    if ( hostnames.length === 0 ) { continue; }
    let i = -1;
    for ( const hostname of self.isolatedAPI.contexts.hostnames ) {
        i = self.isolatedAPI.binarySearch(hostnames, hostname, i);
        if ( i >= 0 ) {
            exceptions[i].split('\n').forEach(a => exceptionSet.add(a));
        } else {
            i = ~i + 1;
        }
    }
    if ( entry.hasEntities ) {
        i = -1;
        for ( const entity of self.isolatedAPI.contexts.entities ) {
            i = self.isolatedAPI.binarySearch(hostnames, entity, i);
            if ( i >= 0 ) {
                exceptions[i].split('\n').forEach(a => exceptionSet.add(a));
            } else {
                i = ~i + 1;
            }
        }
    }
}
genericDetails.length = 0;

/******************************************************************************/

// Start applying generic cosmetic filters

pendingNodes.add(document.documentElement);
uBOL_processNodes();

let domMutationObserver = new MutationObserver(uBOL_processChanges);
domMutationObserver.observe(document, {
    attributeFilter: [ 'class', 'id' ],
    attributes: true,
    childList: true,
    subtree: true,
});

const needDomChangeObserver = ( ) => {
    domChangeTimer = undefined;
    if ( domMutationObserver === undefined ) { return; }
    if ( (Date.now() - lastDomChange) > 30000 ) {
        return stopAll('no more DOM changes');
    }
    domChangeTimer = self.setTimeout(needDomChangeObserver, 30000);
};

needDomChangeObserver();

/******************************************************************************/

})();

/******************************************************************************/
