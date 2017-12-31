/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2017 Raymond Hill

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
    var api = {};

    var µb = µBlock,
        filterDB = new µb.staticExtFilteringEngine.HostnameBasedDB(),
        pselectors = new Map(),
        duplicates = new Set(),
        acceptedCount = 0,
        discardedCount = 0,
        docRegister, loggerRegister;

    var PSelectorHasTextTask = function(task) {
        var arg0 = task[1], arg1;
        if ( Array.isArray(task[1]) ) {
            arg1 = arg0[1]; arg0 = arg0[0];
        }
        this.needle = new RegExp(arg0, arg1);
    };
    PSelectorHasTextTask.prototype.exec = function(input) {
        var output = [];
        for ( var node of input ) {
            if ( this.needle.test(node.textContent) ) {
                output.push(node);
            }
        }
        return output;
    };

    var PSelectorIfTask = function(task) {
        this.pselector = new PSelector(task[1]);
    };
    PSelectorIfTask.prototype.target = true;
    Object.defineProperty(PSelectorIfTask.prototype, 'invalid', {
        get: function() {
            return this.pselector.invalid;
        }
    });
    PSelectorIfTask.prototype.exec = function(input) {
        var output = [];
        for ( var node of input ) {
            if ( this.pselector.test(node) === this.target ) {
                output.push(node);
            }
        }
        return output;
    };

    var PSelectorIfNotTask = function(task) {
        PSelectorIfTask.call(this, task);
        this.target = false;
    };
    PSelectorIfNotTask.prototype = Object.create(PSelectorIfTask.prototype);
    PSelectorIfNotTask.prototype.constructor = PSelectorIfNotTask;

    var PSelectorXpathTask = function(task) {
        this.xpe = task[1];
    };
    PSelectorXpathTask.prototype.exec = function(input) {
        var output = [],
            xpe = docRegister.createExpression(this.xpe, null),
            xpr = null;
        for ( var node of input ) {
            xpr = xpe.evaluate(
                node,
                XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
                xpr
            );
            var j = xpr.snapshotLength;
            while ( j-- ) {
                node = xpr.snapshotItem(j);
                if ( node.nodeType === 1 ) {
                    output.push(node);
                }
            }
        }
        return output;
    };

    var PSelector = function(o) {
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
        var tasks = o.tasks;
        if ( !tasks ) { return; }
        for ( var task of tasks ) {
            var ctor = this.operatorToTaskMap.get(task[0]);
            if ( ctor === undefined ) {
                this.invalid = true;
                break;
            }
            var pselector = new ctor(task);
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
        var root = input || docRegister;
        if ( this.selector !== '' ) {
            return root.querySelectorAll(this.selector);
        }
        return [ root ];
    };
    PSelector.prototype.exec = function(input) {
        if ( this.invalid ) { return []; }
        var nodes = this.prime(input);
        for ( var task of this.tasks ) {
            if ( nodes.length === 0 ) { break; }
            nodes = task.exec(nodes);
        }
        return nodes;
    };
    PSelector.prototype.test = function(input) {
        if ( this.invalid ) { return false; }
        var nodes = this.prime(input), AA = [ null ], aa;
        for ( var node of nodes ) {
            AA[0] = node; aa = AA;
            for ( var task of this.tasks ) {
                aa = task.exec(aa);
                if ( aa.length === 0 ) { break; }
            }
            if ( aa.length !== 0 ) { return true; }
        }
        return false;
    };

    var logOne = function(details, selector) {
        loggerRegister.writeOne(
            details.tabId,
            'cosmetic',
            { source: 'cosmetic', raw: '##^' + selector },
            'dom',
            details.url,
            null,
            details.hostname
        );
    };

    var applyProceduralSelector = function(details, selector) {
        var pselector = pselectors.get(selector);
        if ( pselector === undefined ) {
            pselector = new PSelector(JSON.parse(selector));
            pselectors.set(selector, pselector);
        }
        var nodes = pselector.exec(),
            i = nodes.length,
            modified = false;
        while ( i-- ) {
            var node = nodes[i];
            if ( node.parentNode !== null ) {
                node.parentNode.removeChild(node);
                modified = true;
            }
        }
        if ( modified && loggerRegister.isEnabled() ) {
            logOne(details, pselector.raw);
        }
        return modified;
    };

    var applyCSSSelector = function(details, selector) {
        var nodes = docRegister.querySelectorAll(selector),
            i = nodes.length,
            modified = false;
        while ( i-- ) {
            var node = nodes[i];
            if ( node.parentNode !== null ) {
                node.parentNode.removeChild(node);
                modified = true;
            }
        }
        if ( modified && loggerRegister.isEnabled() ) {
            logOne(details, selector);
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
        var selector = parsed.suffix.slice(1).trim(),
            compiled = µb.staticExtFilteringEngine.compileSelector(selector);
        if ( compiled === undefined ) { return; }

        // 1002 = html filtering
        writer.select(1002);

        // TODO: Mind negated hostnames, they are currently discarded.

        for ( var hostname of parsed.hostnames ) {
            if ( hostname.charCodeAt(0) === 0x7E /* '~' */ ) { continue; }
            var domain = µb.URI.domainFromHostname(hostname);
            writer.push([
                compiled.charCodeAt(0) !== 0x7B /* '{' */ ? 64 : 65,
                parsed.exception ? '!' + domain : domain,
                hostname,
                compiled
            ]);
        }
    };

    api.fromCompiledContent = function(reader) {
        // Don't bother loading filters if stream filtering is not supported.
        //if ( µb.canFilterResponseBody === false ) { return; }

        // 1002 = html filtering
        reader.select(1002);

        while ( reader.next() ) {
            acceptedCount += 1;
            var fingerprint = reader.fingerprint();
            if ( duplicates.has(fingerprint) ) {
                discardedCount += 1;
                continue;
            }
            duplicates.add(fingerprint);
            var args = reader.args();
            filterDB.add(args[1], {
                type: args[0],
                hostname: args[2],
                selector: args[3]
            });
        }
    };

    api.retrieve = function(request) {
        var hostname = request.hostname;

        // https://github.com/gorhill/uBlock/issues/2835
        //   Do not filter if the site is under an `allow` rule.
        if (
            µb.userSettings.advancedUserEnabled &&
            µb.sessionFirewall.evaluateCellZY(hostname, hostname, '*') === 2
        ) {
            return;
        }

        var out = [];
        if ( request.domain !== '' ) {
            filterDB.retrieve(request.domain, hostname, out);
            filterDB.retrieve(request.entity, request.entity, out);
        }
        filterDB.retrieve('', hostname, out);

        // TODO: handle exceptions.

        if ( out.length !== 0 ) {
            return out;
        }
    };

    api.apply = function(doc, details) {
        docRegister = doc;
        loggerRegister = µb.logger;
        var modified = false;
        for ( var entry of details.selectors ) {
            if ( entry.type === 64 ) {
                if ( applyCSSSelector(details, entry.selector) ) {
                    modified = true;
                }
            } else {
                if ( applyProceduralSelector(details, entry.selector) ) {
                    modified = true;
                }
            }
        }

        docRegister = loggerRegister = undefined;
        return modified;
    };

    api.toSelfie = function() {
        return filterDB.toSelfie();
    };

    api.fromSelfie = function(selfie) {
        filterDB = new µb.staticExtFilteringEngine.HostnameBasedDB(selfie);
        pselectors.clear();
    };

    // TODO: Following methods is useful only to legacy Firefox. This can be
    //       removed once support for legacy Firefox is dropped. The only care
    //       at this point is for the code to work, not to be efficient.
    //       Only `script:has-text` selectors are considered.

    api.retrieveScriptTagHostnames = function() {
        var out = new Set();
        for ( var entry of filterDB ) {
            if ( entry.type !== 65 ) { continue; }
            var o = JSON.parse(entry.selector);
            if (
                o.tasks.length === 1 &&
                o.tasks[0].length === 2 &&
                o.tasks[0][0] === ':has-text'
            ) {
                out.add(entry.hostname);
            }
        }
        if ( out.size !== 0 ) {
            return Array.from(out);
        }
    };

    api.retrieveScriptTagRegex = function(domain, hostname) {
        var entries = api.retrieve({
            hostname: hostname,
            domain: domain,
            entity: µb.URI.entityFromDomain(domain)
        });
        if ( entries === undefined ) { return; }
        var out = new Set();
        for ( var entry of entries ) {
            if ( entry.type !== 65 ) { continue; }
            var o = JSON.parse(entry.selector);
            if (
                o.tasks.length === 1 &&
                o.tasks[0].length === 2 &&
                o.tasks[0][0] === ':has-text'
            ) {
                out.add(o.tasks[0][1]);
            }
        }
        if ( out.size !== 0 ) {
            return Array.from(out).join('|');
        }
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
