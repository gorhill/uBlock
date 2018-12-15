/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
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

'use strict';

/******************************************************************************/

µBlock.htmlFilteringEngine = (function() {
    const µb = µBlock;
    const pselectors = new Map();
    const duplicates = new Set();

    let filterDB = new µb.staticExtFilteringEngine.HostnameBasedDB(),
        acceptedCount = 0,
        discardedCount = 0,
        docRegister;

    const api = {
        get acceptedCount() {
            return acceptedCount;
        },
        get discardedCount() {
            return discardedCount;
        }
    };

    const PSelectorHasTextTask = function(task) {
        let arg0 = task[1], arg1;
        if ( Array.isArray(task[1]) ) {
            arg1 = arg0[1]; arg0 = arg0[0];
        }
        this.needle = new RegExp(arg0, arg1);
    };
    PSelectorHasTextTask.prototype.exec = function(input) {
        const output = [];
        for ( const node of input ) {
            if ( this.needle.test(node.textContent) ) {
                output.push(node);
            }
        }
        return output;
    };

    const PSelectorIfTask = function(task) {
        this.pselector = new PSelector(task[1]);
    };
    PSelectorIfTask.prototype.target = true;
    Object.defineProperty(PSelectorIfTask.prototype, 'invalid', {
        get: function() {
            return this.pselector.invalid;
        }
    });
    PSelectorIfTask.prototype.exec = function(input) {
        const output = [];
        for ( const node of input ) {
            if ( this.pselector.test(node) === this.target ) {
                output.push(node);
            }
        }
        return output;
    };

    const PSelectorIfNotTask = function(task) {
        PSelectorIfTask.call(this, task);
        this.target = false;
    };
    PSelectorIfNotTask.prototype = Object.create(PSelectorIfTask.prototype);
    PSelectorIfNotTask.prototype.constructor = PSelectorIfNotTask;

    const PSelectorXpathTask = function(task) {
        this.xpe = task[1];
    };
    PSelectorXpathTask.prototype.exec = function(input) {
        const output = [];
        const xpe = docRegister.createExpression(this.xpe, null);
        let xpr = null;
        for ( const node of input ) {
            xpr = xpe.evaluate(
                node,
                XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
                xpr
            );
            let j = xpr.snapshotLength;
            while ( j-- ) {
                const node = xpr.snapshotItem(j);
                if ( node.nodeType === 1 ) {
                    output.push(node);
                }
            }
        }
        return output;
    };

    const PSelector = function(o) {
        if ( PSelector.prototype.operatorToTaskMap === undefined ) {
            PSelector.prototype.operatorToTaskMap = new Map([
                [ ':has', PSelectorIfTask ],
                [ ':has-text', PSelectorHasTextTask ],
                [ ':if', PSelectorIfTask ],
                [ ':if-not', PSelectorIfNotTask ],
                [ ':not', PSelectorIfNotTask ],
                [ ':xpath', PSelectorXpathTask ]
            ]);
        }
        this.raw = o.raw;
        this.selector = o.selector;
        this.tasks = [];
        if ( !o.tasks ) { return; }
        for ( const task of o.tasks ) {
            const ctor = this.operatorToTaskMap.get(task[0]);
            if ( ctor === undefined ) {
                this.invalid = true;
                break;
            }
            const pselector = new ctor(task);
            if ( pselector instanceof PSelectorIfTask && pselector.invalid ) {
                this.invalid = true;
                break;
            }
            this.tasks.push(pselector);
        }
    };
    PSelector.prototype.operatorToTaskMap = undefined;
    PSelector.prototype.invalid = false;
    PSelector.prototype.prime = function(input) {
        const root = input || docRegister;
        if ( this.selector !== '' ) {
            return root.querySelectorAll(this.selector);
        }
        return [ root ];
    };
    PSelector.prototype.exec = function(input) {
        if ( this.invalid ) { return []; }
        let nodes = this.prime(input);
        for ( const task of this.tasks ) {
            if ( nodes.length === 0 ) { break; }
            nodes = task.exec(nodes);
        }
        return nodes;
    };
    PSelector.prototype.test = function(input) {
        if ( this.invalid ) { return false; }
        const nodes = this.prime(input);
        const AA = [ null ];
        for ( const node of nodes ) {
            AA[0] = node;
            let aa = AA;
            for ( const task of this.tasks ) {
                aa = task.exec(aa);
                if ( aa.length === 0 ) { break; }
            }
            if ( aa.length !== 0 ) { return true; }
        }
        return false;
    };

    const logOne = function(details, exception, selector) {
        µBlock.filteringContext
            .duplicate()
            .fromTabId(details.tabId)
            .setRealm('cosmetic')
            .setType('dom')
            .setURL(details.url)
            .setDocOriginFromURL(details.url)
            .setFilter({
                source: 'cosmetic',
                raw: (exception === 0 ? '##' : '#@#') + '^' + selector
            })
            .toLogger();
    };

    const applyProceduralSelector = function(details, selector) {
        let pselector = pselectors.get(selector);
        if ( pselector === undefined ) {
            pselector = new PSelector(JSON.parse(selector));
            pselectors.set(selector, pselector);
        }
        const nodes = pselector.exec();
        let i = nodes.length,
            modified = false;
        while ( i-- ) {
            const node = nodes[i];
            if ( node.parentNode !== null ) {
                node.parentNode.removeChild(node);
                modified = true;
            }
        }
        if ( modified && µb.logger.enabled ) {
            logOne(details, 0, pselector.raw);
        }
        return modified;
    };

    const applyCSSSelector = function(details, selector) {
        const nodes = docRegister.querySelectorAll(selector);
        let i = nodes.length,
            modified = false;
        while ( i-- ) {
            const node = nodes[i];
            if ( node.parentNode !== null ) {
                node.parentNode.removeChild(node);
                modified = true;
            }
        }
        if ( modified && µb.logger.enabled ) {
            logOne(details, 0, selector);
        }
        return modified;
    };

    api.reset = function() {
        filterDB.clear();
        pselectors.clear();
        duplicates.clear();
        acceptedCount = 0;
        discardedCount = 0;
    };

    api.freeze = function() {
        duplicates.clear();
    };

    api.compile = function(parsed, writer) {
        const selector = parsed.suffix.slice(1).trim();
        const compiled = µb.staticExtFilteringEngine.compileSelector(selector);
        if ( compiled === undefined ) {
            const who = writer.properties.get('assetKey') || '?';
            µb.logger.writeOne({
                error: `Invalid HTML filter in ${who} : ##${selector}`
            });
            return;
        }

        // 1002 = html filtering
        writer.select(1002);

        // TODO: Mind negated hostnames, they are currently discarded.

        for ( const hn of parsed.hostnames ) {
            if ( hn.charCodeAt(0) === 0x7E /* '~' */ ) { continue; }
            let hash = µb.staticExtFilteringEngine.compileHostnameToHash(hn);
            if ( parsed.exception ) {
                hash |= 0b0001;
            }
            writer.push([
                compiled.charCodeAt(0) !== 0x7B /* '{' */ ? 64 : 65,
                hash,
                hn,
                compiled
            ]);
        }
    };

    api.fromCompiledContent = function(reader) {
        // Don't bother loading filters if stream filtering is not supported.
        if ( µb.canFilterResponseData === false ) { return; }

        // 1002 = html filtering
        reader.select(1002);

        while ( reader.next() ) {
            acceptedCount += 1;
            const fingerprint = reader.fingerprint();
            if ( duplicates.has(fingerprint) ) {
                discardedCount += 1;
                continue;
            }
            duplicates.add(fingerprint);
            const args = reader.args();
            filterDB.add(args[1], {
                type: args[0],
                hostname: args[2],
                selector: args[3]
            });
        }
    };

    api.retrieve = function(details) {
        const hostname = details.hostname;

        // https://github.com/gorhill/uBlock/issues/2835
        //   Do not filter if the site is under an `allow` rule.
        if (
            µb.userSettings.advancedUserEnabled &&
            µb.sessionFirewall.evaluateCellZY(hostname, hostname, '*') === 2
        ) {
            return;
        }

        const toRemoveArray = [];
        const domainHash = µb.staticExtFilteringEngine.makeHash(details.domain);
        if ( domainHash !== 0 ) {
            filterDB.retrieve(domainHash, hostname, toRemoveArray);
        }
        const entity = details.entity;
        const entityHash = µb.staticExtFilteringEngine.makeHash(entity);
        if ( entityHash !== 0 ) {
            filterDB.retrieve(entityHash, entity, toRemoveArray);
        }
        filterDB.retrieve(0, hostname, toRemoveArray);
        if ( toRemoveArray.length === 0 ) { return; }

        let notToRemoveArray = [];
        if ( domainHash !== 0 ) {
            filterDB.retrieve(domainHash | 0b0001, hostname, notToRemoveArray);
        }
        if ( entityHash !== 0 ) {
            filterDB.retrieve(entityHash | 0b0001, entity, notToRemoveArray);
        }
        filterDB.retrieve(0 | 0b0001, hostname, notToRemoveArray);
        if ( notToRemoveArray.length === 0 ) {
            return toRemoveArray;
        }

        const toRemoveMap = new Map();
        for ( const entry of toRemoveArray ) {
            toRemoveMap.set(entry.selector, entry);
        }
        for ( const entry of notToRemoveArray ) {
            if ( toRemoveMap.has(entry.selector) === false ) { continue; }
            toRemoveMap.delete(entry.selector);
            if ( µb.logger.enabled === false ) { continue; }
            let selector = entry.selector;
            if ( entry.type === 65 ) {
                selector = JSON.parse(selector).raw;
            }
            logOne(details, 1, selector);
        }

        if ( toRemoveMap.size === 0 ) { return; }
        return Array.from(toRemoveMap.values());
    };

    api.apply = function(doc, details) {
        docRegister = doc;
        let modified = false;
        for ( const entry of details.selectors ) {
            if ( entry.type === 64 ) {
                if ( applyCSSSelector(details, entry.selector) ) {
                    modified = true;
                }
            } else /* if ( entry.type === 65 ) */ {
                if ( applyProceduralSelector(details, entry.selector) ) {
                    modified = true;
                }
            }
        }

        docRegister = undefined;
        return modified;
    };

    api.toSelfie = function() {
        return filterDB.toSelfie();
    };

    api.fromSelfie = function(selfie) {
        filterDB = new µb.staticExtFilteringEngine.HostnameBasedDB(selfie);
        pselectors.clear();
    };

    return api;
})();

/******************************************************************************/
