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

/* global browser */

/******************************************************************************/

import * as scripting from './vapi-scripting.js';

import {
    domainFromHostname,
    hostnameFromURI,
} from './uri-utils.js';

import { ScriptletFilteringEngine } from './scriptlet-filtering-core.js';
import logger from './logger.js';
import { onBroadcast } from './broadcast.js';
import { sessionFirewall } from './filtering-engines.js';
import µb from './background.js';

/******************************************************************************/

const contentScriptRegisterer = {
    id: 1,
    hostnameToDetails: new Map(),
    register(hostname, code) {
        if ( browser.contentScripts === undefined ) { return false; }
        if ( hostname === '' ) { return false; }
        const details = this.hostnameToDetails.get(hostname);
        if ( details !== undefined ) {
            if ( code === details.code ) {
                return details.handle instanceof Promise === false;
            }
            this.unregisterHandle(details.handle);
            this.hostnameToDetails.delete(hostname);
        }
        const id = this.id++;
        const promise = browser.contentScripts.register({
            js: [ { code } ],
            allFrames: true,
            matches: [ `*://*.${hostname}/*` ],
            matchAboutBlank: true,
            runAt: 'document_start',
        }).then(handle => {
            const details = this.hostnameToDetails.get(hostname);
            if ( details === undefined ) { return; }
            if ( details.id !== id ) { return; }
            details.handle = handle;
        }).catch(( ) => {
            this.hostnameToDetails.delete(hostname);
        });
        this.hostnameToDetails.set(hostname, { id, handle: promise, code });
        return false;
    },
    unregister(hostname) {
        if ( hostname === '' ) { return; }
        if ( this.hostnameToDetails.size === 0 ) { return; }
        const details = this.hostnameToDetails.get(hostname);
        if ( details === undefined ) { return; }
        this.hostnameToDetails.delete(hostname);
        this.unregisterHandle(details.handle);
    },
    flush(hostname) {
        if ( hostname === '' ) { return; }
        if ( hostname === '*' ) { return this.reset(); }
        for ( const hn of this.hostnameToDetails.keys() ) {
            if ( hn.endsWith(hostname) === false ) { continue; }
            const pos = hn.length - hostname.length;
            if ( pos !== 0 && hn.charCodeAt(pos-1) !== 0x2E /* . */ ) { continue; }
            this.unregister(hn);
        }
    },
    reset() {
        if ( this.hostnameToDetails.size === 0 ) { return; }
        for ( const details of this.hostnameToDetails.values() ) {
            this.unregisterHandle(details.handle);
        }
        this.hostnameToDetails.clear();
    },
    unregisterHandle(handle) {
        if ( handle instanceof Promise ) {
            handle.then(handle => {
                if ( handle ) { handle.unregister(); }
            });
        } else {
            handle.unregister();
        }
    },
};

/******************************************************************************/

function isTrustedContext(directives) {
    const { href } = document.location;
    for ( const directive of directives ) {
        if ( (new RegExp(directive)).test(href) ) { return true; }
    }
    return false;
}

function initCommChannel(name) {
    if ( self.uBO_bcSecret ) { return; }
    try {
        const bcSecret = new self.BroadcastChannel(name);
        bcSecret.onmessage = ev => {
            const msg = ev.data;
            switch ( typeof msg ) {
            case 'string':
                if ( msg !== 'areyouready?' ) { break; }
                bcSecret.postMessage('iamready!');
                break;
            case 'object':
                if ( self.vAPI && self.vAPI.messaging ) {
                    self.vAPI.messaging.send('contentscript', msg);
                } else {
                    console.log(`[uBO][${msg.type}]${msg.text}`);
                }
                break;
            }
        };
        bcSecret.postMessage('iamready!');
        self.uBO_bcSecret = bcSecret;
    } catch {
    }
}

function assembleIsolatedWorldWrapper(isolatedCode, options) {
    const code = [ '(function() {' ];
    if ( options.debug ) {
        code.push('debugger;');
    }
    if ( options.trustedSiteRegexes?.length ) {
        code.push(isTrustedContext.toString());
        code.push(`if ( isTrustedContext(${JSON.stringify(options.trustedSiteRegexes)}) ) { return; }`);
    }
    if ( options.bcSecret ) {
        code.push(initCommChannel.toString());
        code.push(`initComm(${JSON.stringify(options.bcSecret)});`);
    }
    code.push(isolatedCode);
    code.push('})();');
    return code.join('\n');
}

function assembleMainWorldWrapper(mainCode, options) {
    const code = [ '(function() {' ];
    if ( options.debug ) {
        code.push('debugger;');
    }
    if ( options.trustedSiteRegexes?.length ) {
        code.push(isTrustedContext.toString());
        code.push(`if ( isTrustedContext(${JSON.stringify(options.trustedSiteRegexes)}) ) { return; }`);
    }
    code.push(mainCode);
    code.push('})();');
    return code.join('\n');
}

/******************************************************************************/

export class ScriptletFilteringEngineEx extends ScriptletFilteringEngine {
    constructor() {
        super();
        this.warOrigin = vAPI.getURL('/web_accessible_resources');
        this.warSecret = undefined;
        this.isDevBuild = undefined;
        this.logLevel = 1;
        this.bc = onBroadcast(msg => {
            switch ( msg.what ) {
            case 'filteringBehaviorChanged':
                this.clearCache({ hostname: msg.hostname });
                break;
            case 'hiddenSettingsChanged':
                this.isDevBuild = undefined;
                /* fall through */
            case 'loggerEnabled':
            case 'loggerDisabled':
                this.clearCache();
                break;
            case 'loggerLevelChanged':
                this.logLevel = msg.level;
                vAPI.tabs.query({
                    discarded: false,
                    url: [ 'http://*/*', 'https://*/*' ],
                }).then(tabs => {
                    for ( const tab of tabs ) {
                        const { status } = tab;
                        if ( status !== 'loading' && status !== 'complete' ) { continue; }
                        vAPI.tabs.executeScript(tab.id, {
                            allFrames: true,
                            file: `/js/scriptlets/scriptlet-loglevel-${this.logLevel}.js`,
                            matchAboutBlank: true,
                        });
                    }
                });
                this.clearCache();
                break;
            }
        });
    }

    reset() {
        super.reset();
        this.warSecret = vAPI.warSecret.long(this.warSecret);
        this.clearCache();
        scripting.reset();
    }

    freeze() {
        super.freeze();
        this.warSecret = vAPI.warSecret.long(this.warSecret);
        this.clearCache();
        scripting.reset();
    }

    clearCache(details = {}) {
        scripting.reset(details);
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

        if ( this.isDevBuild === undefined ) {
            this.isDevBuild = vAPI.webextFlavor.soup.has('devbuild') ||
                µb.hiddenSettings.filterAuthorMode;
        }

        if ( this.warSecret === undefined ) {
            this.warSecret = vAPI.warSecret.long();
        }

        const bcSecret = vAPI.generateSecret(3);

        const options = {
            scriptletGlobals: {
                warOrigin: this.warOrigin,
                warSecret: this.warSecret,
            },
            debug: this.isDevBuild,
            debugScriptlets: µb.hiddenSettings.debugScriptlets,
        };
        if ( logger.enabled ) {
            options.scriptletGlobals.bcSecret = bcSecret;
            options.scriptletGlobals.logLevel = this.logLevel;
        }

        const scriptletDetails = super.retrieve(request, options);
        if ( scriptletDetails === undefined ) { return; }
        if ( Boolean(scriptletDetails.isolatedWorld) === false ) {
            if ( Boolean(scriptletDetails.mainWorld) === false ) { return; }
        }

        const out = {
            hostname,
            bcSecret,
            filters: scriptletDetails.filters,
        };

        const trustedSiteRegexes = µb.trustedSites.directiveRegexesFromHostname(hostname);

        if ( scriptletDetails.isolatedWorld ) {
            out.isolatedWorld =
                assembleIsolatedWorldWrapper(scriptletDetails.isolatedWorld, {
                    bcSecret: logger.enabled ? out.bcSecret : undefined,
                    debug: µb.hiddenSettings.debugScriptletInjector,
                    trustedSiteRegexes,
                });
        }

        if ( scriptletDetails.mainWorld ) {
            out.mainWorld =
                assembleMainWorldWrapper(scriptletDetails.mainWorld, {
                    debug: µb.hiddenSettings.debugScriptlets,
                    trustedSiteRegexes,
                });
        }

        return out;
    }

    toLogger(request, details) {
        if ( details === undefined ) { return; }
        if ( logger.enabled !== true ) { return; }
        if ( Array.isArray(details.filters) === false ) { return; }
        µb.filteringContext
            .duplicate()
            .fromTabId(request.tabId)
            .setRealm('extended')
            .setType('scriptlet')
            .setURL(request.url)
            .setDocOriginFromURL(request.url)
            .setFilter(details.filters.map(a => ({ source: 'extended', raw: a })))
            .toLogger();
    }
}

/******************************************************************************/

const scriptletFilteringEngine = new ScriptletFilteringEngineEx();

export default scriptletFilteringEngine;

scripting.addRequestScriptletsListener(details => {
    console.info('SCRIPTLETLISTENER', JSON.stringify(details));
    if ( typeof details.frameId !== 'number' ) { return; }
    const hostname = hostnameFromURI(details.url);
    const domain = domainFromHostname(hostname);
    return scriptletFilteringEngine.retrieve({
        tabId: details.tabId,
        frameId: details.frameId,
        url: details.url,
        hostname,
        domain,
        ancestors: details.ancestors,
    });
});

/******************************************************************************/
