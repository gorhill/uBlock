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

import { JSONPath } from './shared.js';
import { proxyApplyFn } from './proxy-apply.js';
import { registerScriptlet } from './base.js';
import { safeSelf } from './safe-self.js';

/******************************************************************************/

function jsonEditFn(trusted, jsonq = '') {
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix(
        `${trusted ? 'trusted-' : ''}json-edit`,
        jsonq
    );
    const jsonp = JSONPath.create(jsonq);
    if ( jsonp.valid === false || jsonp.value !== undefined && trusted !== true ) {
        return safe.uboLog(logPrefix, 'Bad JSONPath query');
    }
    proxyApplyFn('JSON.parse', function(context) {
        const obj = context.reflect();
        if ( jsonp.apply(obj) !== 0 ) { return obj; }
        safe.uboLog(logPrefix, 'Edited');
        if ( safe.logLevel > 1 ) {
            safe.uboLog(logPrefix, `After edit:\n${safe.JSON_stringify(obj, null, 2)}`);
        }
        return obj;
    });
}
registerScriptlet(jsonEditFn, {
    name: 'json-edit.fn',
    dependencies: [
        JSONPath,
        proxyApplyFn,
        safeSelf,
    ],
});

/******************************************************************************/
/**
 * @scriptlet json-edit.js
 * 
 * @description
 * Edit object generated through JSON.parse().
 * Properties can only be removed.
 * 
 * @param jsonq
 * A uBO-flavored JSONPath query.
 * 
 * */

function jsonEdit(jsonq = '') {
    jsonEditFn(false, jsonq);
}
registerScriptlet(jsonEdit, {
    name: 'json-edit.js',
    dependencies: [
        jsonEditFn,
    ],
});

/******************************************************************************/
/**
 * @scriptlet trusted-json-edit.js
 * 
 * @description
 * Edit object generated through JSON.parse().
 * Properties can be assigned new values.
 * 
 * @param jsonq
 * A uBO-flavored JSONPath query.
 * 
 * */

function trustedJsonEdit(jsonq = '') {
    jsonEditFn(true, jsonq);
}
registerScriptlet(trustedJsonEdit, {
    name: 'trusted-json-edit.js',
    requiresTrust: true,
    dependencies: [
        jsonEditFn,
    ],
});

/******************************************************************************/
/******************************************************************************/

function jsonEditXhrResponseFn(trusted, jsonq = '') {
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix(
        `${trusted ? 'trusted-' : ''}json-edit-xhr-response`,
        jsonq
    );
    const xhrInstances = new WeakMap();
    const jsonp = JSONPath.create(jsonq);
    if ( jsonp.valid === false || jsonp.value !== undefined && trusted !== true ) {
        return safe.uboLog(logPrefix, 'Bad JSONPath query');
    }
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
            if ( xhrDetails === undefined ) { return innerResponse; }
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
            let obj;
            if ( typeof innerResponse === 'object' ) {
                obj = innerResponse;
            } else if ( typeof innerResponse === 'string' ) {
                try { obj = safe.JSON_parse(innerResponse); } catch { }
            }
            if ( typeof obj !== 'object' || obj === null || jsonp.apply(obj) === 0 ) {
                return (xhrDetails.response = innerResponse);
            }
            safe.uboLog(logPrefix, 'Edited');
            const outerResponse = typeof innerResponse === 'string'
                ? JSONPath.toJSON(obj, safe.JSON_stringify)
                : obj;
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
registerScriptlet(jsonEditXhrResponseFn, {
    name: 'json-edit-xhr-response.fn',
    dependencies: [
        JSONPath,
        matchObjectPropertiesFn,
        parsePropertiesToMatchFn,
        safeSelf,
    ],
});

/******************************************************************************/
/**
 * @scriptlet json-edit-xhr-response.js
 * 
 * @description
 * Edit the object fetched through a XHR instance.
 * Properties can only be removed.
 * 
 * @param jsonq
 * A uBO-flavored JSONPath query.
 * 
 * @param [propsToMatch, value]
 * An optional vararg detailing the arguments to match when xhr.open() is
 * called.
 * 
 * */

function jsonEditXhrResponse(jsonq = '', ...args) {
    jsonEditXhrResponseFn(false, jsonq, ...args);
}
registerScriptlet(jsonEditXhrResponse, {
    name: 'json-edit-xhr-response.js',
    dependencies: [
        jsonEditXhrResponseFn,
    ],
});

/******************************************************************************/
/**
 * @scriptlet trusted-json-edit-xhr-response.js
 * 
 * @description
 * Edit the object fetched through a XHR instance.
 * Properties can be assigned new values.
 * 
 * @param jsonq
 * A uBO-flavored JSONPath query.
 * 
 * @param [propsToMatch, value]
 * An optional vararg detailing the arguments to match when xhr.open() is
 * called.
 * 
 * */

function trustedJsonEditXhrResponse(jsonq = '', ...args) {
    jsonEditXhrResponseFn(true, jsonq, ...args);
}
registerScriptlet(trustedJsonEditXhrResponse, {
    name: 'trusted-json-edit-xhr-response.js',
    requiresTrust: true,
    dependencies: [
        jsonEditXhrResponseFn,
    ],
});

/******************************************************************************/
/******************************************************************************/

function jsonEditFetchResponseFn(trusted, jsonq = '') {
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix(
        `${trusted ? 'trusted-' : ''}json-edit-fetch-response`,
        jsonq
    );
    const jsonp = JSONPath.create(jsonq);
    if ( jsonp.valid === false || jsonp.value !== undefined && trusted !== true ) {
        return safe.uboLog(logPrefix, 'Bad JSONPath query');
    }
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 2);
    const propNeedles = parsePropertiesToMatchFn(extraArgs.propsToMatch, 'url');
    proxyApplyFn('fetch', function(context) {
        const args = context.callArgs;
        const fetchPromise = context.reflect();
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
            return response.json().then(obj => {
                if ( typeof obj !== 'object' ) { return responseBefore; }
                if ( jsonp.apply(obj) === 0 ) { return responseBefore; }
                safe.uboLog(logPrefix, 'Edited');
                const responseAfter = Response.json(obj, {
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
    });
}
registerScriptlet(jsonEditFetchResponseFn, {
    name: 'json-edit-fetch-response.fn',
    dependencies: [
        JSONPath,
        matchObjectPropertiesFn,
        parsePropertiesToMatchFn,
        proxyApplyFn,
        safeSelf,
    ],
});

/******************************************************************************/
/**
 * @scriptlet json-edit-fetch-response.js
 * 
 * @description
 * Edit the object fetched through the fetch API.
 * Properties can only be removed.
 * 
 * @param jsonq
 * A uBO-flavored JSONPath query.
 * 
 * @param [propsToMatch, value]
 * An optional vararg detailing the arguments to match when xhr.open() is
 * called.
 * 
 * */

function jsonEditFetchResponse(jsonq = '', ...args) {
    jsonEditFetchResponseFn(false, jsonq, ...args);
}
registerScriptlet(jsonEditFetchResponse, {
    name: 'json-edit-fetch-response.js',
    dependencies: [
        jsonEditFetchResponseFn,
    ],
});

/******************************************************************************/
/**
 * @scriptlet trusted-json-edit-fetch-response.js
 * 
 * @description
 * Edit the object fetched through the fetch API. The trusted version allows
 * Properties can be assigned new values.
 * 
 * @param jsonq
 * A uBO-flavored JSONPath query.
 * 
 * @param [propsToMatch, value]
 * An optional vararg detailing the arguments to match when xhr.open() is
 * called.
 * 
 * */

function trustedJsonEditFetchResponse(jsonq = '', ...args) {
    jsonEditFetchResponseFn(true, jsonq, ...args);
}
registerScriptlet(trustedJsonEditFetchResponse, {
    name: 'trusted-json-edit-fetch-response.js',
    requiresTrust: true,
    dependencies: [
        jsonEditFetchResponseFn,
    ],
});

/******************************************************************************/
/******************************************************************************/

function jsonlEditFn(jsonp, text = '') {
    const safe = safeSelf();
    const linesBefore = text.split(/\n+/);
    const linesAfter = [];
    for ( const lineBefore of linesBefore ) {
        let obj;
        try { obj = safe.JSON_parse(lineBefore); } catch { }
        if ( typeof obj !== 'object' || obj === null ) {
            linesAfter.push(lineBefore);
            continue;
        }
        if ( jsonp.apply(obj) === 0 ) {
            linesAfter.push(lineBefore);
            continue;
        }
        linesAfter.push(JSONPath.toJSON(obj, safe.JSON_stringify));
    }
    return linesAfter.join('\n');
}
registerScriptlet(jsonlEditFn, {
    name: 'jsonl-edit.fn',
    dependencies: [
        JSONPath,
        safeSelf,
    ],
});

/******************************************************************************/

function jsonlEditXhrResponseFn(trusted, jsonq = '') {
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix(
        `${trusted ? 'trusted-' : ''}jsonl-edit-xhr-response`,
        jsonq
    );
    const xhrInstances = new WeakMap();
    const jsonp = JSONPath.create(jsonq);
    if ( jsonp.valid === false || jsonp.value !== undefined && trusted !== true ) {
        return safe.uboLog(logPrefix, 'Bad JSONPath query');
    }
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
            const outerResponse = jsonlEditFn(jsonp, innerResponse);
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
registerScriptlet(jsonlEditXhrResponseFn, {
    name: 'jsonl-edit-xhr-response.fn',
    dependencies: [
        JSONPath,
        jsonlEditFn,
        matchObjectPropertiesFn,
        parsePropertiesToMatchFn,
        safeSelf,
    ],
});

/******************************************************************************/
/**
 * @scriptlet jsonl-edit-xhr-response.js
 * 
 * @description
 * Edit the objects found in a JSONL resource fetched through a XHR instance.
 * Properties can only be removed.
 * 
 * @param jsonq
 * A uBO-flavored JSONPath query.
 * 
 * @param [propsToMatch, value]
 * An optional vararg detailing the arguments to match when xhr.open() is
 * called.
 * 
 * */

function jsonlEditXhrResponse(jsonq = '', ...args) {
    jsonlEditXhrResponseFn(false, jsonq, ...args);
}
registerScriptlet(jsonlEditXhrResponse, {
    name: 'jsonl-edit-xhr-response.js',
    dependencies: [
        jsonlEditXhrResponseFn,
    ],
});

/******************************************************************************/
/**
 * @scriptlet trusted-jsonl-edit-xhr-response.js
 * 
 * @description
 * Edit the objects found in a JSONL resource fetched through a XHR instance.
 * Properties can be assigned new values.
 * 
 * @param jsonq
 * A uBO-flavored JSONPath query.
 * 
 * @param [propsToMatch, value]
 * An optional vararg detailing the arguments to match when xhr.open() is
 * called.
 * 
 * */

function trustedJsonlEditXhrResponse(jsonq = '', ...args) {
    jsonlEditXhrResponseFn(true, jsonq, ...args);
}
registerScriptlet(trustedJsonlEditXhrResponse, {
    name: 'trusted-jsonl-edit-xhr-response.js',
    requiresTrust: true,
    dependencies: [
        jsonlEditXhrResponseFn,
    ],
});

/******************************************************************************/
/******************************************************************************/

function jsonlEditFetchResponseFn(trusted, jsonq = '') {
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix(
        `${trusted ? 'trusted-' : ''}jsonl-edit-fetch-response`,
        jsonq
    );
    const jsonp = JSONPath.create(jsonq);
    if ( jsonp.valid === false || jsonp.value !== undefined && trusted !== true ) {
        return safe.uboLog(logPrefix, 'Bad JSONPath query');
    }
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 2);
    const propNeedles = parsePropertiesToMatchFn(extraArgs.propsToMatch, 'url');
    const logall = jsonq === '';
    proxyApplyFn('fetch', function(context) {
        const args = context.callArgs;
        const fetchPromise = context.reflect();
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
                const textAfter = jsonlEditFn(jsonp, textBefore);
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
    });
}
registerScriptlet(jsonlEditFetchResponseFn, {
    name: 'jsonl-edit-fetch-response.fn',
    dependencies: [
        JSONPath,
        jsonlEditFn,
        matchObjectPropertiesFn,
        parsePropertiesToMatchFn,
        proxyApplyFn,
        safeSelf,
    ],
});

/******************************************************************************/
/**
 * @scriptlet jsonl-edit-fetch-response.js
 * 
 * @description
 * Edit the objects found in a JSONL resource fetched through the fetch API.
 * Properties can only be removed.
 * 
 * @param jsonq
 * A uBO-flavored JSONPath query.
 * 
 * @param [propsToMatch, value]
 * An optional vararg detailing the arguments to match when xhr.open() is
 * called.
 * 
 * */

function jsonlEditFetchResponse(jsonq = '', ...args) {
    jsonlEditFetchResponseFn(false, jsonq, ...args);
}
registerScriptlet(jsonlEditFetchResponse, {
    name: 'jsonl-edit-fetch-response.js',
    dependencies: [
        jsonlEditFetchResponseFn,
    ],
});

/******************************************************************************/
/**
 * @scriptlet trusted-jsonl-edit-fetch-response.js
 * 
 * @description
 * Edit the objects found in a JSONL resource fetched through the fetch API.
 * Properties can be assigned new values.
 * 
 * @param jsonq
 * A uBO-flavored JSONPath query.
 * 
 * @param [propsToMatch, value]
 * An optional vararg detailing the arguments to match when xhr.open() is
 * called.
 * 
 * */

function trustedJsonlEditFetchResponse(jsonq = '', ...args) {
    jsonlEditFetchResponseFn(true, jsonq, ...args);
}
registerScriptlet(trustedJsonlEditFetchResponse, {
    name: 'trusted-jsonl-edit-fetch-response.js',
    requiresTrust: true,
    dependencies: [
        jsonlEditFetchResponseFn,
    ],
});

/******************************************************************************/
