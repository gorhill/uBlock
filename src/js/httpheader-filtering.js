/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2021-present Raymond Hill

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
import { entityFromDomain } from './uri-utils.js';
import { sessionFirewall } from './filtering-engines.js';

import {
    StaticExtFilteringHostnameDB,
    StaticExtFilteringSessionDB,
} from './static-ext-filtering-db.js';

/******************************************************************************/

const duplicates = new Set();
const filterDB = new StaticExtFilteringHostnameDB(1);
const sessionFilterDB = new StaticExtFilteringSessionDB();

const $headers = new Set();
const $exceptions = new Set();

let acceptedCount = 0;
let discardedCount = 0;

const headerIndexFromName = function(name, headers) {
    let i = headers.length;
    while ( i-- ) {
        if ( headers[i].name.toLowerCase() === name ) {
            return i;
        }
    }
    return -1;
};

const logOne = function(isException, token, fctxt) {
    fctxt.duplicate()
        .setRealm('extended')
        .setType('header')
        .setFilter({
            modifier: true,
            result: isException ? 2 : 1,
            source: 'extended',
            raw: `${(isException ? '#@#' : '##')}^responseheader(${token})`
        })
        .toLogger();
};

const httpheaderFilteringEngine = {
    get acceptedCount() {
        return acceptedCount;
    },
    get discardedCount() {
        return discardedCount;
    }
};

httpheaderFilteringEngine.reset = function() {
    filterDB.clear();
    duplicates.clear();
    acceptedCount = 0;
    discardedCount = 0;
};

httpheaderFilteringEngine.freeze = function() {
    duplicates.clear();
    filterDB.collectGarbage();
};

httpheaderFilteringEngine.compile = function(parser, writer) {
    writer.select('HTTPHEADER_FILTERS');

    const { compiled, exception } = parser.result;
    const headerName = compiled.slice(15, -1);

    // Tokenless is meaningful only for exception filters.
    if ( headerName === '' && exception === false ) { return; }

    // Only exception filters are allowed to be global.
    if ( parser.hasOptions() === false ) {
        if ( exception ) {
            writer.push([ 64, '', 1, compiled ]);
        }
        return;
    }

    // https://github.com/gorhill/uBlock/issues/3375
    //   Ignore instances of exception filter with negated hostnames,
    //   because there is no way to create an exception to an exception.

    for ( const { hn, not, bad } of parser.extOptions() ) {
        if ( bad ) { continue; }
        let kind = 0;
        if ( exception ) {
            if ( not ) { continue; }
            kind |= 1;
        } else if ( not ) {
            kind |= 1;
        }
        writer.push([ 64, hn, kind, compiled ]);
    }
};

httpheaderFilteringEngine.compileTemporary = function(parser) {
    return {
        session: sessionFilterDB,
        selector: parser.result.compiled.slice(15, -1),
    };
};

// 01234567890123456789
// responseheader(name)
//                ^   ^
//               15  -1

httpheaderFilteringEngine.fromCompiledContent = function(reader) {
    reader.select('HTTPHEADER_FILTERS');

    while ( reader.next() ) {
        acceptedCount += 1;
        const fingerprint = reader.fingerprint();
        if ( duplicates.has(fingerprint) ) {
            discardedCount += 1;
            continue;
        }
        duplicates.add(fingerprint);
        const args = reader.args();
        if ( args.length < 4 ) { continue; }
        filterDB.store(args[1], args[2], args[3].slice(15, -1));
    }
};

httpheaderFilteringEngine.getSession = function() {
    return sessionFilterDB;
};

httpheaderFilteringEngine.apply = function(fctxt, headers) {
    if ( filterDB.size === 0 ) { return; }

    const hostname = fctxt.getHostname();
    if ( hostname === '' ) { return; }

    const domain = fctxt.getDomain();
    let entity = entityFromDomain(domain);
    if ( entity !== '' ) {
        entity = `${hostname.slice(0, -domain.length)}${entity}`;
    } else {
        entity = '*';
    }

    $headers.clear();
    $exceptions.clear();

    if ( sessionFilterDB.isNotEmpty ) {
        sessionFilterDB.retrieve([ null, $exceptions ]);
    }
    filterDB.retrieve(hostname, [ $headers, $exceptions ]);
    filterDB.retrieve(entity, [ $headers, $exceptions ], 1);
    if ( $headers.size === 0 ) { return; }

    // https://github.com/gorhill/uBlock/issues/2835
    //   Do not filter response headers if the site is under an `allow` rule.
    if (
        µb.userSettings.advancedUserEnabled &&
        sessionFirewall.evaluateCellZY(hostname, hostname, '*') === 2
    ) {
        return;
    }

    const hasGlobalException = $exceptions.has('');

    let modified = false;

    for ( const name of $headers ) {
        for (;;) {
            const i = headerIndexFromName(name, headers);
            if ( i === -1 ) { break; }
            const isExcepted = hasGlobalException || $exceptions.has(name);
            if ( isExcepted ) {
                if ( logger.enabled ) {
                    logOne(true, hasGlobalException ? '' : name, fctxt);
                }
                break;
            }
            headers.splice(i, 1);
            if ( logger.enabled ) {
                logOne(false, name, fctxt);
            }
            modified = true;
        }
    }

    return modified;
};

httpheaderFilteringEngine.toSelfie = function() {
    return filterDB.toSelfie();
};

httpheaderFilteringEngine.fromSelfie = function(selfie) {
    filterDB.fromSelfie(selfie);
};

/******************************************************************************/

export default httpheaderFilteringEngine;

/******************************************************************************/
