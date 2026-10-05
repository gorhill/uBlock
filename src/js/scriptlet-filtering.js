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

/******************************************************************************/

import '../lib/regexanalyzer/regex.js';

import * as makescriptlets from './make-scriptlets.js';
import * as scripting from './vapi-scripting.js';

import { ScriptletFilteringEngine } from './scriptlet-filtering-core.js';
import { builtinScriptlets } from './resources/scriptlets.js';
import cacheStorage from './cachestorage.js';
import { hostnameFromURI } from './uri-utils.js';
import logger from './logger.js';
import { onBroadcast } from './broadcast.js';
import { redirectEngine } from './redirect-engine.js';
import { sessionFirewall } from './filtering-engines.js';
import µb from './background.js';

/******************************************************************************/

function isTrustedContext(fn, data) {
    const docloc = document.location;
    const origins = document.location.ancestorOrigins;
    const url = origins?.length
        ? new URL(origins.item(origins.length-1))
        : docloc;
    return Boolean(fn(data, url.href, url.hostname));
}

function topFrameRulesMatcher(rules) {
    const docloc = document.location;
    const href = docloc.ancestorOrigins?.length
        ? docloc.ancestorOrigins.item(docloc.ancestorOrigins.length-1)
        : docloc.href;
    const topurl = new URL(href);
    const hostname = topurl.hostname;
    let pos = 0;
    do {
        const value = rules.get(hostname.slice(pos));
        if ( typeof value === 'boolean' ) { return value; }
        pos = hostname.indexOf('.', pos) + 1;
    } while ( pos !== 0 );
    return rules.get('*') === true;
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
    const code = [ '(function uBO_isolatedWorldScriptlets() {' ];
    code.push(`const SCRIPTLETGLOBALS = ${JSON.stringify(options.scriptletGlobals ?? {})};`);
    if ( options.scriptletGlobals?.bcSecret ) {
        code.push(initCommChannel.toString());
        code.push(`initCommChannel(${JSON.stringify(options.scriptletGlobals?.bcSecret)});`);
    }
    if ( options.debug ) { code.push('debugger;'); }
    code.push(isolatedCode ?? '');
    code.push('})();');
    return code.join('\n');
}

function assembleMainWorldWrapper(mainCode, options) {
    const code = [ '(function uBO_mainWorldScriptlets() {' ];
    if ( options.debug ) { code.push('debugger;'); }
    code.push(`const SCRIPTLETGLOBALS = ${JSON.stringify(options.scriptletGlobals ?? {})};`);
    code.push(mainCode ?? '');
    code.push('})();');
    return code.join('\n');
}

/******************************************************************************/

export class ScriptletFilteringEngineEx extends ScriptletFilteringEngine {
    constructor() {
        super();
        this.cacheKey = 'makescriptletsCommitResult';
        this.warOrigin = vAPI.getURL('/web_accessible_resources');
        this.warSecret = undefined;
        this.isDevBuild = undefined;
        this.logLevel = 1;
    }

    reset() {
        super.reset();
        cacheStorage.remove(this.cacheKey);
        scripting.unregisterContentScripts();
    }

    async freeze() {
        super.freeze();
        const result = await this.compileContentScripts();
        this.#startListening();
        return this.commitContentScripts(result);
    }

    async fromSelfie(selfie) {
        const r = await this.registerContentScripts();
        if ( r !== true ) { return false; }
        this.#startListening();
        return super.fromSelfie(selfie);
    }

    async registerContentScripts() {
        const bin = await cacheStorage.get(this.cacheKey);
        if ( Boolean(bin?.[this.cacheKey]) === false ) { return false; }
        await this.commitContentScripts(bin[this.cacheKey]);
        return true;
    }

    async compileContentScripts() {
        const map = this.scriptletDB.retrieveAll();
        makescriptlets.reset();
        makescriptlets.init(builtinScriptlets);
        const promises = [];
        for ( const [ name, entry ] of redirectEngine.resources ) {
            if ( entry.origin !== 'war' && entry.origin !== 'user' ) { continue; }
            if ( typeof entry.data !== 'string' ) { continue; }
            const details = Object.assign({}, entry, {
                name,
                code: entry.data,
            });
            promises.push(makescriptlets.importScriptlet(details));
        }
        await Promise.all(promises);
        for ( const [ rawargs, details ] of map ) {
            details.args = JSON.parse(rawargs);
            details.trustedSource = true;
            makescriptlets.compile('uBlock', details);
        }
        const template = await fetch('/js/scriptlet.template.js').then(response => {
            if ( response.ok !== true ) { return ''; }
            return response.text();
        });
        const result = template ? makescriptlets.commit('uBlock', template) : undefined;
        if ( result ) {
            await cacheStorage.set({ [this.cacheKey]: result });
        } else {
            await cacheStorage.remove(this.cacheKey);
        }
        return result;
    }

    commitContentScripts(result) {
        if ( Boolean(result) === false ) {
            return scripting.unregisterContentScripts();
        }
        if ( this.isDevBuild === undefined ) {
            this.isDevBuild = vAPI.webextFlavor.soup.has('devbuild') ||
                µb.hiddenSettings.filterAuthorMode;
        }
        this.warSecret = vAPI.warSecret.long(this.warSecret);
        const options = {
            scriptletGlobals: {
                warOrigin: this.warOrigin,
                warSecret: this.warSecret,
            },
        };
        if ( logger.enabled ) {
            options.scriptletGlobals.bcSecret = vAPI.generateSecret(3);
            options.scriptletGlobals.logLevel = this.logLevel;
        }
        if ( result['ISOLATED'] ) {
            options.debug = µb.hiddenSettings.debugIsolatedScriptlets;
            options.isolatedCode = assembleIsolatedWorldWrapper(result['ISOLATED'].code, options);
        }
        if ( result['MAIN'] ) {
            options.debug = µb.hiddenSettings.debugMainScriptlets;
            options.mainCode = assembleMainWorldWrapper(result['MAIN'].code, options);
        }
        const trustedSiteMatcher = µb.trustedSites.getMatcher();
        const earlyBailoutCode = [
            isTrustedContext.toString(),
            'if ( isTrustedContext(',
            `${trustedSiteMatcher.match.toString()},`,
            'new Map(',
            JSON.stringify(Array.from(trustedSiteMatcher.data).filter(a => a[0] !== '#')),
            ')) ) { return; }',
        ];
        const topFrameRules = sessionFirewall.export1stPartyRules().filter(a =>
            a[1] !== 'behind-the-scene'
        );
        if ( topFrameRules?.length ) {
            earlyBailoutCode.push(
                topFrameRulesMatcher.toString(),
                `if ( topFrameRulesMatcher(new Map(${JSON.stringify(topFrameRules)})) ) { return; }`,
            );
        }
        options.earlyBailoutCode = earlyBailoutCode.join('\n');
        return scripting.registerContentScripts(options);
    }

    retrieve(request) {
        const hostname = hostnameFromURI(request.url);
        // https://github.com/gorhill/uBlock/issues/2835
        // Do not inject scriptlets if the site is under an `allow` rule.
        if ( µb.userSettings.advancedUserEnabled ) {
            if ( sessionFirewall.evaluateCellZY(hostname, hostname, '*') === 2 ) {
                return false;
            }
        }
        return super.retrieve(request);
    }

    toLogger(request, filters) {
        if ( Array.isArray(filters) === false ) { return; }
        if ( logger.enabled !== true ) { return; }
        µb.filteringContext
            .duplicate()
            .fromTabId(request.tabId)
            .setRealm('extended')
            .setType('scriptlet')
            .setURL(request.url)
            .setDocOriginFromURL(request.url)
            .setFilter(filters.map(a => ({ source: 'extended', raw: a })))
            .toLogger();
    }

    #startListening() {
        if ( this.bc ) { return; }
        this.bc = onBroadcast(msg => {
            switch ( msg.what ) {
            case 'filteringBehaviorChanged':
                this.registerContentScripts();
                break;
            case 'hiddenSettingsChanged':
                this.isDevBuild = undefined;
                /* fall through */
            case 'loggerEnabled':
            case 'loggerDisabled':
                this.registerContentScripts();
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
                this.registerContentScripts();
                break;
            }
        });
    }
}

/******************************************************************************/

const scriptletFilteringEngine = new ScriptletFilteringEngineEx();

export default scriptletFilteringEngine;

/******************************************************************************/
