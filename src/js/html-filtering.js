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

    let filterDB = new µb.staticExtFilteringEngine.HostnameBasedDB(2),
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

    const PSelectorHasTextTask = class {
        constructor(task) {
            let arg0 = task[1], arg1;
            if ( Array.isArray(task[1]) ) {
                arg1 = arg0[1]; arg0 = arg0[0];
            }
            this.needle = new RegExp(arg0, arg1);
        }
        exec(input) {
            const output = [];
            for ( const node of input ) {
                if ( this.needle.test(node.textContent) ) {
                    output.push(node);
                }
            }
            return output;
        }
    };

    const PSelectorIfTask = class {
        constructor(task) {
            this.pselector = new PSelector(task[1]);
        }
        exec(input) {
            const output = [];
            for ( const node of input ) {
                if ( this.pselector.test(node) === this.target ) {
                    output.push(node);
                }
            }
            return output;
        }
        get invalid() {
            return this.pselector.invalid;
        }
    };
    PSelectorIfTask.prototype.target = true;

    const PSelectorIfNotTask = class extends PSelectorIfTask {
        constructor(task) {
            super.call(task);
            this.target = false;
        }
    };

    const PSelectorNthAncestorTask = class {
        constructor(task) {
            this.nth = task[1];
        }
        exec(input) {
            const output = [];
            for ( let node of input ) {
                let nth = this.nth;
                for (;;) {
                    node = node.parentElement;
                    if ( node === null ) { break; }
                    nth -= 1;
                    if ( nth !== 0 ) { continue; }
                    output.push(node);
                    break;
                }
            }
            return output;
        }
    };

    const PSelectorXpathTask = class {
        constructor(task) {
            this.xpe = task[1];
        }
        exec(input) {
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
        }
    };

    const PSelector = class {
        constructor(o) {
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
        }
        prime(input) {
            const root = input || docRegister;
            if ( this.selector !== '' ) {
                return root.querySelectorAll(this.selector);
            }
            return [ root ];
        }
        exec(input) {
            if ( this.invalid ) { return []; }
            let nodes = this.prime(input);
            for ( const task of this.tasks ) {
                if ( nodes.length === 0 ) { break; }
                nodes = task.exec(nodes);
            }
            return nodes;
        }
        test(input) {
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
        }
    };
    PSelector.prototype.operatorToTaskMap = new Map([
        [ ':has', PSelectorIfTask ],
        [ ':has-text', PSelectorHasTextTask ],
        [ ':if', PSelectorIfTask ],
        [ ':if-not', PSelectorIfNotTask ],
        [ ':not', PSelectorIfNotTask ],
        [ ':nth-ancestor', PSelectorNthAncestorTask ],
        [ ':xpath', PSelectorXpathTask ]
    ]);
    PSelector.prototype.invalid = false;

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
                raw: `${exception === 0 ? '##' : '#@#'}^${selector}`
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
        filterDB.collectGarbage();
    };

    api.compile = function(parsed, writer) {
        const selector = parsed.suffix.slice(1).trim();
        const compiled = µb.staticExtFilteringEngine.compileSelector(selector);
        if ( compiled === undefined ) {
            const who = writer.properties.get('assetKey') || '?';
            µb.logger.writeOne({
                realm: 'message',
                type: 'error',
                text: `Invalid HTML filter in ${who}: ##${selector}`
            });
            return;
        }

        // 1002 = html filtering
        writer.select(1002);

        // TODO: Mind negated hostnames, they are currently discarded.

        for ( const hn of parsed.hostnames ) {
            if ( hn.charCodeAt(0) === 0x7E /* '~' */ ) { continue; }
            let kind = 0;
            if ( parsed.exception ) {
                kind |= 0b01;
            }
            if ( compiled.charCodeAt(0) === 0x7B /* '{' */ ) {
                kind |= 0b10;
            }
            writer.push([ 64, hn, kind, compiled ]);
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
            filterDB.store(args[1], args[2], args[3]);
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

        const plains = new Set();
        const procedurals = new Set();
        const exceptions = new Set();

        filterDB.retrieve(
            hostname,
            [ plains, exceptions, procedurals, exceptions ]
        );
        if ( details.entity !== '' ) {
            filterDB.retrieve(
                `${hostname.slice(0, -details.domain)}${details.entity}`,
                [ plains, exceptions, procedurals, exceptions ]
            );
        }
    
        if ( plains.size === 0 && procedurals.size === 0 ) { return; }

        const out = { plains, procedurals };

        if ( exceptions.size === 0 ) {
            return out;
        }

        for ( const selector of exceptions ) {
            if ( plains.has(selector) ) {
                plains.delete(selector);
                logOne(details, 1, selector);
                continue;
            }
            if ( procedurals.has(selector) ) {
                procedurals.delete(selector);
                logOne(details, 1, JSON.parse(selector).raw);
                continue;
            }
        }

        if ( plains.size !== 0 || procedurals.size !== 0 ) {
            return out;
        }
    };

    api.apply = function(doc, details) {
        docRegister = doc;
        let modified = false;
        for ( const selector of details.selectors.plains ) {
            if ( applyCSSSelector(details, selector) ) {
                modified = true;
            }
        }
        for ( const selector of details.selectors.procedurals ) {
            if ( applyProceduralSelector(details, selector) ) {
                modified = true;
            }
        }

        docRegister = undefined;
        return modified;
    };

    api.toSelfie = function() {
        return filterDB.toSelfie();
    };

    api.fromSelfie = function(selfie) {
        filterDB = new µb.staticExtFilteringEngine.HostnameBasedDB(2, selfie);
        pselectors.clear();
    };

    return api;
})();

/******************************************************************************/
