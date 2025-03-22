/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2019-present Raymond Hill

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

import {
    matchObjectPropertiesFn,
    parsePropertiesToMatchFn,
} from './utils.js';

import { objectPruneFn } from './object-prune.js';
import { registerScriptlet } from './base.js';
import { safeSelf } from './safe-self.js';

/******************************************************************************/

function jsonlPruneFn(
    text = '',
    rawPrunePaths = '',
    rawNeedlePaths = ''
) {
    const safe = safeSelf();
    const linesBefore = text.split(/\n+/);
    const linesAfter = [];
    for ( const lineBefore of linesBefore ) {
        let objBefore;
        try {
            objBefore = safe.JSON_parse(lineBefore);
        } catch {
        }
        if ( typeof objBefore !== 'object' ) {
            linesAfter.push(lineBefore);
            continue;
        }
        const objAfter = objectPruneFn(objBefore, rawPrunePaths, rawNeedlePaths);
        if ( typeof objAfter !== 'object' ) {
            linesAfter.push(lineBefore);
            continue;
        }
        linesAfter.push(safe.JSON_stringifyFn(objAfter));
    }
    return linesAfter.join('\n');
}
registerScriptlet(jsonlPruneFn, {
    name: 'jsonl-prune.fn',
    dependencies: [
        objectPruneFn,
        safeSelf,
    ],
});

/******************************************************************************/

/**
 * @scriptlet jsonl-prune-xhr-response.js
 * 
 * @description
 * Prune the objects found in a JSONL resource fetched through a XHR instance.
 * 
 * @param rawPrunePaths
 * The property to remove from the objects.
 * 
 * @param rawNeedlePaths
 * A property which must be present for the pruning to take effect.
 * 
 * @param [propsToMatch, value]
 * An optional vararg detailing the arguments to match when xhr.open() is
 * called.
 * 
 * */

function jsonlPruneXhrResponseFn(
    rawPrunePaths = '',
    rawNeedlePaths = ''
) {
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('jsonl-prune-xhr-response', rawPrunePaths, rawNeedlePaths);
    const xhrInstances = new WeakMap();
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 2);
    const propNeedles = parsePropertiesToMatchFn(extraArgs.propsToMatch, 'url');
    self.XMLHttpRequest = class extends self.XMLHttpRequest {
        open(method, url, ...args) {
            const xhrDetails = { method, url };
            const matched = propNeedles.size === 0 ||
                matchObjectPropertiesFn(propNeedles, xhrDetails);
            if ( matched ) {
                if ( safe.logLevel > 1 && Array.isArray(matched) ) {
                    safe.uboLog(logPrefix, `Matched "propsToMatch":\n\t${matched.join('\n\t')}`);
                }
                xhrInstances.set(this, xhrDetails);
            }
            return super.open(method, url, ...args);
        }
        get response() {
            const innerResponse = super.response;
            const xhrDetails = xhrInstances.get(this);
            if ( xhrDetails === undefined ) {
                return innerResponse;
            }
            const responseLength = typeof innerResponse === 'string'
                ? innerResponse.length
                : undefined;
            if ( xhrDetails.lastResponseLength !== responseLength ) {
                xhrDetails.response = undefined;
                xhrDetails.lastResponseLength = responseLength;
            }
            if ( xhrDetails.response !== undefined ) {
                return xhrDetails.response;
            }
            if ( typeof innerResponse !== 'string' ) {
                return (xhrDetails.response = innerResponse);
            }
            const outerResponse = jsonlPruneFn(innerResponse, rawPrunePaths, rawNeedlePaths);
            if ( outerResponse !== innerResponse ) {
                safe.uboLog(logPrefix, 'Pruned');
            }
            return (xhrDetails.response = outerResponse);
        }
        get responseText() {
            const response = this.response;
            return typeof response !== 'string'
                ? super.responseText
                : response;
        }
    };
}
registerScriptlet(jsonlPruneXhrResponseFn, {
    name: 'jsonl-prune-xhr-response.fn',
    dependencies: [
        jsonlPruneFn,
        matchObjectPropertiesFn,
        parsePropertiesToMatchFn,
        safeSelf,
    ],
});

/******************************************************************************/

function jsonlPruneXhrResponse(...args) {
    jsonlPruneXhrResponseFn(...args);
}
registerScriptlet(jsonlPruneXhrResponse, {
    name: 'jsonl-prune-xhr-response.js',
    dependencies: [
        jsonlPruneXhrResponseFn,
    ],
});

/******************************************************************************/

/**
 * @scriptlet jsonl-prune-fetch-response.js
 * 
 * @description
 * Prune the objects found in a JSONL resource fetched through the fetch API.
 * Once the pruning is performed.
 * 
 * @param rawPrunePaths
 * The property to remove from the objects.
 * 
 * @param rawNeedlePaths
 * A property which must be present for the pruning to take effect.
 * 
 * @param [propsToMatch, value]
 * An optional vararg detailing the arguments to match when xhr.open() is
 * called.
 * 
 * */

function jsonlPruneFetchResponseFn(
    rawPrunePaths = '',
    rawNeedlePaths = ''
) {
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('jsonl-prune-fetch-response', rawPrunePaths, rawNeedlePaths);
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 2);
    const propNeedles = parsePropertiesToMatchFn(extraArgs.propsToMatch, 'url');
    const logall = rawPrunePaths === '';
    const applyHandler = function(target, thisArg, args) {
        const fetchPromise = Reflect.apply(target, thisArg, args);
        if ( propNeedles.size !== 0 ) {
            const objs = [ args[0] instanceof Object ? args[0] : { url: args[0] } ];
            if ( objs[0] instanceof Request ) {
                try {
                    objs[0] = safe.Request_clone.call(objs[0]);
                } catch(ex) {
                    safe.uboErr(logPrefix, 'Error:', ex);
                }
            }
            if ( args[1] instanceof Object ) {
                objs.push(args[1]);
            }
            const matched = matchObjectPropertiesFn(propNeedles, ...objs);
            if ( matched === undefined ) { return fetchPromise; }
            if ( safe.logLevel > 1 ) {
                safe.uboLog(logPrefix, `Matched "propsToMatch":\n\t${matched.join('\n\t')}`);
            }
        }
        return fetchPromise.then(responseBefore => {
            const response = responseBefore.clone();
            return response.text().then(textBefore => {
                if ( typeof textBefore !== 'string' ) { return textBefore; }
                if ( logall ) {
                    safe.uboLog(logPrefix, textBefore);
                    return responseBefore;
                }
                const textAfter = jsonlPruneFn(textBefore, rawPrunePaths, rawNeedlePaths);
                if ( textAfter === textBefore ) { return responseBefore; }
                safe.uboLog(logPrefix, 'Pruned');
                const responseAfter = new Response(textAfter, {
                    status: responseBefore.status,
                    statusText: responseBefore.statusText,
                    headers: responseBefore.headers,
                });
                Object.defineProperties(responseAfter, {
                    ok: { value: responseBefore.ok },
                    redirected: { value: responseBefore.redirected },
                    type: { value: responseBefore.type },
                    url: { value: responseBefore.url },
                });
                return responseAfter;
            }).catch(reason => {
                safe.uboErr(logPrefix, 'Error:', reason);
                return responseBefore;
            });
        }).catch(reason => {
            safe.uboErr(logPrefix, 'Error:', reason);
            return fetchPromise;
        });
    };
    self.fetch = new Proxy(self.fetch, {
        apply: applyHandler
    });
}
registerScriptlet(jsonlPruneFetchResponseFn, {
    name: 'jsonl-prune-fetch-response.fn',
    dependencies: [
        jsonlPruneFn,
        matchObjectPropertiesFn,
        parsePropertiesToMatchFn,
        safeSelf,
    ],
});

/******************************************************************************/

function jsonlPruneFetchResponse(...args) {
    jsonlPruneFetchResponseFn(...args);
}
registerScriptlet(jsonlPruneFetchResponse, {
    name: 'jsonl-prune-fetch-response.js',
    dependencies: [
        jsonlPruneFetchResponseFn,
    ],
});

/******************************************************************************/
