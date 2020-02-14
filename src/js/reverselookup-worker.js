/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-present Raymond Hill

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

const reBlockStart = /^#block-start-(\d+)\n/gm;
let listEntries = Object.create(null);

/******************************************************************************/

const extractBlocks = function(content, begId, endId) {
    reBlockStart.lastIndex = 0;
    const out = [];
    let match = reBlockStart.exec(content);
    while ( match !== null ) {
        const beg = match.index + match[0].length;
        const blockId = parseInt(match[1], 10);
        if ( blockId >= begId && blockId < endId ) {
            const end = content.indexOf('#block-end-' + match[1], beg);
            out.push(content.slice(beg, end));
            reBlockStart.lastIndex = end;
        }
        match = reBlockStart.exec(content);
    }
    return out.join('\n');
};

/******************************************************************************/

// https://github.com/MajkiIT/polish-ads-filter/issues/14768#issuecomment-536006312
//   Avoid reporting badfilter-ed filters.

const fromNetFilter = function(details) {
    const lists = [];
    const compiledFilter = details.compiledFilter;

    for ( const assetKey in listEntries ) {
        const entry = listEntries[assetKey];
        if ( entry === undefined ) { continue; }
        const content = extractBlocks(entry.content, 0, 1);
        let pos = 0;
        for (;;) {
            pos = content.indexOf(compiledFilter, pos);
            if ( pos === -1 ) { break; }
            // We need an exact match.
            // https://github.com/gorhill/uBlock/issues/1392
            // https://github.com/gorhill/uBlock/issues/835
            const notFound = pos !== 0 && content.charCodeAt(pos - 1) !== 0x0A;
            pos += compiledFilter.length;
            if (
                notFound ||
                pos !== content.length && content.charCodeAt(pos) !== 0x0A
            ) {
                continue;
            }
            lists.push({
                assetKey: assetKey,
                title: entry.title,
                supportURL: entry.supportURL
            });
            break;
        }
    }

    const response = {};
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

const fromCosmeticFilter = function(details) {
    const match = /^#@?#\^?/.exec(details.rawFilter);
    const prefix = match[0];
    const exception = prefix.charAt(1) === '@';
    const selector = details.rawFilter.slice(prefix.length);
    const isHtmlFilter = prefix.endsWith('^');
    const hostname = details.hostname;

    // The longer the needle, the lower the number of false positives.
    const needle = selector.match(/\w+/g).reduce(function(a, b) {
        return a.length > b.length ? a : b;
    });

    const regexFromLabels = (prefix, hn, suffix) =>
        new RegExp(
            prefix +
            hn.split('.').reduce((acc, item) => `(${acc}\\.)?${item}`) +
            suffix
        );

    // https://github.com/uBlockOrigin/uBlock-issues/issues/803
    //   Support looking up selectors of the form `*##...`
    const reHostname = regexFromLabels('^', hostname, '$');
    let reEntity;
    {
        const domain = details.domain;
        const pos = domain.indexOf('.');
        if ( pos !== -1 ) {
            reEntity = regexFromLabels(
                '^(',
                hostname.slice(0, pos + hostname.length - domain.length),
                '\\.)?\\*$'
            );
        }
    }

    const hostnameMatches = hn => {
        return hn === '' ||
               reHostname.test(hn) ||
               reEntity !== undefined && reEntity.test(hn);
    };

    const response = Object.create(null);

    for ( const assetKey in listEntries ) {
        const entry = listEntries[assetKey];
        if ( entry === undefined ) { continue; }
        let content = extractBlocks(entry.content, 1000, 2000),
            isProcedural,
            found;
        let pos = 0;
        while ( (pos = content.indexOf(needle, pos)) !== -1 ) {
            let beg = content.lastIndexOf('\n', pos);
            if ( beg === -1 ) { beg = 0; }
            let end = content.indexOf('\n', pos);
            if ( end === -1 ) { end = content.length; }
            pos = end;
            const fargs = JSON.parse(content.slice(beg, end));
            const filterType = fargs[0];

            // https://github.com/gorhill/uBlock/issues/2763
            if ( filterType >= 0 && filterType <= 5 && details.ignoreGeneric ) {
                continue;
            }

            // Do not confuse cosmetic filters with HTML ones.
            if ( (filterType === 64) !== isHtmlFilter ) { continue; }

            switch ( filterType ) {
            // Lowly generic cosmetic filters
            case 0: // simple id-based
                if (
                    exception === false &&
                    fargs[1] === selector.slice(1) &&
                    selector.charAt(0) === '#'
                ) {
                    found = prefix + selector;
                }
                break;
            case 2: // simple class-based
                if (
                    exception === false &&
                    fargs[1] === selector.slice(1) &&
                    selector.charAt(0) === '.'
                ) {
                    found = prefix + selector;
                }
                break;
            case 1: // complex id-based
            case 3: // complex class-based
                if ( exception === false && fargs[2] === selector ) {
                    found = prefix + selector;
                }
                break;
            // Highly generic cosmetic filters
            case 4: // simple highly generic
            case 5: // complex highly generic
            case 7: // generic exception
                if ( fargs[1] === selector ) {
                    found = prefix + selector;
                }
                break;
            // Specific cosmetic filtering
            case 8:
            // HTML filtering
            case 64:
                if ( exception !== ((fargs[2] & 0b001) !== 0) ) { break; }
                isProcedural = (fargs[2] & 0b010) !== 0;
                if (
                    isProcedural === false && fargs[3] !== selector ||
                    isProcedural && JSON.parse(fargs[3]).raw !== selector
                ) {
                    break;
                }
                if ( hostnameMatches(fargs[1]) === false ) { break; }
                // https://www.reddit.com/r/uBlockOrigin/comments/d6vxzj/
                //   Ignore match if specific cosmetic filters are disabled
                if (
                    filterType === 8 &&
                    exception === false &&
                    details.ignoreSpecific
                ) {
                    break;
                }
                found = fargs[1] + prefix + selector;
                break;
            // Scriptlet injection
            case 32:
                if ( exception !== ((fargs[2] & 0b001) !== 0) ) { break; }
                if ( fargs[3] !== selector ) { break; }
                if ( hostnameMatches(fargs[1]) ) {
                    found = fargs[1] + prefix + selector;
                }
                break;
            }
            if ( found !== undefined  ) {
                if ( response[found] === undefined ) {
                    response[found] = [];
                }
                response[found].push({
                    assetKey: assetKey,
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
    const msg = e.data;

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
