/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2026-present Fanboynz

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

    Surrogate for the Google Funding Choices loader served from
    fundingchoicesmessages.google.com/i/pub-<id>, and for the message and
    telemetry scripts under /f/ and /b/ on the same host.

    That loader is also the page's IAB TCF CMP, which is why blocking the host
    outright carries a cost: anything waiting on __tcfapi waits forever, and
    gpt.js and adsbygoogle.js fall back to reading consent out of the FCCDCF
    cookie. This answers instead of storing.

      __tcfapi v2        ping, getTCData, addEventListener and
                         removeEventListener, the __tcfapiLocator frame and
                         the postMessage bridge. The TC string is a real v2
                         string with every purpose, special feature, vendor
                         and publisher bit at zero: cmpId 300, GVL 179,
                         policy 5, publisher country AA, and timestamps
                         pinned to midnight UTC so a reload does not mint a
                         new one. gdprApplies stays true, because answering
                         false would tell every vendor on the page it may
                         proceed without asking.
      __uspapi           1-Y- where Global Privacy Control is set, 1---
                         otherwise, which is the string Google's own scripts
                         default to when no CMP is present.
      googlefc           the callbackQueue with their queue semantics,
                         including adopting an array a page parked before
                         document_start; getConsentStatus NO_CONSENT; the ad
                         blocker, whitelist and allow ads statuses UNKNOWN;
                         getGoogleConsentModeValues with all four purposes
                         DENIED; and the five enum tables a publisher script
                         reads those values against.

    Nothing is stored. FCCDCF is deleted on the host and on every parent
    suffix and never rewritten, and no euconsent-v2 or IABTCF_ key is
    written, because theirs does not write either. Where the page or another
    CMP already owns an API, that owner is left alone.

    Built from src/fundingchoices/ in https://github.com/ryanbr/consent-rr,
    which carries the commented source and the tests. The body below is that
    repo's single-file build, which is the artefact those tests run against.

*/

(function() {
    'use strict';
function consentRRFundingChoices(installTcf, installUsp, installPage) {
    const w = window;
    const doc = w.document;
    const VERSION = '1.1.8';
    const NAME = 'fundingchoices-reject';
    const COOKIE = 'FCCDCF';
    const COMMANDS = [ 'loaded', 'prov' ];
    const FRAMES = [ 'googlefcInactive', 'googlefcLoaded' ];
    const ANSWER = '[null,[4]]';
    const UNKNOWN = '[null,[2]]';
    const noopfn = function() {
    }.bind();
    const googlefc = typeof w.googlefc === 'object' && w.googlefc !== null
        ? w.googlefc
        : {};
    w.googlefc = googlefc;
    if ( googlefc.consentRR !== undefined ) { return; }
    const domains = ( ) => {
        const host = String(w.location.hostname || '');
        if ( /^[0-9.]+$/.test(host) || host.indexOf('.') === -1 ) { return []; }
        const labels = host.split('.');
        const out = [];
        for ( let at = 0; at < labels.length - 1; at += 1 ) {
            out.push(labels.slice(at).join('.'));
        }
        return out;
    };
    let cleared = 0;
    const clearCookie = name => {
        const had = String(doc.cookie || '').split(';').some(
            part => part.trim().indexOf(name + '=') === 0
        );
        if ( had === false ) { return; }
        const gone = '=; expires=Thu, 01 Jan 1970 00:00:01 GMT';
        for ( const path of [ '/', w.location.pathname ] ) {
            try {
                doc.cookie = name + gone + '; path=' + path;
            } catch ( ex ) {
            }
            for ( const domain of domains() ) {
                try {
                    doc.cookie = name + gone + '; path=' + path +
                        '; domain=' + domain;
                    doc.cookie = name + gone + '; path=' + path +
                        '; domain=.' + domain;
                } catch ( ex ) {
                }
            }
        }
        cleared += 1;
    };
    const manager = {
        error: true,
        setError: function() {
            this.error = true;
        },
        setCmpModeObject: noopfn,
        setExperimentsObject: noopfn,
        getSerializedReturnMessageForCommand: function() {
            return this.error ? ANSWER : UNKNOWN;
        },
        getSerializedReturnMessageForInvalidCommand: ( ) => UNKNOWN,
    };
    if ( typeof w.__fcInternalApiManager === 'undefined' ) {
        w.__fcInternalApiManager = manager;
    }
    let answered = 0;
    const answer = (command, entry) => {
        const callback = entry !== null && typeof entry === 'object' &&
            typeof entry.cb === 'function'
            ? entry.cb
            : entry;
        if ( typeof callback !== 'function' ) { return; }
        try {
            callback(COMMANDS.includes(command) ? ANSWER : UNKNOWN);
            answered += 1;
        } catch ( ex ) {
        }
    };
    const standing = Array.isArray(googlefc.__fci) ? googlefc.__fci : [];
    const queue = {};
    queue.push = (command, entry) => {
        answer(command, entry);
        return answered;
    };
    queue.executeCommandType = ( ) => answered;
    queue.executeAllRemainingCommands = ( ) => answered;
    if ( standing.length % 2 === 0 ) {
        for ( let at = 0; at < standing.length - 1; at += 2 ) {
            if ( typeof standing[at] !== 'string' ) { continue; }
            answer(standing[at], standing[at + 1]);
        }
    }
    googlefc.__fci = queue;
    let replied = 0;
    if ( w.__fcInternalApiPostMessageReady !== true ) {
        w.addEventListener('message', event => {
            try {
                const data = event.data;
                if ( data === null || typeof data !== 'object' ) { return; }
                const call = data.__fciCall;
                if ( call === null || typeof call !== 'object' ) { return; }
                if ( COMMANDS.includes(call.command) === false ) { return; }
                if ( typeof call.callId !== 'number' ) { return; }
                if ( call.spsp !== undefined &&
                     typeof call.spsp !== 'string' ) { return; }
                const source = event.source;
                if ( source === null || source === undefined ) { return; }
                if ( typeof source.postMessage !== 'function' ) { return; }
                source.postMessage({
                    __fciReturn: '[' + call.callId + ',[4]]',
                }, event.origin);
                replied += 1;
            } catch ( ex ) {
            }
        });
        w.__fcInternalApiPostMessageReady = true;
    }
    const target = ( ) => {
        try {
            if ( w.top.document ) { return w.top.document; }
        } catch ( ex ) {
        }
        return doc;
    };
    const where = target();
    const bodyWaiter = which => {
        const pending = [];
        const again = ( ) => {
            if ( which.body === null ) {
                w.setTimeout(again, 5);
                return;
            }
            for ( const fn of pending.splice(0) ) {
                try {
                    fn();
                } catch ( ex ) {
                }
            }
        };
        return fn => {
            if ( which.body !== null ) {
                fn();
                return;
            }
            if ( pending.length === 0 ) { w.setTimeout(again, 5); }
            pending.push(fn);
        };
    };
    const waitForFrames = bodyWaiter(where);
    const waitHere = where === doc ? waitForFrames : bodyWaiter(doc);
    let framed = 0;
    const addFrame = name => {
        for ( const node of where.getElementsByTagName('IFRAME') ) {
            if ( node.name === name ) { return; }
        }
        const frame = where.contentType === 'application/xhtml+xml'
            ? where.createElement('iframe')
            : where.createElement('IFRAME');
        frame.name = name;
        frame.src = 'about:blank';
        frame.style.display = 'none';
        frame.style.width = '0px';
        frame.style.height = '0px';
        frame.style.border = 'none';
        frame.style.zIndex = '-1000';
        frame.style.left = '-1000px';
        frame.style.top = '-1000px';
        waitForFrames(( ) => { where.body.appendChild(frame); });
        framed += 1;
    };
    for ( const name of FRAMES ) {
        try {
            addFrame(name);
        } catch ( ex ) {
        }
    }
    clearCookie(COOKIE);
    let tcf = 'absent';
    if ( typeof installTcf === 'function' ) {
        try {
            tcf = installTcf(waitHere).install() ? 'refused' : 'theirs';
        } catch ( ex ) {
            tcf = 'failed';
        }
    }
    let usp = 'absent';
    if ( typeof installUsp === 'function' ) {
        try {
            const api = installUsp(waitHere);
            usp = api.install() ? api.uspString : 'theirs';
        } catch ( ex ) {
            usp = 'failed';
        }
    }
    let queued = 'absent';
    if ( typeof installPage === 'function' ) {
        try {
            queued = installPage(waitHere).install(googlefc);
        } catch ( ex ) {
            queued = 'failed';
        }
    }
    googlefc.consentRR = { name: NAME, version: VERSION };
    if ( typeof console === 'object' && typeof console.info === 'function' ) {
        console.info(
            '[consent-rr] ' + NAME + ' ' + VERSION +
            ' frames=' + framed +
            ' answered=' + answered +
            ' replied=' + replied +
            ' cleared=' + cleared +
            ' tcf=' + tcf +
            ' usp=' + usp +
            ' queued=' + queued
        );
    }
}
function consentRRFundingChoicesTcf(whenBody) {
    const w = window;
    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const CMP_ID = 300;
    const CMP_VERSION = 1;
    const VENDOR_LIST_VERSION = 179;
    const POLICY_VERSION = 5;
    const PUBLISHER_CC = 'AA';
    const language = ( ) => {
        const doc = w.document;
        const named = doc.documentElement !== null
            ? doc.documentElement.getAttribute('lang')
            : '';
        const text = String(named || w.navigator.language || '').toUpperCase();
        const match = /[A-Z]{2}/.exec(text);
        return match !== null ? match[0] : 'EN';
    };
    const consentLanguage = language();
    const bitWriter = ( ) => {
        const chunks = [];
        const push = (value, width) => {
            let text = Math.max(0, Math.floor(value)).toString(2);
            if ( text.length > width ) { text = text.slice(-width); }
            chunks.push(text.padStart(width, '0'));
        };
        const pushLetters = letters => {
            for ( const letter of letters ) {
                push(letter.charCodeAt(0) - 65, 6);
            }
        };
        const pushFlags = (ids, width) => {
            let text = '';
            for ( let position = 1; position <= width; position++ ) {
                text += ids.indexOf(position) !== -1 ? '1' : '0';
            }
            chunks.push(text);
        };
        const pushNoVendors = ( ) => {
            push(0, 16);                // max vendor id, so nothing follows
            push(0, 1);                 // bit field encoding, of width zero
        };
        const toString = ( ) => {
            let stream = chunks.join('');
            while ( stream.length % 6 !== 0 ) { stream += '0'; }
            let out = '';
            for ( let i = 0; i < stream.length; i += 6 ) {
                out += B64.charAt(parseInt(stream.slice(i, i + 6), 2));
            }
            return out;
        };
        return { push, pushLetters, pushFlags, pushNoVendors, toString };
    };
    const now = new Date();
    const midnight = Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()
    );
    const encodeCoreString = ( ) => {
        const {
            push, pushLetters, pushFlags, pushNoVendors, toString,
        } = bitWriter();
        push(2, 6);                     // TC string version
        push(midnight / 100, 36);       // created
        push(midnight / 100, 36);       // last updated
        push(CMP_ID, 12);
        push(CMP_VERSION, 12);
        push(0, 6);                     // consent screen
        pushLetters(consentLanguage);
        push(VENDOR_LIST_VERSION, 12);
        push(POLICY_VERSION, 6);
        push(1, 1);                     // service specific
        push(0, 1);                     // standard stacks and texts
        pushFlags([], 12);              // special features: none opted into
        pushFlags([], 24);              // purpose consents: none
        pushFlags([], 24);              // purpose legitimate interests: none
        push(0, 1);                     // purpose one treatment
        pushLetters(PUBLISHER_CC);
        pushNoVendors();                // vendor consents: none
        pushNoVendors();                // vendor legitimate interests: none
        push(0, 12);                    // publisher restrictions: none
        return toString();
    };
    const encodePublisherSegment = ( ) => {
        const { push, pushFlags, toString } = bitWriter();
        push(3, 3);                     // segment type
        pushFlags([], 24);              // publisher consents: none
        pushFlags([], 24);              // publisher legitimate interests: none
        push(0, 6);                     // no custom purposes
        return toString();
    };
    const tcString = encodeCoreString() + '.' + encodePublisherSegment();
    const flags = count => {
        const out = {};
        for ( let id = 1; id <= count; id++ ) { out[id] = false; }
        return out;
    };
    const tcData = ( ) => ({
        tcString,
        tcfPolicyVersion: POLICY_VERSION,
        cmpId: CMP_ID,
        cmpVersion: CMP_VERSION,
        gdprApplies: true,
        eventStatus: 'tcloaded',
        cmpStatus: 'loaded',
        isServiceSpecific: true,
        useNonStandardTexts: false,
        publisherCC: PUBLISHER_CC,
        purposeOneTreatment: false,
        outOfBand: { allowedVendors: {}, disclosedVendors: {} },
        purpose: { consents: flags(11), legitimateInterests: flags(11) },
        vendor: { consents: {}, legitimateInterests: {} },
        specialFeatureOptins: flags(12),
        publisher: {
            consents: flags(24),
            legitimateInterests: flags(24),
            customPurpose: { consents: {}, legitimateInterests: {} },
            restrictions: {},
        },
    });
    const install = ( ) => {
        const doc = w.document;
        const listeners = new Map();
        let nextId = 0;
        const api = (command, version, callback, parameter) => {
            if ( typeof callback !== 'function' ) { return; }
            if ( command === 'ping' ) {
                callback({
                    gdprApplies: true,
                    cmpLoaded: true,
                    cmpStatus: 'loaded',
                    displayStatus: 'hidden',
                    apiVersion: '2',
                    cmpVersion: CMP_VERSION,
                    cmpId: CMP_ID,
                    gvlVersion: VENDOR_LIST_VERSION,
                    tcfPolicyVersion: POLICY_VERSION,
                }, true);
                return;
            }
            if ( command === 'getTCData' ) {
                callback(tcData(), true);
                return;
            }
            if ( command === 'addEventListener' ) {
                nextId += 1;
                listeners.set(nextId, callback);
                const data = tcData();
                data.listenerId = nextId;
                callback(data, true);
                return;
            }
            if ( command === 'removeEventListener' ) {
                const existed = listeners.delete(parameter);
                callback(existed, existed);
                return;
            }
            callback(null, false);
        };
        let queued = [];
        try {
            const stub = w.__tcfapi;
            if ( typeof stub === 'function' ) {
                const parked = stub();
                if ( Array.isArray(parked) ) { queued = parked.slice(); }
            }
        } catch ( ex ) {
        }
        try {
            w.__tcfapi = api;
        } catch ( ex ) {
            return false;
        }
        if ( w.__tcfapi !== api ) { return false; }
        for ( const call of queued ) {
            if ( Array.isArray(call) === false ) { continue; }
            try {
                api(call[0], call[1], call[2], call[3]);
            } catch ( ex ) {
            }
        }
        const addLocator = ( ) => {
            try {
                if ( w.frames.__tcfapiLocator !== undefined ) { return; }
                if ( doc.body === null ) {
                    w.setTimeout(addLocator, 5);
                    return;
                }
                const frame = doc.createElement('iframe');
                frame.style.cssText = 'display:none';
                frame.name = '__tcfapiLocator';
                doc.body.appendChild(frame);
            } catch ( ex ) {
            }
        };
        if ( typeof whenBody === 'function' ) {
            whenBody(addLocator);
        } else {
            addLocator();
        }
        w.addEventListener('message', ev => {
            let payload = ev.data;
            let wasString = false;
            if ( typeof payload === 'string' ) {
                if ( payload.indexOf('__tcfapiCall') === -1 ) { return; }
                try {
                    payload = JSON.parse(payload);
                    wasString = true;
                } catch ( ex ) {
                    return;
                }
            }
            if ( typeof payload !== 'object' || payload === null ) { return; }
            const call = payload.__tcfapiCall;
            if ( typeof call !== 'object' || call === null ) { return; }
            if ( call.callId === undefined ) { return; }
            if ( ev.source === null || ev.source === undefined ) { return; }
            api(call.command, call.version, (returnValue, success) => {
                let response = {
                    __tcfapiReturn: {
                        returnValue,
                        success,
                        callId: call.callId,
                    },
                };
                if ( wasString ) { response = JSON.stringify(response); }
                try {
                    ev.source.postMessage(
                        response,
                        ev.origin === 'null' ? '*' : ev.origin
                    );
                } catch ( ex ) {
                }
            }, call.parameter);
        });
        return true;
    };
    return { tcString, cmpId: CMP_ID, publisherCC: PUBLISHER_CC, install };
}
function consentRRFundingChoicesUsp(whenBody) {
    const w = window;
    const gpc = ( ) => {
        try {
            return w.navigator.globalPrivacyControl === true;
        } catch ( ex ) {
        }
        return false;
    };
    const uspString = '1-' + (gpc() ? 'Y' : '-') + '-';
    const install = ( ) => {
        const doc = w.document;
        try {
            const standing = typeof w.__uspapi === 'function' ||
                w.frames.__uspapiLocator !== undefined;
            if ( standing && w.__uspapiManager !== 'fc' ) { return false; }
        } catch ( ex ) {
        }
        const api = (command, version, callback) => {
            if ( typeof callback !== 'function' ) { return; }
            if ( version !== undefined && version !== null &&
                 Number(version) !== 1 ) {
                callback(null, false);
                return;
            }
            if ( command !== 'getUSPData' ) { return; }
            callback({ version: 1, uspString }, true);
        };
        try {
            w.__uspapi = api;
        } catch ( ex ) {
            return false;
        }
        if ( w.__uspapi !== api ) { return false; }
        const addLocator = ( ) => {
            try {
                if ( w.frames.__uspapiLocator !== undefined ) { return; }
                if ( doc.body === null ) {
                    w.setTimeout(addLocator, 5);
                    return;
                }
                const frame = doc.createElement('iframe');
                frame.style.cssText = 'display:none';
                frame.name = '__uspapiLocator';
                doc.body.appendChild(frame);
            } catch ( ex ) {
            }
        };
        if ( typeof whenBody === 'function' ) {
            whenBody(addLocator);
        } else {
            addLocator();
        }
        w.addEventListener('message', ev => {
            let payload = ev.data;
            let wasString = false;
            if ( typeof payload === 'string' ) {
                if ( payload.indexOf('__uspapiCall') === -1 ) { return; }
                try {
                    payload = JSON.parse(payload);
                    wasString = true;
                } catch ( ex ) {
                    return;
                }
            }
            if ( typeof payload !== 'object' || payload === null ) { return; }
            const call = payload.__uspapiCall;
            if ( typeof call !== 'object' || call === null ) { return; }
            if ( call.callId === undefined ) { return; }
            if ( ev.source === null || ev.source === undefined ) { return; }
            api(call.command, call.version, (returnValue, success) => {
                let response = {
                    __uspapiReturn: {
                        returnValue,
                        success,
                        callId: call.callId,
                    },
                };
                if ( wasString ) { response = JSON.stringify(response); }
                try {
                    ev.source.postMessage(
                        response,
                        ev.origin === 'null' ? '*' : ev.origin
                    );
                } catch ( ex ) {
                }
            });
        });
        try {
            w.__uspapiPostMessageReady = true;
        } catch ( ex ) {
        }
        return true;
    };
    return { uspString, install };
}
function consentRRFundingChoicesPage(whenBody) {
    const KEYS = [
        [ 'adBlockData', 'AD_BLOCK_DATA_READY' ],
        [ 'consentData', 'CONSENT_DATA_READY' ],
        [ 'initialCcpaData', 'INITIAL_CCPA_DATA_READY' ],
        [ 'consentApi', 'CONSENT_API_READY' ],
        [ 'initialUsStatesData', 'INITIAL_US_STATES_DATA_READY' ],
        [ 'initialUsStatesOptOutData',
            'INITIAL_US_STATES_OPT_OUT_DATA_READY' ],
        [ 'consentModeData', 'CONSENT_MODE_DATA_READY' ],
        [ 'manualDeploymentApi', 'MANUAL_DEPLOYMENT_API_READY' ],
    ];
    const ENUMS = {
        ConsentStatusEnum: {
            UNKNOWN: 0,
            CONSENTED_TO_PERSONALIZED_ADS: 1,
            CONSENTED_TO_NON_PERSONALIZED_ADS: 2,
            CONTRIBUTOR: 3,
            NO_CONSENT: 4,
            CONSENT_NOT_REQUIRED: 5,
        },
        AdBlockerStatusEnum: {
            UNKNOWN: 0,
            EXTENSION_LEVEL_AD_BLOCKER: 1,
            NETWORK_LEVEL_AD_BLOCKER: 2,
            NO_AD_BLOCKER: 3,
        },
        WhitelistStatusEnum: {
            UNKNOWN: 0, NOT_WHITELISTED: 1, WHITELISTED: 2,
        },
        AllowAdsStatusEnum: { UNKNOWN: 0, ADS_NOT_ALLOWED: 1, ADS_ALLOWED: 2 },
        ConsentModePurposeStatusEnum: {
            CONSENT_MODE_PURPOSE_STATUS_UNKNOWN: 0,
            CONSENT_MODE_PURPOSE_STATUS_GRANTED: 1,
            CONSENT_MODE_PURPOSE_STATUS_DENIED: 2,
            CONSENT_MODE_PURPOSE_STATUS_NOT_APPLICABLE: 3,
            CONSENT_MODE_PURPOSE_STATUS_NOT_CONFIGURED: 4,
        },
    };
    const UNKNOWN = 0;
    const NO_CONSENT = ENUMS.ConsentStatusEnum.NO_CONSENT;
    const RELEASED = [
        'consentData', 'legacyNoData', 'adBlockData', 'consentModeData',
        'consentApi',
    ];
    const CONSENT_MODE = {
        adStoragePurposeConsentStatus: 2,
        adUserDataPurposeConsentStatus: 2,
        adPersonalizationPurposeConsentStatus: 2,
        analyticsStoragePurposeConsentStatus: 2,
    };
    const noopfn = function() {
    }.bind();
    const complain = (message, detail) => {
        try {
            if ( typeof console !== 'object' ) { return; }
            if ( typeof console.error !== 'function' ) { return; }
            console.error(message, detail);
        } catch ( ex ) {
        }
    };
    const install = googlefc => {
        const put = (name, value, overwrite) => {
            try {
                if ( overwrite !== true &&
                     Object.prototype.hasOwnProperty.call(googlefc, name) ) {
                    return;
                }
                googlefc[name] = value;
            } catch ( ex ) {
            }
        };
        for ( const name of Object.keys(ENUMS) ) { put(name, ENUMS[name]); }
        put('getConsentStatus', ( ) => NO_CONSENT);
        put('getConsentedProviderIds', ( ) => []);
        put('getAdBlockerStatus', ( ) => UNKNOWN, true);
        put('getWhitelistStatus', ( ) => UNKNOWN, true);
        put('getAllowAdsStatus', ( ) => UNKNOWN, true);
        put('showRevocationMessage', noopfn);
        put('getGoogleConsentModeValues', ( ) => CONSENT_MODE, true);
        const standing = googlefc.callbackQueue;
        if ( standing && Array.isArray(standing) === false ) {
            return 'theirs';
        }
        const parked = new Map();
        const released = new Map();
        const args = new Map();
        let ran = 0;
        const run = (fn, name) => {
            if ( typeof fn !== 'function' ) { return; }
            try {
                if ( args.has(name) ) { fn(args.get(name)); } else { fn(); }
                ran += 1;
            } catch ( ex ) {
                complain('Exception in queued FC callback', ex);
            }
        };
        const pick = entry => {
            if ( typeof entry === 'function' ) {
                return [ 'legacyNoData', entry ];
            }
            if ( typeof entry !== 'object' || entry === null ) { return null; }
            for ( const pair of KEYS ) {
                const fn = entry[pair[1]];
                if ( fn ) { return [ pair[0], fn ]; }
            }
            return null;
        };
        const push = entry => {
            const found = pick(entry);
            if ( found === null ) {
                let first;
                try {
                    first = Object.keys(entry)[0];
                } catch ( ex ) {
                }
                complain('Unrecognized data availability type in the' +
                    ' queued FC callback', first);
                return ran;
            }
            const name = found[0];
            const fn = found[1];
            if ( released.get(name) !== true ) {
                const list = parked.get(name) || [];
                list.push(fn);
                parked.set(name, list);
                return list.length;
            }
            run(fn, name);
            return ran;
        };
        const release = (name, argument) => {
            if ( argument !== undefined ) { args.set(name, argument); }
            released.set(name, true);
            const list = parked.get(name);
            parked.delete(name);
            if ( list === undefined ) { return; }
            for ( const fn of list ) { run(fn, name); }
        };
        const queue = {};
        queue.push = push;
        queue.executeRemainingFunctions = name => { release(name); };
        queue.executeRemainingFunctionsWithArgument = (name, argument) => {
            release(name, argument);
        };
        put('callbackQueue', queue, true);
        if ( googlefc.callbackQueue !== queue ) { return 'theirs'; }
        let adopted = 0;
        if ( Array.isArray(standing) ) {
            for ( const entry of standing ) {
                adopted += 1;
                try {
                    push(entry);
                } catch ( ex ) {
                }
            }
        }
        const releaseAll = ( ) => {
            for ( const name of RELEASED ) { release(name); }
        };
        if ( typeof whenBody === 'function' ) { whenBody(releaseAll); }
        else { releaseAll(); }
        return adopted;
    };
    return { install };
}
    consentRRFundingChoices(
        consentRRFundingChoicesTcf,
        consentRRFundingChoicesUsp,
        consentRRFundingChoicesPage
    );
})();
