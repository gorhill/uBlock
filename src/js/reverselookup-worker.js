/*******************************************************************************

    uBlock - a browser extension to block requests.
    Copyright (C) 2015 Raymond Hill

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

var listEntries = Object.create(null);

/******************************************************************************/

// Helpers

var reEscape = function(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

var reSpecialChars = /[\*\^\t\v\n]/;

/******************************************************************************/

var fromNetFilter = function(details) {
    var lists = [];

    var compiledFilter = details.compiledFilter;
    var entry, content, pos, c;
    for ( var path in listEntries ) {
        entry = listEntries[path];
        if ( entry === undefined ) {
            continue;
        }
        content = entry.content;
        pos = content.indexOf(compiledFilter);
        if ( pos === -1 ) {
            continue;
        }
        // https://github.com/gorhill/uBlock/issues/835
        // We need an exact match.
        c = content.charAt(pos + compiledFilter.length);
        if ( c !== '' && reSpecialChars.test(c) === false ) {
            continue;
        }
        lists.push({
            title: entry.title,
            supportURL: entry.supportURL
        });
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
    var filter = details.rawFilter;
    var exception = filter.lastIndexOf('#@#', 0) === 0;

    filter = exception ? filter.slice(3) : filter.slice(2);

    var candidates = Object.create(null);
    var response = Object.create(null);

    // First step: assuming the filter is generic, find out its compiled
    // representation.
    // Reference: FilterContainer.compileGenericSelector().
    var reStr = '';
    var matches = rePlainSelector.exec(filter);
    if ( matches ) {
        if ( matches[0] === filter ) {          // simple CSS selector
            reStr = reEscape('c\vlg\v' + filter);
        } else {                                // complex CSS selector
            reStr = reEscape('c\vlg+\v' + matches[0] + '\v' + filter);
        }
    } else if ( reHighLow.test(filter) ) {      // [alt] or [title]
        reStr = reEscape('c\vhlg0\v' + filter);
    } else if ( reHighMedium.test(filter) ) {   // [href^="..."]
        reStr = reEscape('c\vhmg0\v') + '[a-z.-]+' + reEscape('\v') + '[a-z]*' + reEscape(filter);
    } else {                                    // all else
        reStr = reEscape('c\vhhg0\v' + filter);
    }
    candidates[details.rawFilter] = new RegExp(reStr + '(?:\\n|$)');

    // Second step: find hostname-based versions.
    // Reference: FilterContainer.compileHostnameSelector().
    var pos;
    var domain = details.domain;
    var hostname = details.hostname;

    if ( hostname !== '' ) {
        for ( ;; ) {
            candidates[hostname + '##' + filter] = new RegExp(
                reEscape('c\vh\v') +
                '\\w+' +
                reEscape('\v' + hostname + '\v' + filter) +
                '(?:\\n|$)'
            );
            // If there is no valid domain, there won't be any other
            // version of this hostname-based filter.
            if ( domain === '' ) {
                break;
            }
            if ( hostname === domain ) {
                break;
            }
            pos = hostname.indexOf('.');
            if ( pos === -1 ) {
                break;
            }
            hostname = hostname.slice(pos + 1);
        }
    }

    // Last step: find entity-based versions.
    // Reference: FilterContainer.compileEntitySelector().
    pos = domain.indexOf('.');
    if ( pos !== -1 ) {
        var entity = domain.slice(0, pos);
        candidates[entity + '.*##' + filter] = new RegExp(
            reEscape('c\ve\v' + entity + '\v' + filter) +
            '(?:\\n|$)'
        );
    }

    var re, path, entry;
    for ( var candidate in candidates ) {
        re = candidates[candidate];
        for ( path in listEntries ) {
            entry = listEntries[path];
            if ( entry === undefined ) {
                continue;
            }
            if ( re.test(entry.content) === false ) {
                continue;
            }
            if ( response[candidate] === undefined ) {
                response[candidate] = [];
            }
            response[candidate].push({
                title: entry.title,
                supportURL: entry.supportURL
            });
        }
    }

    postMessage({
        id: details.id,
        response: response
    });
};

var rePlainSelector = /^([#.][\w-]+)/;
var reHighLow = /^[a-z]*\[(?:alt|title)="[^"]+"\]$/;
var reHighMedium = /^\[href\^="https?:\/\/([^"]{8})[^"]*"\]$/;

/******************************************************************************/

onmessage = function(e) {
    var msg = e.data;

    switch ( msg.what ) {
    case 'resetLists':
        listEntries = Object.create(null);
        break;

    case 'setList':
        listEntries[msg.details.path] = msg.details;
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
