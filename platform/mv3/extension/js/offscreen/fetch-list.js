/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2022-present Raymond Hill

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

import * as sfp from '../static-filtering-parser.js';

/******************************************************************************/

async function fetchText(url, progressFn) {
    const response = await fetch(url).catch(( ) => { });
    if ( response?.ok !== true ) {
        return { url, error: `Fetching from "${url}" failed` };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parts = [];
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if ( done ) { break; }
            parts.push(decoder.decode(value, { stream: true }));
            if ( progressFn ) { progressFn(); }
        }
    } catch {
        return { url, error: `Fetching content from "${url}" failed` };
    }
    parts.push(decoder.decode());
    return { url, content: parts.join('') };
}

/******************************************************************************/

function isTrusted(context, asset, url) {
    if ( asset.trusted ) { return true; }
    if ( Array.isArray(context.trustedPrefixes) === false ) { return false; }
    for ( const prefix of context.trustedPrefixes ) {
        if ( url.startsWith(prefix) ) { return true; }
    }
    return false;
}

/******************************************************************************/

export async function fetchList(context, asset, progressFn) {
    // Mind commit if present
    const effectiveURL = url => {
        return asset.commit
            ? url.replace('{commit}',  asset.commit)
            : url;
    };

    // Remember fetched URLs
    const fetchedURLs = new Set();

    // Fetch list and expand `!#include` directives
    let parts = asset.urls.map(url => ({ url: effectiveURL(url) }));
    while (  parts.every(v => typeof v === 'string') === false ) {
        const newParts = [];
        for ( const part of parts ) {
            if ( typeof part === 'string' ) {
                newParts.push(effectiveURL(part));
                continue;
            }
            if ( fetchedURLs.has(effectiveURL(part.url)) ) {
                newParts.push('');
                continue;
            }
            fetchedURLs.add(effectiveURL(part.url));
            if ( isTrusted(context, asset) && context.secret ) {
                newParts.push(`!#trusted on ${context.secret}`);
            }
            newParts.push(
                fetchText(effectiveURL(part.url), progressFn).then(details => {
                    const { url, error } = details;
                    if ( error !== undefined ) { return details; }
                    const content = details.content.trim();
                    if ( /^<.*>$/.test(content) ) {
                        return { url, error: `Bad content: ${url}` };
                    }
                    return { url, content };
                })
            );
            if ( context.secret ) {
                newParts.push(`!#trusted off ${context.secret}`);
            }
        }
        if ( parts.some(v => typeof v === 'object' && v.error) ) { return; }
        parts = await Promise.all(newParts);
        parts = sfp.utils.preparser.expandIncludes(parts, context.env);
    }
    const text = parts.join('\n');

    return text;
}

/******************************************************************************/
