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

import logger from './logger.js';
import µb from './background.js';
import { sessionFirewall } from './filtering-engines.js';

import {
    StaticExtFilteringHostnameDB,
    StaticExtFilteringSessionDB,
} from './static-ext-filtering-db.js';

/******************************************************************************/

const pselectors = new Map();
const duplicates = new Set();

const filterDB = new StaticExtFilteringHostnameDB(2);
const sessionFilterDB = new StaticExtFilteringSessionDB();

let acceptedCount = 0;
let discardedCount = 0;
let docRegister;

const htmlFilteringEngine = {
    get acceptedCount() {
        return acceptedCount;
    },
    get discardedCount() {
        return discardedCount;
    },
    getFilterCount() {
        return filterDB.size;
    },
};

const PSelectorHasTextTask = class {
    constructor(task) {
        let arg0 = task[1], arg1;
        if ( Array.isArray(task[1]) ) {
            arg1 = arg0[1]; arg0 = arg0[0];
        }
        this.needle = new RegExp(arg0, arg1);
    }
    transpose(node, output) {
        if ( this.needle.test(node.textContent) ) {
            output.push(node);
        }
    }
};

const PSelectorIfTask = class {
    constructor(task) {
        this.pselector = new PSelector(task[1]);
    }
    transpose(node, output) {
        if ( this.pselector.test(node) === this.target ) {
            output.push(node);
        }
    }
    get invalid() {
        return this.pselector.invalid;
    }
};
PSelectorIfTask.prototype.target = true;

const PSelectorIfNotTask = class extends PSelectorIfTask {
};
PSelectorIfNotTask.prototype.target = false;

const PSelectorMinTextLengthTask = class {
    constructor(task) {
        this.min = task[1];
    }
    transpose(node, output) {
        if ( node.textContent.length >= this.min ) {
            output.push(node);
        }
    }
};

const PSelectorSpathTask = class {
    constructor(task) {
        this.spath = task[1];
    }
    transpose(node, output) {
        const parent = node.parentElement;
        if ( parent === null ) { return; }
        let pos = 1;
        for (;;) {
            node = node.previousElementSibling;
            if ( node === null ) { break; }
            pos += 1;
        }
        const nodes = parent.querySelectorAll(
            `:scope > :nth-child(${pos})${this.spath}`
        );
        for ( const node of nodes ) {
            output.push(node);
        }
    }
};

const PSelectorUpwardTask = class {
    constructor(task) {
        const arg = task[1];
        if ( typeof arg === 'number' ) {
            this.i = arg;
        } else {
            this.s = arg;
        }
    }
    transpose(node, output) {
        if ( this.s !== '' ) {
            const parent = node.parentElement;
            if ( parent === null ) { return; }
            node = parent.closest(this.s);
            if ( node === null ) { return; }
        } else {
            let nth = this.i;
            for (;;) {
                node = node.parentElement;
                if ( node === null ) { return; }
                nth -= 1;
                if ( nth === 0 ) { break; }
            }
        }
        output.push(node);
    }
};
PSelectorUpwardTask.prototype.i = 0;
PSelectorUpwardTask.prototype.s = '';

const PSelectorXpathTask = class {
    constructor(task) {
        this.xpe = task[1];
    }
    transpose(node, output) {
        const xpr = docRegister.evaluate(
            this.xpe,
            node,
            null,
            XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
            null
        );
        let j = xpr.snapshotLength;
        while ( j-- ) {
            const node = xpr.snapshotItem(j);
            if ( node.nodeType === 1 ) {
                output.push(node);
            }
        }
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
        if ( this.selector === '' ) { return [ root ]; }
        return Array.from(root.querySelectorAll(this.selector));
    }
    exec(input) {
        if ( this.invalid ) { return []; }
        let nodes = this.prime(input);
        for ( const task of this.tasks ) {
            if ( nodes.length === 0 ) { break; }
            const transposed = [];
            for ( const node of nodes ) {
                task.transpose(node, transposed);
            }
            nodes = transposed;
        }
        return nodes;
    }
    test(input) {
        if ( this.invalid ) { return false; }
        const nodes = this.prime(input);
        for ( const node of nodes ) {
            let output = [ node ];
            for ( const task of this.tasks ) {
                const transposed = [];
                for ( const node of output ) {
                    task.transpose(node, transposed);
                }
                output = transposed;
                if ( output.length === 0 ) { break; }
            }
            if ( output.length !== 0 ) { return true; }
        }
        return false;
    }
};
PSelector.prototype.operatorToTaskMap = new Map([
    [ ':has', PSelectorIfTask ],
    [ ':has-text', PSelectorHasTextTask ],
    [ ':if', PSelectorIfTask ],
    [ ':if-not', PSelectorIfNotTask ],
    [ ':min-text-length', PSelectorMinTextLengthTask ],
    [ ':not', PSelectorIfNotTask ],
    [ ':nth-ancestor', PSelectorUpwardTask ],
    [ ':spath', PSelectorSpathTask ],
    [ ':upward', PSelectorUpwardTask ],
    [ ':xpath', PSelectorXpathTask ],
]);
PSelector.prototype.invalid = false;

const logOne = function(details, exception, selector) {
    µb.filteringContext
        .duplicate()
        .fromTabId(details.tabId)
        .setRealm('extended')
        .setType('dom')
        .setURL(details.url)
        .setDocOriginFromURL(details.url)
        .setFilter({
            source: 'extended',
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
    let modified = false;
    for ( const node of nodes ) {
        node.remove();
        modified = true;
    }
    if ( modified && logger.enabled ) {
        logOne(details, 0, pselector.raw);
    }
    return modified;
};

const applyCSSSelector = function(details, selector) {
    const nodes = docRegister.querySelectorAll(selector);
    let modified = false;
    for ( const node of nodes ) {
        node.remove();
        modified = true;
    }
    if ( modified && logger.enabled ) {
        logOne(details, 0, selector);
    }
    return modified;
};

htmlFilteringEngine.reset = function() {
    filterDB.clear();
    pselectors.clear();
    duplicates.clear();
    acceptedCount = 0;
    discardedCount = 0;
};

htmlFilteringEngine.freeze = function() {
    duplicates.clear();
    filterDB.collectGarbage();
};

htmlFilteringEngine.compile = function(parser, writer) {
    const { raw, compiled, exception } = parser.result;
    if ( compiled === undefined ) {
        const who = writer.properties.get('name') || '?';
        logger.writeOne({
            realm: 'message',
            type: 'error',
            text: `Invalid HTML filter in ${who}: ##${raw}`
        });
        return;
    }

    writer.select('HTML_FILTERS');

    // TODO: Mind negated hostnames, they are currently discarded.

    for ( const { hn, not, bad } of parser.extOptions() ) {
        if ( bad ) { continue; }
        let kind = 0;
        if ( exception ) {
            if ( not ) { continue; }
            kind |= 0b01;
        }
        if ( compiled.charCodeAt(0) === 0x7B /* '{' */ ) {
            kind |= 0b10;
        }
        writer.push([ 64, hn, kind, compiled ]);
    }
};

htmlFilteringEngine.compileTemporary = function(parser) {
    return {
        session: sessionFilterDB,
        selector: parser.result.compiled,
    };
};

htmlFilteringEngine.fromCompiledContent = function(reader) {
    // Don't bother loading filters if stream filtering is not supported.
    if ( µb.canFilterResponseData === false ) { return; }

    reader.select('HTML_FILTERS');

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

htmlFilteringEngine.getSession = function() {
    return sessionFilterDB;
};

htmlFilteringEngine.retrieve = function(details) {
    const hostname = details.hostname;

    const plains = new Set();
    const procedurals = new Set();
    const exceptions = new Set();

    if ( sessionFilterDB.isNotEmpty ) {
        sessionFilterDB.retrieve([ null, exceptions ]);
    }
    filterDB.retrieve(
        hostname,
        [ plains, exceptions, procedurals, exceptions ]
    );
    const entity = details.entity !== ''
        ? `${hostname.slice(0, -details.domain.length)}${details.entity}`
        : '*';
    filterDB.retrieve(
        entity,
        [ plains, exceptions, procedurals, exceptions ],
        1
    );

    if ( plains.size === 0 && procedurals.size === 0 ) { return; }

    // https://github.com/gorhill/uBlock/issues/2835
    //   Do not filter if the site is under an `allow` rule.
    if (
        µb.userSettings.advancedUserEnabled &&
        sessionFirewall.evaluateCellZY(hostname, hostname, '*') === 2
    ) {
        return;
    }

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

htmlFilteringEngine.apply = function(doc, details) {
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

htmlFilteringEngine.toSelfie = function() {
    return filterDB.toSelfie();
};

htmlFilteringEngine.fromSelfie = function(selfie) {
    filterDB.fromSelfie(selfie);
    pselectors.clear();
};

/******************************************************************************/

export default htmlFilteringEngine;

/******************************************************************************/
