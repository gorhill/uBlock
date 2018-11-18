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
    const api = {};

    const µb = µBlock,
        pselectors = new Map(),
        duplicates = new Set();
    let filterDB = new µb.staticExtFilteringEngine.HostnameBasedDB(),
        acceptedCount = 0,
        discardedCount = 0,
        docRegister;

    const PSelectorHasTextTask = function(task) {
        let arg0 = task[1], arg1;
        if ( Array.isArray(task[1]) ) {
            arg1 = arg0[1]; arg0 = arg0[0];
        }
        this.needle = new RegExp(arg0, arg1);
    };
    PSelectorHasTextTask.prototype.exec = function(input) {
        let output = [];
        for ( let node of input ) {
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
        let output = [];
        for ( let node of input ) {
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
        let output = [],
            xpe = docRegister.createExpression(this.xpe, null),
            xpr = null;
        for ( let node of input ) {
            xpr = xpe.evaluate(
                node,
                XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
                xpr
            );
            let j = xpr.snapshotLength;
            while ( j-- ) {
                node = xpr.snapshotItem(j);
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
                [ ':xpath', PSelectorXpathTask ]
            ]);
        }
        this.raw = o.raw;
        this.selector = o.selector;
        this.tasks = [];
        if ( !o.tasks ) { return; }
        for ( let task of o.tasks ) {
            let ctor = this.operatorToTaskMap.get(task[0]);
            if ( ctor === undefined ) {
                this.invalid = true;
                break;
            }
            let pselector = new ctor(task);
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
        let root = input || docRegister;
        if ( this.selector !== '' ) {
            return root.querySelectorAll(this.selector);
        }
        return [ root ];
    };
    PSelector.prototype.exec = function(input) {
        if ( this.invalid ) { return []; }
        let nodes = this.prime(input);
        for ( let task of this.tasks ) {
            if ( nodes.length === 0 ) { break; }
            nodes = task.exec(nodes);
        }
        return nodes;
    };
    PSelector.prototype.test = function(input) {
        if ( this.invalid ) { return false; }
        let nodes = this.prime(input), AA = [ null ], aa;
        for ( let node of nodes ) {
            AA[0] = node; aa = AA;
            for ( var task of this.tasks ) {
                aa = task.exec(aa);
                if ( aa.length === 0 ) { break; }
            }
            if ( aa.length !== 0 ) { return true; }
        }
        return false;
    };

    const logOne = function(details, exception, selector) {
        µb.logger.writeOne(
            details.tabId,
            'cosmetic',
            {
                source: 'cosmetic',
                raw: (exception === 0 ? '##' : '#@#') + '^' + selector
            },
            'dom',
            details.url,
            null,
            details.hostname
        );
    };

    const applyProceduralSelector = function(details, selector) {
        let pselector = pselectors.get(selector);
        if ( pselector === undefined ) {
            pselector = new PSelector(JSON.parse(selector));
            pselectors.set(selector, pselector);
        }
        let nodes = pselector.exec(),
            i = nodes.length,
            modified = false;
        while ( i-- ) {
            let node = nodes[i];
            if ( node.parentNode !== null ) {
                node.parentNode.removeChild(node);
                modified = true;
            }
        }
        if ( modified && µb.logger.isEnabled() ) {
            logOne(details, 0, pselector.raw);
        }
        return modified;
    };

    const applyCSSSelector = function(details, selector) {
        let nodes = docRegister.querySelectorAll(selector),
            i = nodes.length,
            modified = false;
        while ( i-- ) {
            let node = nodes[i];
            if ( node.parentNode !== null ) {
                node.parentNode.removeChild(node);
                modified = true;
            }
        }
        if ( modified && µb.logger.isEnabled() ) {
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
        let selector = parsed.suffix.slice(1).trim(),
            compiled = µb.staticExtFilteringEngine.compileSelector(selector);
        if ( compiled === undefined ) { return; }

        // 1002 = html filtering
        writer.select(1002);

        // TODO: Mind negated hostnames, they are currently discarded.

        for ( let hn of parsed.hostnames ) {
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
            let fingerprint = reader.fingerprint();
            if ( duplicates.has(fingerprint) ) {
                discardedCount += 1;
                continue;
            }
            duplicates.add(fingerprint);
            let args = reader.args();
            filterDB.add(args[1], {
                type: args[0],
                hostname: args[2],
                selector: args[3]
            });
        }
    };

    api.retrieve = function(details) {
        let hostname = details.hostname;

        // https://github.com/gorhill/uBlock/issues/2835
        //   Do not filter if the site is under an `allow` rule.
        if (
            µb.userSettings.advancedUserEnabled &&
            µb.sessionFirewall.evaluateCellZY(hostname, hostname, '*') === 2
        ) {
            return;
        }

        let toRemoveArray = [];
        let domainHash = µb.staticExtFilteringEngine.makeHash(details.domain);
        if ( domainHash !== 0 ) {
            filterDB.retrieve(domainHash, hostname, toRemoveArray);
        }
        let entity = details.entity;
        let entityHash = µb.staticExtFilteringEngine.makeHash(entity);
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

        let toRemoveMap = new Map();
        for ( let entry of toRemoveArray ) {
            toRemoveMap.set(entry.selector, entry);
        }
        for ( let entry of notToRemoveArray ) {
            if ( toRemoveMap.has(entry.selector) === false ) { continue; }
            toRemoveMap.delete(entry.selector);
            if ( µb.logger.isEnabled() === false ) { continue; }
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
        for ( let entry of details.selectors ) {
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

    Object.defineProperties(api, {
        acceptedCount: {
            get: function() {
                return acceptedCount;
            }
        },
        discardedCount: {
            get: function() {
                return discardedCount;
            }
        }
    });

    return api;
})();

/******************************************************************************/
