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

(( ) => {
// >>>>>>>> start of private namespace

/******************************************************************************/

if (
    typeof vAPI !== 'object' ||
    vAPI.domFilterer instanceof Object === false ||
    vAPI.domWatcher instanceof Object === false
) {
    return;
}

const reHasCSSCombinators = /[ >+~]/;
const simpleDeclarativeSet = new Set();
let simpleDeclarativeStr;
const complexDeclarativeSet = new Set();
let complexDeclarativeStr;
const declarativeStyleDict = new Map();
let declarativeStyleStr;
const proceduralDict = new Map();
const exceptionDict = new Map();
let exceptionStr;
const proceduralExceptionDict = new Map();
const nodesToProcess = new Set();
const loggedSelectors = new Set();

/******************************************************************************/

const rePseudoElements = /:(?::?after|:?before|:[a-z-]+)$/;

const safeMatchSelector = function(selector, context) {
    const safeSelector = rePseudoElements.test(selector)
        ? selector.replace(rePseudoElements, '')
        : selector;
    return context.matches(safeSelector);
};

const safeQuerySelector = function(selector, context = document) {
    const safeSelector = rePseudoElements.test(selector)
        ? selector.replace(rePseudoElements, '')
        : selector;
    return context.querySelector(safeSelector);
};

const safeGroupSelectors = function(selectors) {
    const arr = Array.isArray(selectors)
        ? selectors
        : Array.from(selectors);
    return arr.map(s => {
        return rePseudoElements.test(s)
            ? s.replace(rePseudoElements, '')
            : s;
    }).join(',\n');
};

/******************************************************************************/

const processDeclarativeSimple = function(node, out) {
    if ( simpleDeclarativeSet.size === 0 ) { return; }
    if ( simpleDeclarativeStr === undefined ) {
        simpleDeclarativeStr = safeGroupSelectors(simpleDeclarativeSet);
    }
    if (
        (node === document || node.matches(simpleDeclarativeStr) === false) &&
        (node.querySelector(simpleDeclarativeStr) === null)
    ) {
        return;
    }
    for ( const selector of simpleDeclarativeSet ) {
        if (
            (node === document || safeMatchSelector(selector, node) === false) &&
            (safeQuerySelector(selector, node) === null)
        ) {
            continue;
        }
        out.push(`##${selector}`);
        simpleDeclarativeSet.delete(selector);
        simpleDeclarativeStr = undefined;
        loggedSelectors.add(selector);
    }
};

/******************************************************************************/

const processDeclarativeComplex = function(out) {
    if ( complexDeclarativeSet.size === 0 ) { return; }
    if ( complexDeclarativeStr === undefined ) {
        complexDeclarativeStr = safeGroupSelectors(complexDeclarativeSet);
    }
    if ( document.querySelector(complexDeclarativeStr) === null ) { return; }
    for ( const selector of complexDeclarativeSet ) {
        if ( safeQuerySelector(selector) === null ) { continue; }
        out.push(`##${selector}`);
        complexDeclarativeSet.delete(selector);
        complexDeclarativeStr = undefined;
        loggedSelectors.add(selector);
    }
};

/******************************************************************************/

const processDeclarativeStyle = function(out) {
    if ( declarativeStyleDict.size === 0 ) { return; }
    if ( declarativeStyleStr === undefined ) {
        declarativeStyleStr = safeGroupSelectors(declarativeStyleDict.keys());
    }
    if ( document.querySelector(declarativeStyleStr) === null ) { return; }
    for ( const selector of declarativeStyleDict.keys() ) {
        if ( safeQuerySelector(selector) === null ) { continue; }
        for ( const style of declarativeStyleDict.get(selector) ) {
            const raw = `##${selector}:style(${style})`;
            out.push(raw);
            loggedSelectors.add(raw);
        }
        declarativeStyleDict.delete(selector);
        declarativeStyleStr = undefined;
    }
};

/******************************************************************************/

const processProcedural = function(out) {
    if ( proceduralDict.size === 0 ) { return; }
    for ( const entry of proceduralDict ) {
        if ( entry[1].test() === false ) { continue; }
        out.push(`##${entry[1].raw}`);
        proceduralDict.delete(entry[0]);
    }
};

/******************************************************************************/

const processExceptions = function(out) {
    if ( exceptionDict.size === 0 ) { return; }
    if ( exceptionStr === undefined ) {
        exceptionStr = safeGroupSelectors(exceptionDict.keys());
    }
    if ( document.querySelector(exceptionStr) === null ) { return; }
    for ( const [ selector, raw ] of exceptionDict ) {
        if ( safeQuerySelector(selector) === null ) { continue; }
        out.push(`#@#${raw}`);
        exceptionDict.delete(selector);
        exceptionStr = undefined;
        loggedSelectors.add(raw);
    }
};

/******************************************************************************/

const processProceduralExceptions = function(out) {
    if ( proceduralExceptionDict.size === 0 ) { return; }
    for ( const exception of proceduralExceptionDict.values() ) {
        if ( exception.test() === false ) { continue; }
        out.push(`#@#${exception.raw}`);
        proceduralExceptionDict.delete(exception.raw);
    }
};

/******************************************************************************/

const processTimer = new vAPI.SafeAnimationFrame(( ) => {
    //console.time('dom logger/scanning for matches');
    processTimer.clear();
    if ( nodesToProcess.size === 0 ) { return; }

    if ( nodesToProcess.size !== 1 && nodesToProcess.has(document) ) {
        nodesToProcess.clear();
        nodesToProcess.add(document);
    }

    const toLog = [];
    if ( simpleDeclarativeSet.size !== 0 ) {
        for ( const node of nodesToProcess ) {
            processDeclarativeSimple(node, toLog);
        }
    }

    processDeclarativeComplex(toLog);
    processDeclarativeStyle(toLog);
    processProcedural(toLog);
    processExceptions(toLog);
    processProceduralExceptions(toLog);

    nodesToProcess.clear();

    if ( toLog.length === 0 ) { return; }

    vAPI.messaging.send('scriptlets', {
        what: 'logCosmeticFilteringData',
        frameURL: window.location.href,
        frameHostname: window.location.hostname,
        matchedSelectors: toLog,
    });
    //console.timeEnd('dom logger/scanning for matches');
});

/******************************************************************************/

const attributeObserver = new MutationObserver(mutations => {
    if ( nodesToProcess.has(document) ) { return; }
    for ( const mutation of mutations ) {
        const node = mutation.target;
        if ( node.nodeType !== 1 ) { continue; }
        nodesToProcess.add(node);
    }
    if ( nodesToProcess.size !== 0 ) {
        processTimer.start(100);
    }
});

/******************************************************************************/

const handlers = {
    onFiltersetChanged: function(changes) {
        //console.time('dom logger/filterset changed');
        for ( const entry of (changes.declarative || []) ) {
            for ( let selector of entry[0].split(',\n') ) {
                if ( entry[1] !== 'display:none!important;' ) {
                    declarativeStyleStr = undefined;
                    const styles = declarativeStyleDict.get(selector);
                    if ( styles === undefined ) {
                        declarativeStyleDict.set(selector, [ entry[1] ]);
                        continue;
                    }
                    styles.push(entry[1]);
                    continue;
                }
                if ( loggedSelectors.has(selector) ) { continue; }
                if ( reHasCSSCombinators.test(selector) ) {
                    complexDeclarativeSet.add(selector);
                    complexDeclarativeStr = undefined;
                } else {
                    simpleDeclarativeSet.add(selector);
                    simpleDeclarativeStr = undefined;
                }
            }
        }
        if (
            Array.isArray(changes.procedural) &&
            changes.procedural.length !== 0
        ) {
            for ( const selector of changes.procedural ) {
                proceduralDict.set(selector.raw, selector);
            }
        }
        if ( Array.isArray(changes.exceptions) ) {
            for ( const selector of changes.exceptions ) {
                if ( loggedSelectors.has(selector) ) { continue; }
                if ( selector.charCodeAt(0) !== 0x7B /* '{' */ ) {
                    exceptionDict.set(selector, selector);
                    continue;
                }
                const details = JSON.parse(selector);
                if ( Array.isArray(details.style) ) {
                    exceptionDict.set(details.style[0], details.raw);
                    continue;
                }
                proceduralExceptionDict.set(
                    details.raw,
                    vAPI.domFilterer.createProceduralFilter(details)
                );
            }
            exceptionStr = undefined;
        }
        nodesToProcess.clear();
        nodesToProcess.add(document);
        processTimer.start(1);
        //console.timeEnd('dom logger/filterset changed');
    },

    onDOMCreated: function() {
        handlers.onFiltersetChanged(vAPI.domFilterer.getAllSelectors());
        vAPI.domFilterer.addListener(handlers);
        attributeObserver.observe(document.body, {
            attributes: true,
            subtree: true
        });
    },

    onDOMChanged: function(addedNodes) {
        if ( nodesToProcess.has(document) ) { return; }
        for ( const node of addedNodes ) {
            if ( node.parentNode === null ) { continue; }
            nodesToProcess.add(node);
        }
        if ( nodesToProcess.size !== 0 ) {
            processTimer.start(100);
        }
    }
};

/******************************************************************************/

vAPI.messaging.extend().then(extended => {
    if ( extended !== true ) { return; }
    const broadcastListener = msg => {
        if ( msg.what === 'loggerDisabled' ) {
            processTimer.clear();
            attributeObserver.disconnect();
            vAPI.domFilterer.removeListener(handlers);
            vAPI.domWatcher.removeListener(handlers);
            vAPI.broadcastListener.remove(broadcastListener);
        }
    };
    vAPI.broadcastListener.add(broadcastListener);
});

vAPI.domWatcher.addListener(handlers);

/******************************************************************************/

// <<<<<<<< end of private namespace
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

