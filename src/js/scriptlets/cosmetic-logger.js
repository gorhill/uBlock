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

(function() {

/******************************************************************************/

if (
    typeof vAPI !== 'object' ||
    vAPI.domFilterer instanceof Object === false ||
    vAPI.domWatcher instanceof Object === false
) {
    return;
}

const reHasCSSCombinators = /[ >+~]/;
const reHasPseudoClass = /:+(?:after|before)$/;
const sanitizedSelectors = new Map();
const simpleDeclarativeSet = new Set();
let simpleDeclarativeStr;
const complexDeclarativeSet = new Set();
let complexDeclarativeStr;
const proceduralDict = new Map();
const exceptionDict = new Map();
let exceptionStr;
const nodesToProcess = new Set();
let shouldProcessDeclarativeComplex = false;
let shouldProcessProcedural = false;
let shouldProcessExceptions = false;
const loggedSelectors = new Set();

/******************************************************************************/

const shouldProcess = function() {
    return nodesToProcess.size !== 0 ||
           shouldProcessDeclarativeComplex ||
           shouldProcessProcedural ||
           shouldProcessExceptions;
};

/******************************************************************************/

const processDeclarativeSimple = function(node, out) {
    if ( simpleDeclarativeSet.size === 0 ) { return; }
    if ( simpleDeclarativeStr === undefined ) {
        simpleDeclarativeStr = Array.from(simpleDeclarativeSet).join(',\n');
    }
    if (
        (node === document || node.matches(simpleDeclarativeStr) === false) &&
        (node.querySelector(simpleDeclarativeStr) === null)
    ) {
        return;
    }
    for ( const selector of simpleDeclarativeSet ) {
        if (
            (node === document || node.matches(selector) === false) &&
            (node.querySelector(selector) === null)
        ) {
            continue;
        }
        out.push(`##${sanitizedSelectors.get(selector) || selector}`);
        simpleDeclarativeSet.delete(selector);
        simpleDeclarativeStr = undefined;
        loggedSelectors.add(selector);
        if ( simpleDeclarativeSet.size === 0 ) { return; }
    }
};

/******************************************************************************/

const processDeclarativeComplex = function(out) {
    if ( complexDeclarativeSet.size === 0 ) { return; }
    if ( complexDeclarativeStr === undefined ) {
        complexDeclarativeStr = Array.from(complexDeclarativeSet).join(',\n');
    }
    if ( document.querySelector(complexDeclarativeStr) === null ) { return; }
    for ( const selector of complexDeclarativeSet ) {
        if ( document.querySelector(selector) === null ) { continue; }
        out.push(`##${sanitizedSelectors.get(selector) || selector}`);
        complexDeclarativeSet.delete(selector);
        complexDeclarativeStr = undefined;
        loggedSelectors.add(selector);
        if ( complexDeclarativeSet.size === 0 ) { return; }
    }
};

/******************************************************************************/

const processProcedural = function(out) {
    if ( proceduralDict.size === 0 ) { return; }
    for ( const entry of proceduralDict ) {
        if ( entry[1].test() === false ) { continue; }
        out.push(`##${entry[1].raw}`);
        proceduralDict.delete(entry[0]);
        if ( proceduralDict.size === 0 ) { break; }
    }
};

/******************************************************************************/

const processExceptions = function(out) {
    if ( exceptionDict.size === 0 ) { return; }
    if ( exceptionStr === undefined ) {
        exceptionStr = Array.from(exceptionDict.keys()).join(',\n');
    }
    if ( document.querySelector(exceptionStr) === null ) { return; }
    for ( const [ selector, raw ] of exceptionDict ) {
        if ( document.querySelector(selector) === null ) { continue; }
        out.push(`#@#${raw}`);
        exceptionDict.delete(selector);
        exceptionStr = undefined;
        loggedSelectors.add(raw);
    }
};

/******************************************************************************/

const processTimer = new vAPI.SafeAnimationFrame(() => {
    //console.time('dom logger/scanning for matches');
    processTimer.clear();
    const toLog = [];
    if ( nodesToProcess.size !== 0 && simpleDeclarativeSet.size !== 0 ) {
        if ( nodesToProcess.size !== 1 && nodesToProcess.has(document) ) {
            nodesToProcess.clear();
            nodesToProcess.add(document);
        }
        for ( const node of nodesToProcess ) {
            processDeclarativeSimple(node, toLog);
        }
        nodesToProcess.clear();
    }
    if ( shouldProcessDeclarativeComplex ) {
        processDeclarativeComplex(toLog);
        shouldProcessDeclarativeComplex = false;
    }
    if ( shouldProcessProcedural ) {
        processProcedural(toLog);
        shouldProcessProcedural = false;
    }
    if ( shouldProcessExceptions ) {
        processExceptions(toLog);
        shouldProcessExceptions = false;
    }
    if ( toLog.length === 0 ) { return; }
    vAPI.messaging.send(
        'scriptlets',
        {
            what: 'logCosmeticFilteringData',
            frameURL: window.location.href,
            frameHostname: window.location.hostname,
            matchedSelectors: toLog,
        }
    );
    //console.timeEnd('dom logger/scanning for matches');
});

/******************************************************************************/

const attributeObserver = new MutationObserver(mutations => {
    if ( simpleDeclarativeSet.size !== 0 ) {
        for ( const mutation of mutations ) {
            const node = mutation.target;
            if ( node.nodeType !== 1 ) { continue; }
            nodesToProcess.add(node);
        }
    }
    if ( complexDeclarativeSet.size !== 0 ) {
        shouldProcessDeclarativeComplex = true;
    }
    if ( proceduralDict.size !== 0 ) {
        shouldProcessProcedural = true;
    }
    if ( shouldProcess() ) {
        processTimer.start(100);
    }
});

/******************************************************************************/

const handlers = {
    onFiltersetChanged: function(changes) {
        //console.time('dom logger/filterset changed');
        const simpleSizeBefore = simpleDeclarativeSet.size,
            complexSizeBefore = complexDeclarativeSet.size,
            logNow = [];
        for ( const entry of (changes.declarative || []) ) {
            for ( let selector of entry[0].split(',\n') ) {
                if ( entry[1] !== 'display:none!important;' ) {
                    logNow.push(`##${selector}:style(${entry[1]})`);
                    continue;
                }
                if ( reHasPseudoClass.test(selector) ) {
                    const sanitized = selector.replace(reHasPseudoClass, '');
                    sanitizedSelectors.set(sanitized, selector);
                    selector = sanitized;
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
        if ( logNow.length !== 0 ) {
            vAPI.messaging.send(
                'scriptlets',
                {
                    what: 'logCosmeticFilteringData',
                    frameURL: window.location.href,
                    frameHostname: window.location.hostname,
                    matchedSelectors: logNow
                }
            );
        }
        if ( simpleDeclarativeSet.size !== simpleSizeBefore ) {
            nodesToProcess.add(document.documentElement);
        }
        if ( complexDeclarativeSet.size !== complexSizeBefore ) {
            shouldProcessDeclarativeComplex = true;
        }
        if (
            Array.isArray(changes.procedural) &&
            changes.procedural.length !== 0
        ) {
            for ( const selector of changes.procedural ) {
                proceduralDict.set(selector.raw, selector);
            }
            shouldProcessProcedural = true;
        }
        if ( Array.isArray(changes.exceptions) ) {
            for ( const selector of changes.exceptions ) {
                if ( loggedSelectors.has(selector) ) { continue; }
                if ( selector.charCodeAt(0) === 0x7B /* '{' */ ) {
                    const details = JSON.parse(selector);
                    exceptionDict.set(details.style[0], details.raw);
                } else {
                    exceptionDict.set(selector, selector);
                }
            }
            exceptionStr = undefined;
            shouldProcessExceptions = true;
        }
        if ( shouldProcess() ) {
            processTimer.start(1);
        }
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
        // This is to guard against runaway job queue. I suspect this could
        // occur on slower devices.
        if ( simpleDeclarativeSet.size !== 0 ) {
            for ( const node of addedNodes ) {
                if ( node.parentNode === null ) { continue; }
                nodesToProcess.add(node);
            }
        }
        if ( complexDeclarativeSet.size !== 0 ) {
            shouldProcessDeclarativeComplex = true;
        }
        if ( proceduralDict.size !== 0 ) {
            shouldProcessProcedural = true;
        }
        if ( exceptionDict.size !== 0 ) {
            shouldProcessExceptions = true;
        }
        if ( shouldProcess() ) {
            processTimer.start(100);
        }
    }
};

/******************************************************************************/

const onMessage = function(msg) {
    if ( msg.what === 'loggerDisabled' ) {
        processTimer.clear();
        attributeObserver.disconnect();
        vAPI.domFilterer.removeListener(handlers);
        vAPI.domWatcher.removeListener(handlers);
        vAPI.messaging.removeChannelListener('domLogger', onMessage);
    }
};
vAPI.messaging.addChannelListener('domLogger', onMessage);

vAPI.domWatcher.addListener(handlers);

/******************************************************************************/

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

