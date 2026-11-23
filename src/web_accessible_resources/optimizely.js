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

    Surrogate for the Optimizely Web Experimentation snippet served from
    cdn.optimizely.com/js/<projectId>.js and from the matching
    cdn.optimizely.com/public/<accountId>/<projectId>/..._edge_helper.js

    Projects last saved before the migration are served Optimizely Classic
    from the same path, so the flat Classic api is answered too.

    The page keeps a working window.optimizely - push, get, initialized and
    the lifecycle listeners - so code that queues commands or waits on the
    client proceeds instead of throwing on an undefined get(). What it loses
    is everything the real client does with them: no experiment or campaign
    data, no variation DOM rewriting, no redirect experiments, no visitor
    profile, no optimizelyEndUserId or session cookies, no localStorage, and
    no beacons to logx.optimizely.com, rum.optimizely.com or
    prediction.cmab.optimizely.com. Customer-authored projectJS is not run.

*/

(function() {
    'use strict';
    const w = window;
    const doc = w.document;
    const existing = w.optimizely;
    if ( existing && Array.isArray(existing) === false && typeof existing.get === 'function' ) {
        return;
    }
    const CLIENT_NAME = 'js';
    const CLIENT_VERSION = '0.261.0';
    const POLL_INTERVAL = 20;
    const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    // The request was redirected, not the element, so the script still
    // carries the url it was going to fetch - the only place the identity of
    // the project survives. Two shapes: /js/<project>.js, which is the
    // snippet and holds the project id alone, and
    // /public/<account>/<project>/<revision>_<hash>_edge_helper.js, which is
    // the same client served for Performance Edge and is the only shape that
    // carries the account and the revision as well.
    const identityFromScript = ( ) => {
        const blank = { accountId: null, projectId: null, revision: null };
        try {
            const el = doc.currentScript;
            const src = el && el.src || '';
            const direct = /\/(\d{6,})\.js/.exec(src);
            if ( direct !== null ) {
                return {
                    accountId: null, projectId: direct[1], revision: null,
                };
            }
            const nested = /\/public\/(\d+)\/(\d+)\/(?:(\d+)_)?/.exec(src);
            if ( nested !== null ) {
                return {
                    accountId: nested[1],
                    projectId: nested[2],
                    revision: nested[3] !== undefined ? nested[3] : null,
                };
            }
            return blank;
        } catch ( ex ) {
            return blank;
        }
    };
    const randomId = ( ) => {
        const bytes = new Uint8Array(16);
        try {
            w.crypto.getRandomValues(bytes);
        } catch ( ex ) {
            for ( let i = 0; i < 16; i++ ) {
                bytes[i] = Math.floor(Math.random() * 256);
            }
        }
        bytes[6] = bytes[6] & 15 | 64;
        bytes[8] = bytes[8] & 63 | 128;
        let hex = '';
        for ( let i = 0; i < 16; i++ ) {
            hex += (bytes[i] + 256).toString(16).slice(-2);
        }
        return [
            hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
            hex.slice(16, 20), hex.slice(20),
        ].join('-');
    };
    const observers = [];
    let mutationObserver = null;
    // Nothing left to watch means the records the engine builds for every
    // childList change under the root are built for no one, so the observer
    // goes rather than idling for the life of the page. The next register
    // makes a new one.
    const releaseObserver = ( ) => {
        if ( observers.length !== 0 || mutationObserver === null ) { return; }
        mutationObserver.disconnect();
        mutationObserver = null;
    };
    // False means the entry is spent and should go. A callback can register
    // another observer, which scans itself and may remove entries, so the
    // index a loop is holding cannot be trusted afterwards - removal is by
    // identity, and registering scans the new entry alone rather than all of
    // them, which keeps a nested call from rescanning the document.
    const drop = entry => {
        const at = observers.indexOf(entry);
        if ( at !== -1 ) { observers.splice(at, 1); }
    };
    const scanEntry = entry => {
        let nodes;
        try {
            nodes = doc.querySelectorAll(entry.selector);
        } catch ( ex ) {
            return false;
        }
        for ( const node of nodes ) {
            if ( entry.seen.has(node) ) { continue; }
            entry.seen.add(node);
            try {
                entry.callback(node);
            } catch ( ex ) {
            }
            if ( entry.once ) { return false; }
        }
        return true;
    };
    const scanObservers = ( ) => {
        for ( const entry of observers.slice() ) {
            if ( scanEntry(entry) === false ) { drop(entry); }
        }
        releaseObserver();
    };
    const observeSelector = (selector, callback, options) => {
        let valid = typeof selector === 'string';
        if ( valid ) {
            try {
                doc.querySelector(selector);
            } catch ( ex ) {
                valid = false;
            }
        }
        if ( valid === false ) {
            throw new Error('observeSelector expects a valid css selector as its first argument');
        }
        if ( typeof callback !== 'function' ) {
            throw new Error('observeSelector expects a function as its second argument');
        }
        if ( options !== undefined && options !== null ) {
            if ( typeof options !== 'object' || typeof options === 'function' ) {
                throw new Error('observeSelector expects an object as its third argument');
            }
        }
        const entry = {
            selector,
            callback,
            once: options ? options.once === true : false,
            seen: new WeakSet(),
        };
        observers.push(entry);
        if ( mutationObserver === null && typeof w.MutationObserver === 'function' ) {
            const root = doc.documentElement || doc;
            mutationObserver = new w.MutationObserver(scanObservers);
            try {
                mutationObserver.observe(root, { childList: true, subtree: true });
            } catch ( ex ) {
                mutationObserver = null;
            }
        }
        if ( scanEntry(entry) === false ) {
            drop(entry);
            releaseObserver();
        }
        return ( ) => {
            drop(entry);
            releaseObserver();
        };
    };
    // Their poll keeps one interval per distinct period with a map of
    // callbacks on it, so ten waiters at the default period are ten calls a
    // tick on one timer rather than ten timers. Keyed by token, not by the
    // function, so the same callback can wait twice and cancel once.
    const pollGroups = new Map();
    const poll = (callback, interval) => {
        if ( typeof interval !== 'number' ) { interval = POLL_INTERVAL; }
        let group = pollGroups.get(interval);
        if ( group === undefined ) {
            group = { id: 0, callbacks: new Map() };
            group.id = w.setInterval(( ) => {
                for ( const fn of Array.from(group.callbacks.values()) ) {
                    try {
                        fn();
                    } catch ( ex ) {
                    }
                }
            }, interval);
            pollGroups.set(interval, group);
        }
        const token = {};
        group.callbacks.set(token, callback);
        return ( ) => {
            if ( group.callbacks.delete(token) === false ) { return; }
            if ( group.callbacks.size !== 0 ) { return; }
            w.clearInterval(group.id);
            pollGroups.delete(interval);
        };
    };
    const waitUntil = condition => new Promise(resolve => {
        // No guard on condition: theirs calls it straight away, so a value
        // that is not callable throws inside the executor and the promise
        // rejects. Guarding here would leave it pending for ever instead.
        if ( condition() ) {
            resolve();
            return;
        }
        const cancel = poll(( ) => {
            if ( condition() ) {
                cancel();
                resolve();
            }
        });
    });
    const waitForElement = selector => new Promise(resolve => {
        observeSelector(selector, resolve, { once: true });
    });
    const urlChangeHandlers = new Map();
    // The wrappers installed for the current subscriptions; `active` is
    // cleared on the last unsubscription, so a wrapper which stays wrapped
    // by another script only calls the method and does not notify again.
    let historyPatch = null;
    let nativePushState = null;
    let nativeReplaceState = null;
    let ourPushState = null;
    let ourReplaceState = null;
    const notifyUrlChange = ( ) => {
        for ( const handler of Array.from(urlChangeHandlers.values()) ) {
            try {
                handler(w.location.href);
            } catch ( ex ) {
            }
        }
    };
    const onUrlChange = handler => {
        if ( typeof handler !== 'function' ) { return ( ) => { }; }
        const token = randomId();
        const first = urlChangeHandlers.size === 0;
        urlChangeHandlers.set(token, handler);
        if ( first ) {
            w.addEventListener('popstate', notifyUrlChange);
            w.addEventListener('hashchange', notifyUrlChange);
            if ( historyPatch === null ) {
                const patch = { active: true };
                // Captured for these wrappers only: the shared variables are
                // set again by the next subscription, possibly to a wrapper of
                // another script which calls these wrappers.
                const pushState = w.history.pushState;
                const replaceState = w.history.replaceState;
                nativePushState = pushState;
                nativeReplaceState = replaceState;
                w.history.pushState = function() {
                    pushState.apply(w.history, arguments);
                    if ( patch.active ) {
                        notifyUrlChange();
                    }
                };
                w.history.replaceState = function() {
                    replaceState.apply(w.history, arguments);
                    if ( patch.active ) {
                        notifyUrlChange();
                    }
                };
                ourPushState = w.history.pushState;
                ourReplaceState = w.history.replaceState;
                historyPatch = patch;
            }
        }
        return ( ) => {
            urlChangeHandlers.delete(token);
            if ( urlChangeHandlers.size !== 0 ) { return; }
            w.removeEventListener('popstate', notifyUrlChange);
            w.removeEventListener('hashchange', notifyUrlChange);
            if ( historyPatch !== null ) {
                historyPatch.active = false;
                // Put the natives back only while ours are still the ones
                // installed. Another script may have wrapped history after
                // us, and restoring over that would unhook it - theirs
                // checks the same identity before restoring.
                if ( w.history.pushState === ourPushState ) {
                    w.history.pushState = nativePushState;
                }
                if ( w.history.replaceState === ourReplaceState ) {
                    w.history.replaceState = nativeReplaceState;
                }
                ourPushState = null;
                ourReplaceState = null;
                historyPatch = null;
            }
        };
    };
    const PLACEMENTS = {
        before: 'beforebegin',
        after: 'afterend',
        first_child: 'afterbegin',
        last_child: 'beforeend',
    };
    // Theirs re-inserts the markup if the page removes it, which is what the
    // persist means. This inserts once: the re-insertion exists for variation
    // code, and no variation runs here.
    const persistHtml = (html, selector, placement) => {
        if ( typeof html !== 'string' || html === '' ) {
            throw new Error('persistHtml: html must be a non-empty string');
        }
        try {
            doc.querySelector(selector);
        } catch ( ex ) {
            throw new Error('persistHtml: invalid CSS selector: ' + selector);
        }
        if ( placement === undefined || placement === null ) { placement = 'before'; }
        if ( hasOwn(PLACEMENTS, placement) === false ) {
            throw new Error('persistHtml: placement must be one of: ' + Object.keys(PLACEMENTS).join(', '));
        }
        const target = doc.querySelector(selector);
        if ( target === null ) {
            throw new Error('persistHtml: no element found for selector "' + selector + '"');
        }
        try {
            target.insertAdjacentHTML(PLACEMENTS[placement], html);
        } catch ( ex ) {
        }
        return ( ) => { };
    };
    // Their logger buffers every line and prints nothing until a level is
    // set - shouldLog is false while logLevel is null, which is how it
    // starts - so a normal page sees a silent console. These lines appear
    // the same way theirs do: push({type:'log', level:'WARN'}), or the
    // legacy push(['log']), which means INFO. Levels, wording and the
    // complaint about an unknown level are all theirs.
    const LOG_LEVELS = { OFF: 0, ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4 };
    let logLevel = null;
    const setLogLevel = level => {
        const resolved = typeof level === 'string'
            ? LOG_LEVELS[level.toUpperCase()]
            : level;
        if ( typeof resolved !== 'number' ) {
            try {
                w.console.error('Unknown log level: ' + level);
            } catch ( ex ) {
            }
            return;
        }
        logLevel = resolved;
    };
    const warn = (message, detail) => {
        if ( logLevel === null || logLevel < LOG_LEVELS.WARN ) { return; }
        try {
            if ( detail === undefined ) {
                w.console.warn(message);
            } else {
                w.console.warn(message, detail);
            }
        } catch ( ex ) {
        }
    };
    const identity = identityFromScript();
    const state = {
        getActivationId: ( ) => null,
        getActiveExperimentIds: ( ) => [],
        getCampaignStateLists: ( ) => ({}),
        getCampaignStates: ( ) => ({}),
        getDecisionObject: ( ) => null,
        getDecisionString: ( ) => null,
        getExperimentStates: ( ) => ({}),
        getPageStates: ( ) => ({}),
        getRedirectInfo: ( ) => null,
        getTrafficExclusionStats: ( ) => ({}),
        getVariationMap: ( ) => ({}),
        isGlobalHoldback: ( ) => false,
    };
    const data = {
        accountId: identity.accountId,
        audiences: {},
        campaigns: {},
        clientName: CLIENT_NAME,
        clientVersion: CLIENT_VERSION,
        dcpServiceId: null,
        events: {},
        experiments: {},
        groups: {},
        pages: {},
        projectId: identity.projectId,
        revision: identity.revision,
        snippetId: identity.projectId,
        variations: {},
    };
    // get('visitor') is assembled from their profile providers, one per key,
    // each declaring what it provides. Fourteen appear in every snippet read;
    // the eight marked below are bundled only when a project's audiences ask
    // for them, and they are here anyway so a page reading one does not meet
    // undefined. dcpData is the Dynamic Customer Profile key, registered with
    // the dynamic_customer_profile audience matcher; theirs fetches it, so it
    // is an empty object here for the same reason location is an object. Nothing about the visitor is measured: strings are empty,
    // maps are empty, and location is an object rather than absent, because
    // a property chain into it is exactly what their own geo.js walks.
    // campaign is singular and holds their utm_campaign value; campaigns,
    // with an s, is a key of data and not of this. first_session is true
    // because theirs is true when the event history is empty, and this one
    // always is. lineItems and dimensions were mine and are declared by no
    // snippet: dimensions is project data, not a visitor key.
    const visitor = {
        browserId: '',
        browserVersion: '',
        campaign: null,
        cookies: {},
        custom: {},
        customBehavior: [],
        dcpData: {},
        device: '',
        device_type: '',
        events: [],
        first_session: true,
        IP: '',
        language: '',
        location: {
            city: '',
            continent: '',
            country: '',
            dma: '',
            region: '',
        },
        offset: 0,
        platform: '',
        queryParams: {},
        referrer: '',
        source_type: 'direct',
        url: '',
        visitorId: null,
    };
    // Theirs marks this one lazy, so a read takes the time of the read.
    Object.defineProperty(visitor, 'currentTimestamp', {
        enumerable: true,
        get: ( ) => Date.now(),
    });
    const utils = {
        observeSelector,
        onUrlChange,
        persistHtml,
        poll,
        Promise: w.Promise,
        waitForElement,
        waitUntil,
    };
    // get('behavior') is registered as a plugin by every snippet seen, so it
    // has to answer. Their three methods read the visitor event store, which
    // here holds nothing, and the argument checks below are theirs: a page
    // that passes a bad descriptor should still hear about it.
    const RECENCY_FILTERS = [ 'most_recent', 'least_recent' ];
    const FREQUENCY_FILTERS = [ 'most_frequent', 'least_frequent' ];
    const descriptorProblems = (descriptor, allowed) => {
        if ( !descriptor ) { return [ 'Descriptor not defined' ]; }
        const problems = [];
        if ( descriptor.count ) {
            problems.push('Unexpected "count" clause specified');
        }
        const pick = descriptor.pick;
        if ( pick && pick.modifier && allowed.indexOf(pick.modifier) === -1 ) {
            problems.push('Invalid "pick" modifier "' + pick.modifier + '"');
        }
        for ( const filter of descriptor.filters || [] ) {
            if ( filter && filter.modifier !== undefined ) {
                problems.push('Unexpected "filter" modifier "' + filter.modifier + '"');
            }
        }
        return problems.length !== 0 ? problems : undefined;
    };
    const behavior = {
        getEvents: descriptor => {
            if ( descriptor === undefined ) { return []; }
            if ( typeof descriptor === 'number' ) {
                if ( descriptor <= 0 ) {
                    throw new Error('Count must be a positive integer, got ' + descriptor);
                }
                return [];
            }
            const problems = descriptorProblems(descriptor, RECENCY_FILTERS);
            if ( problems !== undefined ) { throw new Error(problems.join('\n')); }
            return [];
        },
        getByFrequency: descriptor => {
            const spec = descriptor !== undefined && descriptor !== null
                ? descriptor
                : {};
            if ( !spec.pick ) {
                throw new Error('No "pick" clause provided in query descriptor');
            }
            if ( !spec.pick.name ) {
                throw new Error('No field name provided in "pick" clause');
            }
            const problems = descriptorProblems(spec, FREQUENCY_FILTERS);
            if ( problems !== undefined ) { throw new Error(problems.join('\n')); }
            return [];
        },
        query: descriptor => {
            const spec = descriptor !== undefined && descriptor !== null
                ? descriptor
                : {};
            // Theirs executes the spec then takes the first element when a
            // reduce is asked for. Executed against no events that is an
            // empty list, so a reduced query has nothing to hand back.
            return spec.reduce ? undefined : [];
        },
    };
    const modules = {
        behavior,
        data,
        state,
        utils,
        visitor,
        visitor_id: { randomId: randomId() },
    };
    const get = name => {
        // Theirs does not bundle jQuery, it borrows the page's: env/jquery
        // reads a closure-scoped $ if there is one and otherwise window.$,
        // and it never looks at window.jQuery. So a page that called
        // noConflict - jQuery present, $ gone - gets undefined from theirs,
        // and gets undefined here. A fallback to jQuery would be answering
        // something they do not.
        if ( name === 'jquery' ) { return w.$; }
        // Declared below, and only ever reached once the api is installed.
        if ( name === 'event_emitter' ) { return eventEmitter; }
        if ( hasOwn(modules, name) ) { return modules[name]; }
        warn('Module "' + name + '" not found.');
        return undefined;
    };
    const listeners = [];
    const fired = Object.create(null);
    const STICKY = { activated: true, initialized: true, originsSynced: true };
    const eventMatches = (filter, ev) => {
        if ( filter === undefined || filter === null ) { return true; }
        if ( filter.type !== undefined && filter.type !== ev.type ) { return false; }
        if ( filter.name !== undefined && filter.name !== ev.name ) { return false; }
        return true;
    };
    const emit = ev => {
        if ( ev.type === 'lifecycle' ) { fired[ev.name] = true; }
        for ( const entry of listeners.slice() ) {
            if ( eventMatches(entry.filter, ev) === false ) { continue; }
            try {
                entry.handler(ev);
            } catch ( ex ) {
            }
        }
    };
    const dropByToken = token => {
        for ( let i = listeners.length - 1; i >= 0; i-- ) {
            if ( listeners[i].token === token ) { listeners.splice(i, 1); }
        }
    };
    // Their emitter puts a token on the spec it was handed when it has none,
    // and hands the same token back, which is the only way a page learns the
    // one it must pass to removeListener.
    const register = spec => {
        if ( !spec.token ) { spec.token = randomId(); }
        listeners.push({
            filter: spec.filter, handler: spec.handler, token: spec.token,
        });
        return spec.token;
    };
    const replaySticky = spec => {
        const filter = spec.filter;
        if ( !filter || filter.type !== 'lifecycle' ) { return; }
        if ( STICKY[filter.name] !== true || fired[filter.name] !== true ) { return; }
        try {
            spec.handler({ type: 'lifecycle', name: filter.name });
        } catch ( ex ) {
        }
    };
    const addListener = spec => {
        if ( spec === null || typeof spec !== 'object' || typeof spec.handler !== 'function' ) {
            throw new Error('A handler function must be supplied');
        }
        const token = register(spec);
        replaySticky(spec);
        return token;
    };
    const removeListener = spec => {
        if ( spec === null || typeof spec !== 'object' || !spec.token ) {
            throw new Error('Must supply a token to removeListener');
        }
        dropByToken(spec.token);
    };
    // get('event_emitter') is in their module registry beside state and data.
    // on takes the spec and returns its token, off takes the bare token.
    const eventEmitter = {
        on: spec => {
            if ( spec === null || typeof spec !== 'object' ) { return undefined; }
            const token = register(spec);
            replaySticky(spec);
            return token;
        },
        off: token => { dropByToken(token); },
        emit: ev => {
            if ( ev === null || typeof ev !== 'object' ) { return; }
            emit(ev);
        },
    };
    const noop = ( ) => { };
    // Their push picks a table by version: the array and string forms are
    // version 0, an object carries its own or defaults to 1, and the third
    // table in their client is empty, so a version 2 call finds nothing.
    // A name in the wrong table is refused there as well, which is why this
    // is two lists and not one - push('activate') is a version 0 call for a
    // version 1 name, and their answer to it is false.
    const commandsV0 = {
        activateGeoDelayedExperiments: noop,
        activateSiteCatalyst: noop,
        bucketUser: noop,
        bucketVisitor: noop,
        disable: noop,
        log: enabled => {
            setLogLevel(enabled === undefined || enabled ? 'INFO' : 'OFF');
        },
        optOut: noop,
        setCookieDomain: noop,
        setCookieExpiration: noop,
        setDimensionValue: noop,
        setGA4UserId: noop,
        setUserId: noop,
        storeThirdPartyData: noop,
        trackEvent: noop,
    };
    const commandsV1 = {
        activate: noop,
        addListener,
        bucketVisitor: noop,
        clientMetadata: noop,
        cookieDomain: noop,
        cookieExpiration: noop,
        dataFromSource: noop,
        disable: noop,
        disableCrossOrigin: noop,
        event: noop,
        extendCookieLifetime: noop,
        ga4User: noop,
        holdEvents: noop,
        initialViewStates: noop,
        integrationSettings: noop,
        load: noop,
        loadEmbeddedEditor: noop,
        log: spec => { setLogLevel(spec.level); },
        microsnippetError: noop,
        optOut: noop,
        page: noop,
        priorRedirectString: noop,
        registerModule: noop,
        removeListener,
        rum: noop,
        sendEvents: noop,
        tags: noop,
        user: noop,
        waitForOriginSync: noop,
    };
    const commandTables = [ commandsV0, commandsV1, {} ];
    // Their push takes a second argument, used once while the client boots:
    // window.optimizely = window.optimizely.filter(c => !push(c, true)) runs
    // the six names below out of the queue early, before the opt-out and
    // disable checks, and leaves everything else in the array for the normal
    // drain. With the flag set, any other name is ignored and reports false,
    // and that happens before the table is consulted, so an unknown name is
    // refused quietly rather than warned about.
    const HIGH_PRIORITY = [
        'clientMetadata', 'cookieDomain', 'disable', 'load', 'optOut', 'rum',
    ];
    const push = (command, highPriorityOnly) => {
        let version;
        let name;
        let args;
        if ( Array.isArray(command) ) {
            version = 0;
            name = command[0];
            args = command.slice(1);
        } else if ( command !== null && typeof command === 'object' ) {
            version = command.version !== undefined ? command.version : 1;
            name = command.type;
            args = [ command ];
        } else if ( typeof command === 'string' ) {
            version = 0;
            name = command;
            args = [];
        } else {
            warn('API / Ignoring non-array/object/string argument:', command);
            return false;
        }
        if ( highPriorityOnly && HIGH_PRIORITY.indexOf(name) === -1 ) {
            return false;
        }
        const table = commandTables[version];
        if ( table === undefined || hasOwn(table, name) === false ) {
            warn(
                'API / No function found for "' + name + '" (v' + version +
                ') with arguments:',
                args
            );
            return false;
        }
        try {
            table[name].apply(null, args);
        } catch ( ex ) {
        }
        return true;
    };
    // Optimizely Classic, the product before this one, is still served for
    // projects last saved before the migration, from the same /js/<id>.js
    // path. It puts its whole api straight on the object instead of behind
    // push and get, and their own bundled mode ships both at once, so the
    // two surfaces sit together here the way they do there. Every method is
    // a no-op; the maps are the empty ones a project with no running
    // experiment has. referrer stays empty for the reason it is empty in
    // get('visitor'): theirs reads document.referrer and this does not.
    const classicData = {
        note: "Obsolete, use optimizely.get('data') instead",
        audiences: {},
        customTags: {},
        experiments: {},
        sections: {},
        segments: {},
        thirdParty: {},
        variations: {},
        state: {
            activeExperiments: [],
            enabled: true,
            integrations: { activeOAuthClientIds: [] },
            redirectExperiment: undefined,
            variationIdsMap: {},
            variationMap: {},
            variationNamesMap: {},
        },
        visitor: {
            audiences: {},
            browser: '',
            browserVersion: '',
            device: '',
            deviceType: '',
            dimensions: {},
            ip: '',
            lists: {},
            location: {},
            matchingRules: {},
            mobile: false,
            mobileId: '',
            os: '',
            params: {},
            platform: '',
            referrer: '',
            segments: {},
        },
    };
    const classic = {
        activeExperiments: [],
        allExperiments: {},
        all_experiments: {},
        allVariations: {},
        getElementsByClassName: name => doc.getElementsByClassName(name),
        revision: identity.revision,
        variationIdsMap: {},
        variationMap: {},
        variationNamesMap: {},
        variation_map: {},
        getAccountId: ( ) => identity.accountId,
        getProjectId: ( ) => identity.projectId,
    };
    for ( const name of [
        'activate', 'activateGeoDelayedExperiments', 'activateSiteCatalyst',
        'activateUniversalAnalytics', 'addOAuthClientId', 'addToAudience',
        'addToSegment', 'bindTrackElement', 'bucketUser', 'bucketVisitor',
        'clickTalePlayback', 'clickTaleRecord', 'customTag',
        'delayDomReadyEval', 'delayPageviewTracking', 'disable',
        'googleAnalyticsCustomVariableScope', 'integrationPrefix', 'log',
        'optOut', 'optOutThirdPartyCookies', 'overrideUrl',
        'removeFromAllAudiences', 'removeFromAllSegments',
        'removeFromAudience', 'removeFromReportableAudiences',
        'removeFromSegment', 'sc_activate', 'sc_svar', 'setDimensionValue',
        'setUserId', 'skipPageTracking', 'storeThirdPartyData', 'timeout',
        'trackEvent', 'verbose',
    ] ) {
        // Eleven of these are also v0 push names, and in Classic the method
        // and the pushed command are the same function, so a page gets the
        // same behaviour whichever way it asks. log is the one that is not
        // a no-op, and it was the one diverging: push(['log']) turned the
        // console on while optimizely.log() did nothing.
        classic[name] = hasOwn(commandsV0, name) ? commandsV0[name] : noop;
    }
    const api = {
        push,
        get,
        initialized: true,
        data: classicData,
        state: {},
    };
    for ( const name of Object.keys(classic) ) {
        api[name] = classic[name];
    }
    // Their $ is the jQuery they bundled, read at the time it is asked for
    // rather than captured, the same as get('jquery').
    try {
        Object.defineProperty(api, '$', {
            configurable: true, enumerable: true, get: ( ) => w.$,
        });
    } catch ( ex ) {
    }
    const queued = Array.isArray(existing) ? existing.slice() : [];
    w.optimizely = api;
    for ( const command of queued ) {
        push(command);
    }
    const fireLifecycle = ( ) => {
        emit({ type: 'lifecycle', name: 'initialized' });
        emit({ type: 'lifecycle', name: 'originsSynced' });
        emit({ type: 'lifecycle', name: 'activate' });
        emit({ type: 'lifecycle', name: 'activated' });
    };
    if ( doc.readyState === 'loading' ) {
        doc.addEventListener('DOMContentLoaded', fireLifecycle, { once: true });
    } else {
        w.setTimeout(fireLifecycle, 0);
    }
})();
