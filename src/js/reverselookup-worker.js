/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-2017 Raymond Hill

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

/* global onmessage, postMessage */

'use strict';

/******************************************************************************/

var listEntries = Object.create(null),
    filterClassSeparator = '\n/* end of network - start of cosmetic */\n';

/******************************************************************************/

var fromNetFilter = function(details) {
    var lists = [],
        compiledFilter = details.compiledFilter,
        entry, content, pos, notFound;
    for ( var assetKey in listEntries ) {
        entry = listEntries[assetKey];
        if ( entry === undefined ) { continue; }
        content = entry.content.slice(
            0,
            entry.content.indexOf(filterClassSeparator)
        );
        pos = 0;
        for (;;) {
            pos = content.indexOf(compiledFilter, pos);
            if ( pos === -1 ) { break; }
            // We need an exact match.
            // https://github.com/gorhill/uBlock/issues/1392
            // https://github.com/gorhill/uBlock/issues/835
            notFound = pos !== 0 && content.charCodeAt(pos - 1) !== 0x0A;
            pos += compiledFilter.length;
            if (
                notFound ||
                pos !== content.length && content.charCodeAt(pos) !== 0x0A
            ) {
                continue;
            }
            lists.push({
                title: entry.title,
                supportURL: entry.supportURL
            });
            break;
        }
    }

    var response = {};
    response[details.rawFilter] = lists;

    postMessage({
        id: details.id,
        response: response
    });
};

/******************************************************************************/

// Looking up filter lists from a cosmetic filter is a bit more complicated
// than with network filters:
//
// The filter is its raw representation, not its compiled version. This is
// because the cosmetic filtering engine can't translate a live cosmetic
// filter into its compiled version. Reason is I do not want to burden
// cosmetic filtering with the resource overhead of being able to re-compile
// live cosmetic filters. I want the cosmetic filtering code to be left
// completely unaffected by reverse lookup requirements.
//
// Mainly, given a CSS selector and a hostname as context, we will derive
// various versions of compiled filters and see if there are matches. This way
// the whole CPU cost is incurred by the reverse lookup code -- in a worker
// thread, and the cosmetic filtering engine incurs no cost at all.
//
// For this though, the reverse lookup code here needs some knowledge of
// the inners of the cosmetic filtering engine.
// FilterContainer.fromCompiledContent() is our reference code to create
// the various compiled versions.

var fromCosmeticFilter = function(details) {
    var match = /^#@?#/.exec(details.rawFilter),
        prefix = match[0],
        selector = details.rawFilter.slice(prefix.length);

    // The longer the needle, the lower the number of false positives.
    var needles = selector.match(/\w+/g).sort(function(a, b) {
        return b.length - a.length;
    });
    var reNeedle = new RegExp(needles[0], 'g');

    var reHostname = new RegExp(
        '^' +
        details.hostname.split('.').reduce(
            function(acc, item) {
                return acc === ''
                     ? item
                    : '(' + acc + '\\.)?' + item;
            },
            ''
        ) +
        '$'
    );

    var reEntity,
        domain = details.domain,
        pos = domain.indexOf('.');
    if ( pos !== -1 ) {
        reEntity = new RegExp(
            '^' +
            domain.slice(0, pos).split('.').reduce(
                function(acc, item) {
                    return acc === ''
                         ? item
                        : '(' + acc + '\\.)?' + item;
                },
                ''
            ) +
            '\\.\\*$'
        );
    }
        
    var response = Object.create(null),
        assetKey, entry, content, found, beg, end, fargs;

    for ( assetKey in listEntries ) {
        entry = listEntries[assetKey];
        if ( entry === undefined ) { continue; }
        content = entry.content.slice(
            entry.content.indexOf(filterClassSeparator) +
            filterClassSeparator.length
        );
        found = undefined;
        while ( (match = reNeedle.exec(content)) !== null ) {
            beg = content.lastIndexOf('\n', match.index);
            if ( beg === -1 ) { beg = 0; }
            end = content.indexOf('\n', reNeedle.lastIndex);
            if ( end === -1 ) { end = content.length; }
            fargs = JSON.parse(content.slice(beg, end));
            switch ( fargs[0] ) {
            case 0: // id-based
                if (
                    fargs[1] === selector.slice(1) &&
                    selector.charAt(0) === '#'
                ) {
                    found = prefix + selector;
                }
                break;
            case 1: // id-based
                if (
                    fargs[2] === selector.slice(1) &&
                    selector.charAt(0) === '#'
                ) {
                    found = prefix + selector;
                }
                break;
            case 2: // class-based
                if (
                    fargs[1] === selector.slice(1) &&
                    selector.charAt(0) === '.'
                ) {
                    found = prefix + selector;
                }
                break;
            case 3:
                if (
                    fargs[2] === selector.slice(1) &&
                    selector.charAt(0) === '.'
                ) {
                    found = prefix + selector;
                }
                break;
            case 4:
            case 5:
            case 7:
                if ( fargs[1] === selector ) {
                    found = prefix + selector;
                }
                break;
            case 6:
            case 8:
            case 9:
                if (
                    fargs[0] === 8 && fargs[3] !== selector ||
                    fargs[0] === 9 && JSON.parse(fargs[3]).raw !== selector
                ) {
                    break;
                }
                if (
                    fargs[2] === '' ||
                    reHostname.test(fargs[2]) === true ||
                    reEntity !== undefined && reEntity.test(fargs[2]) === true
                ) {
                    found = fargs[2] + prefix + selector;
                }
                break;
            }
            if ( found !== undefined  ) {
                if ( response[found] === undefined ) {
                    response[found] = [];
                }
                response[found].push({
                    title: entry.title,
                    supportURL: entry.supportURL
                });
                break;
            }
        }
    }

    postMessage({
        id: details.id,
        response: response
    });
};

/******************************************************************************/

onmessage = function(e) { // jshint ignore:line
    var msg = e.data;

    switch ( msg.what ) {
    case 'resetLists':
        listEntries = Object.create(null);
        break;

    case 'setList':
        listEntries[msg.details.assetKey] = msg.details;
        break;

    case 'fromNetFilter':
        fromNetFilter(msg);
        break;

    case 'fromCosmeticFilter':
        fromCosmeticFilter(msg);
        break;
    }
};

/******************************************************************************/
