/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2017-present Raymond Hill

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

/* globals browser */

'use strict';

/******************************************************************************/

import µb from './background.js';
import logger from './logger.js';
import { onBroadcast } from './broadcast.js';
import { redirectEngine as reng } from './redirect-engine.js';
import { sessionFirewall } from './filtering-engines.js';
import { MRUCache } from './mrucache.js';
import { ScriptletFilteringEngine } from './scriptlet-filtering-core.js';

import {
    domainFromHostname,
    entityFromDomain,
    hostnameFromURI,
} from './uri-utils.js';

/******************************************************************************/

const contentScriptRegisterer = new (class {
    constructor() {
        this.hostnameToDetails = new Map();
        if ( browser.contentScripts === undefined ) { return; }
        onBroadcast(msg => {
            if ( msg.what !== 'filteringBehaviorChanged' ) { return; }
            if ( msg.direction > 0 ) { return; }
            if ( msg.hostname ) { return this.flush(msg.hostname); }
            this.reset();
        });
    }
    register(hostname, code) {
        if ( browser.contentScripts === undefined ) { return false; }
        if ( hostname === '' ) { return false; }
        const details = this.hostnameToDetails.get(hostname);
        if ( details !== undefined ) {
            if ( code === details.code ) {
                return details.handle instanceof Promise === false;
            }
            details.handle.unregister();
            this.hostnameToDetails.delete(hostname);
        }
        const promise = browser.contentScripts.register({
            js: [ { code } ],
            allFrames: true,
            matches: [ `*://*.${hostname}/*` ],
            matchAboutBlank: true,
            runAt: 'document_start',
        }).then(handle => {
            this.hostnameToDetails.set(hostname, { handle, code });
        }).catch(( ) => {
            this.hostnameToDetails.delete(hostname);
        });
        this.hostnameToDetails.set(hostname, { handle: promise, code });
        return false;
    }
    unregister(hostname) {
        if ( this.hostnameToDetails.size === 0 ) { return; }
        const details = this.hostnameToDetails.get(hostname);
        if ( details === undefined ) { return; }
        this.hostnameToDetails.delete(hostname);
        this.unregisterHandle(details.handle);
    }
    flush(hostname) {
        if ( hostname === '*' ) { return this.reset(); }
        for ( const hn of this.hostnameToDetails.keys() ) {
            if ( hn.endsWith(hostname) === false ) { continue; }
            const pos = hn.length - hostname.length;
            if ( pos !== 0 && hn.charCodeAt(pos-1) !== 0x2E /* . */ ) { continue; }
            this.unregister(hn);
        }
    }
    reset() {
        if ( this.hostnameToDetails.size === 0 ) { return; }
        for ( const details of this.hostnameToDetails.values() ) {
            this.unregisterHandle(details.handle);
        }
        this.hostnameToDetails.clear();
    }
    unregisterHandle(handle) {
        if ( handle instanceof Promise ) {
            handle.then(handle => { handle.unregister(); });
        } else {
            handle.unregister();
        }
    }
})();

/******************************************************************************/

const mainWorldInjector = (( ) => {
    const parts = [
        '(',
        function(injector, details) {
            if ( typeof self.uBO_scriptletsInjected === 'string' ) { return; }
            const doc = document;
            if ( doc.location === null ) { return; }
            const hostname = doc.location.hostname;
            if ( hostname !== '' && details.hostname !== hostname ) { return; }
            injector(doc, details);
            return 0;
        }.toString(),
        ')(',
            vAPI.scriptletsInjector, ', ',
            'json-slot',
        ');',
    ];
    return {
        parts,
        jsonSlot: parts.indexOf('json-slot'),
        assemble: function(hostname, scriptlets, filters) {
            this.parts[this.jsonSlot] = JSON.stringify({
                hostname,
                scriptlets,
                filters,
            });
            return this.parts.join('');
        },
    };
})();

const isolatedWorldInjector = (( ) => {
    const parts = [
        '(',
        function(details) {
            if ( self.uBO_isolatedScriptlets === 'done' ) { return; }
            const doc = document;
            if ( doc.location === null ) { return; }
            const hostname = doc.location.hostname;
            if ( hostname !== '' && details.hostname !== hostname ) { return; }
            const isolatedScriptlets = function(){};
            isolatedScriptlets();
            self.uBO_isolatedScriptlets = 'done';
            return 0;
        }.toString(),
        ')(',
            'json-slot',
        ');',
    ];
    return {
        parts,
        jsonSlot: parts.indexOf('json-slot'),
        assemble: function(hostname, scriptlets) {
            this.parts[this.jsonSlot] = JSON.stringify({ hostname });
            const code = this.parts.join('');
            // Manually substitute noop function with scriptlet wrapper
            // function, so as to not suffer instances of special
            // replacement characters `$`,`\` when using String.replace()
            // with scriptlet code.
            const match = /function\(\)\{\}/.exec(code);
            return code.slice(0, match.index) +
                scriptlets +
                code.slice(match.index + match[0].length);
        },
    };
})();

/******************************************************************************/

export class ScriptletFilteringEngineEx extends ScriptletFilteringEngine {
    constructor() {
        super();
        this.warOrigin = vAPI.getURL('/web_accessible_resources');
        this.warSecret = undefined;
        this.scriptletCache = new MRUCache(32);
        this.isDevBuild = undefined;
        onBroadcast(msg => {
            if ( msg.what !== 'hiddenSettingsChanged' ) { return; }
            this.scriptletCache.reset();
            this.isDevBuild = undefined;
        });
    }

    reset() {
        super.reset();
        this.warSecret = vAPI.warSecret.long(this.warSecret);
        this.scriptletCache.reset();
        contentScriptRegisterer.reset();
    }

    freeze() {
        super.freeze();
        this.warSecret = vAPI.warSecret.long(this.warSecret);
        this.scriptletCache.reset();
        contentScriptRegisterer.reset();
    }

    retrieve(request) {
        const { hostname } = request;

        // https://github.com/gorhill/uBlock/issues/2835
        // Do not inject scriptlets if the site is under an `allow` rule.
        if ( µb.userSettings.advancedUserEnabled ) {
            if ( sessionFirewall.evaluateCellZY(hostname, hostname, '*') === 2 ) {
                return;
            }
        }

        if ( this.scriptletCache.resetTime < reng.modifyTime ) {
            this.warSecret = vAPI.warSecret.long(this.warSecret);
            this.scriptletCache.reset();
        }

        let scriptletDetails = this.scriptletCache.lookup(hostname);
        if ( scriptletDetails !== undefined ) {
            return scriptletDetails || undefined;
        }

        if ( this.isDevBuild === undefined ) {
            this.isDevBuild = vAPI.webextFlavor.soup.has('devbuild') ||
                µb.hiddenSettings.filterAuthorMode;
        }

        if ( this.warSecret === undefined ) {
            this.warSecret = vAPI.warSecret.long();
        }

        const options = {
            scriptletGlobals: [
                [ 'warOrigin', this.warOrigin ],
                [ 'warSecret', this.warSecret ],
            ],
            debug: this.isDevBuild,
            debugScriptlets: µb.hiddenSettings.debugScriptlets,
        };

        scriptletDetails = super.retrieve(request, options);

        this.scriptletCache.add(hostname, scriptletDetails || null);

        return scriptletDetails;
    }

    injectNow(details) {
        if ( typeof details.frameId !== 'number' ) { return; }

        const request = {
            tabId: details.tabId,
            frameId: details.frameId,
            url: details.url,
            hostname: hostnameFromURI(details.url),
            domain: undefined,
            entity: undefined
        };

        request.domain = domainFromHostname(request.hostname);
        request.entity = entityFromDomain(request.domain);

        const scriptletDetails = this.retrieve(request);
        if ( scriptletDetails === undefined ) {
            contentScriptRegisterer.unregister(request.hostname);
            return;
        }

        const contentScript = [];
        if ( µb.hiddenSettings.debugScriptletInjector ) {
            contentScript.push('debugger');
        }
        const { mainWorld = '', isolatedWorld = '', filters } = scriptletDetails;
        if ( mainWorld !== '' ) {
            contentScript.push(mainWorldInjector.assemble(request.hostname, mainWorld, filters));
        }
        if ( isolatedWorld !== '' ) {
            contentScript.push(isolatedWorldInjector.assemble(request.hostname, isolatedWorld));
        }

        const code = contentScript.join('\n\n');

        const isAlreadyInjected = contentScriptRegisterer.register(request.hostname, code);
        if ( isAlreadyInjected !== true ) {
            vAPI.tabs.executeScript(details.tabId, {
                code,
                frameId: details.frameId,
                matchAboutBlank: true,
                runAt: 'document_start',
            });
        }

        return scriptletDetails;
    }

    toLogger(request, details) {
        if ( details === undefined ) { return; }
        if ( logger.enabled !== true ) { return; }
        if ( typeof details.filters !== 'string' ) { return; }
        const fctxt = µb.filteringContext
            .duplicate()
            .fromTabId(request.tabId)
            .setRealm('extended')
            .setType('scriptlet')
            .setURL(request.url)
            .setDocOriginFromURL(request.url);
        for ( const raw of details.filters.split('\n') ) {
            fctxt.setFilter({ source: 'extended', raw }).toLogger();
        }
    }
}

/******************************************************************************/

const scriptletFilteringEngine = new ScriptletFilteringEngineEx();

export default scriptletFilteringEngine;

/******************************************************************************/
