/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
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

// Important!
// Isolate from global scope
(function uBOL_cssProcedural() {

/******************************************************************************/

const proceduralImports = self.proceduralImports || [];
self.proceduralImports = undefined;

/******************************************************************************/

const isolatedAPI = self.isolatedAPI;
const selectors = new Set();
const exceptions = new Set();

const lookupHostname = (hostname, details) => {
    const listref = isolatedAPI.binarySearch(details.hostnames, hostname);
    if ( listref === -1 ) { return; }
    if ( Array.isArray(details.selectorLists) === false ) {
        details.selectorLists = details.selectorLists.split(';');
        details.selectorListRefs = JSON.parse(`[${details.selectorListRefs}]`);
    }
    const ilist = details.selectorListRefs[listref];
    const list = JSON.parse(`[${details.selectorLists[ilist]}]`);
    for ( const iselector of list ) {
        if ( iselector >= 0 ) {
            selectors.add(details.selectors[iselector]);
        } else {
            exceptions.add(details.selectors[~iselector]);
        }
    }
};

const lookupAll = hostname => {
    for ( const details of proceduralImports ) {
        lookupHostname(hostname, details);
    }
};

isolatedAPI.forEachHostname(lookupAll, {
    hasEntities: proceduralImports.some(a => a.hasEntities)
});

proceduralImports.length = 0;

for ( const selector of exceptions ) {
    selectors.delete(selector);
}

if ( selectors.size === 0 ) { return; }

const exceptedSelectors = Array.from(selectors).map(a => JSON.parse(a));

const declaratives = exceptedSelectors.filter(a => a.cssable);
if ( declaratives.length !== 0 ) {
    const cssRuleFromProcedural = details => {
        const { tasks, action } = details;
        let mq, selector;
        if ( Array.isArray(tasks) ) {
            if ( tasks[0][0] !== 'matches-media' ) { return; }
            mq = tasks[0][1];
            if ( tasks.length > 2 ) { return; }
            if ( tasks.length === 2 ) {
                if ( tasks[1][0] !== 'spath' ) { return; }
                selector = tasks[1][1];
            }
        }
        let style;
        if ( Array.isArray(action) ) {
            if ( action[0] !== 'style' ) { return; }
            selector = selector || details.selector;
            style = action[1];
        }
        if ( mq === undefined && style === undefined && selector === undefined ) { return; }
        if ( mq === undefined ) {
            return `${selector}\n{${style}}`;
        }
        if ( style === undefined ) {
            return `@media ${mq} {\n${selector}\n{display:none!important;}\n}`;
        }
        return `@media ${mq} {\n${selector}\n{${style}}\n}`;
    };
    const sheetText = [];
    for ( const details of declaratives ) {
        const ruleText = cssRuleFromProcedural(details);
        if ( ruleText === undefined ) { continue; }
        sheetText.push(ruleText);
    }
    if ( sheetText.length !== 0 ) {
        self.cssAPI.insert(sheetText.join('\n'));
    }
}

const procedurals = exceptedSelectors.filter(a => a.cssable === undefined);
if ( procedurals.length !== 0 ) {
    const addSelectors = selectors => {
        if ( self.listsProceduralFiltererAPI instanceof Object === false ) { return; }
        self.listsProceduralFiltererAPI.addSelectors(selectors);
    };
    if ( self.ProceduralFiltererAPI === undefined ) {
        self.ProceduralFiltererAPI = chrome.runtime.sendMessage({
            what: 'injectCSSProceduralAPI'
        }).catch(( ) => {
        });
    }
    if ( self.ProceduralFiltererAPI instanceof Promise ) {
        self.ProceduralFiltererAPI.then(( ) => {
            self.listsProceduralFiltererAPI = new self.ProceduralFiltererAPI();
            addSelectors(procedurals);
        });
    } else {
        addSelectors(procedurals);
    }
}

/******************************************************************************/

})();

void 0;
