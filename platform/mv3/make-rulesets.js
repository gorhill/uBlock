/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
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

'use strict';

/******************************************************************************/

import fs from 'fs/promises';
import https from 'https';
import path from 'path';
import process from 'process';
import { createHash } from 'crypto';

import { dnrRulesetFromRawLists } from './js/static-dnr-filtering.js';
import { StaticFilteringParser } from './js/static-filtering-parser.js';

/******************************************************************************/

const commandLineArgs = (( ) => {
    const args = new Map();
    let name, value;
    for ( const arg of process.argv.slice(2) ) {
        const pos = arg.indexOf('=');
        if ( pos === -1 ) {
            name = arg;
            value = '';
        } else {
            name = arg.slice(0, pos);
            value = arg.slice(pos+1);
        }
        args.set(name, value);
    }
    return args;
})();

/******************************************************************************/

const isUnsupported = rule =>
    rule._error !== undefined;

const isRegex = rule =>
    rule.condition !== undefined &&
    rule.condition.regexFilter !== undefined;

const isRedirect = rule =>
    rule.action !== undefined &&
    rule.action.type === 'redirect' &&
    rule.action.redirect.extensionPath !== undefined;

const isCsp = rule =>
    rule.action !== undefined &&
    rule.action.type === 'modifyHeaders';

const isRemoveparam = rule =>
    rule.action !== undefined &&
    rule.action.type === 'redirect' &&
    rule.action.redirect.transform !== undefined;

const isGood = rule =>
    isUnsupported(rule) === false &&
    isRedirect(rule) === false &&
    isCsp(rule) === false &&
    isRemoveparam(rule) === false;

/******************************************************************************/

const stdOutput = [];

const log = (text, silent = false) => {
    stdOutput.push(text);
    if ( silent === false ) {
        console.log(text);
    }
};

/******************************************************************************/

const urlToFileName = url => {
    return url
        .replace(/^https?:\/\//, '')
        .replace(/\//g, '_')
        ;
};

const fetchList = (url, cacheDir) => {
    return new Promise((resolve, reject) => {
        const fname = urlToFileName(url);
        fs.readFile(`${cacheDir}/${fname}`, { encoding: 'utf8' }).then(content => {
            log(`\tFetched local ${url}`);
            resolve({ url, content });
        }).catch(( ) => {
            log(`\tFetching remote ${url}`);
            https.get(url, response => {
                const data = [];
                response.on('data', chunk => {
                    data.push(chunk.toString());
                });
                response.on('end', ( ) => {
                    const content = data.join('');
                    try {
                        writeFile(`${cacheDir}/${fname}`, content);
                    } catch (ex) {
                    }
                    resolve({ url, content });
                });
            }).on('error', error => {
                reject(error);
            });
        });
    });
};

/******************************************************************************/

const writeFile = async (fname, data) => {
    const dir = path.dirname(fname);
    await fs.mkdir(dir, { recursive: true });
    return fs.writeFile(fname, data);
};

/******************************************************************************/

async function main() {

    const env = [ 'chromium' ];

    const writeOps = [];
    const ruleResources = [];
    const rulesetDetails = [];
    const cssDetails = new Map();
    const outputDir = commandLineArgs.get('output') || '.';

    // Get manifest content
    const manifest = await fs.readFile(
        `${outputDir}/manifest.json`,
        { encoding: 'utf8' }
    ).then(text =>
        JSON.parse(text)
    );

    // Create unique version number according to build time
    let version = manifest.version;
    {
        const now = new Date();
        const yearPart = now.getUTCFullYear() - 2000;
        const monthPart = (now.getUTCMonth() + 1) * 1000;
        const dayPart = now.getUTCDate() * 10;
        const hourPart = Math.floor(now.getUTCHours() / 3) + 1;
        version += `.${yearPart}.${monthPart + dayPart + hourPart}`;
    }
    log(`Version: ${version}`);

    let goodTotalCount = 0;
    let maybeGoodTotalCount = 0;

    const replacer = (k, v) => {
        if ( k.startsWith('__') ) { return; }
        if ( Array.isArray(v) ) {
            return v.sort();
        }
        if ( v instanceof Object ) {
            const sorted = {};
            for ( const kk of Object.keys(v).sort() ) {
                sorted[kk] = v[kk];
            }
            return sorted;
        }
        return v;
    };

    const rulesetDir = `${outputDir}/rulesets`;
    const cacheDir = `${outputDir}/../mv3-data`;
    const cssDir = `${outputDir}/content-css`;

    const rulesetFromURLS = async function(assetDetails) {
        log('============================');
        log(`Listset for '${assetDetails.id}':`);

        // Remember fetched URLs
        const fetchedURLs = new Set();

        // Fetch list and expand `!#include` directives
        let parts = assetDetails.urls.map(url => ({ url }));
        while (  parts.every(v => typeof v === 'string') === false ) {
            const newParts = [];
            for ( const part of parts ) {
                if ( typeof part === 'string' ) {
                    newParts.push(part);
                    continue;
                }
                if ( fetchedURLs.has(part.url) ) {
                    newParts.push('');
                    continue;
                }
                fetchedURLs.add(part.url);
                newParts.push(
                    fetchList(part.url, cacheDir).then(details => {
                        const { url } = details;
                        const content = details.content.trim();
                        if ( typeof content === 'string' && content !== '' ) {
                            if (
                                content.startsWith('<') === false ||
                                content.endsWith('>') === false
                            ) {
                                return { url, content };
                            }
                        }
                        log(`No valid content for ${details.name}`);
                        return { url, content: '' };
                    })
                );
            }
            parts = await Promise.all(newParts);
            parts = StaticFilteringParser.utils.preparser.expandIncludes(parts, env);
        }
        const text = parts.join('\n');

        if ( text === '' ) {
            log('No filterset found');
            return;
        }

        const results = await dnrRulesetFromRawLists([ { name: assetDetails.id, text } ], { env });
        const { network } = results;
        const { ruleset: rules } = network;
        log(`Input filter count: ${network.filterCount}`);
        log(`\tAccepted filter count: ${network.acceptedFilterCount}`);
        log(`\tRejected filter count: ${network.rejectedFilterCount}`);
        log(`Output rule count: ${rules.length}`);

        const good = rules.filter(rule => isGood(rule) && isRegex(rule) === false);
        log(`\tGood: ${good.length}`);

        const regexes = rules.filter(rule => isGood(rule) && isRegex(rule));
        log(`\tMaybe good (regexes): ${regexes.length}`);

        const redirects = rules.filter(rule =>
            isUnsupported(rule) === false &&
            isRedirect(rule)
        );
        log(`\tredirect-rule= (discarded): ${redirects.length}`);

        const headers = rules.filter(rule =>
            isUnsupported(rule) === false &&
            isCsp(rule)
        );
        log(`\tcsp= (discarded): ${headers.length}`);

        const removeparams = rules.filter(rule =>
            isUnsupported(rule) === false &&
            isRemoveparam(rule)
        );
        log(`\tremoveparams= (discarded): ${removeparams.length}`);

        const bad = rules.filter(rule =>
            isUnsupported(rule)
        );
        log(`\tUnsupported: ${bad.length}`);
        log(
            bad.map(rule => rule._error.map(v => `\t\t${v}`)).join('\n'),
            true
        );

        writeOps.push(
            writeFile(
                `${rulesetDir}/${assetDetails.id}.json`,
                `${JSON.stringify(good, replacer)}\n`
            )
        );

        if ( regexes.length !== 0 ) {
            writeOps.push(
                writeFile(
                    `${rulesetDir}/${assetDetails.id}.regexes.json`,
                    `${JSON.stringify(regexes, replacer)}\n`
                )
            );
        }

        const { cosmetic } = results;
        const cssEntries = [];
        for ( const entry of cosmetic ) {
            const fname = createHash('sha256').update(entry.css).digest('hex').slice(0,8);
            const fpath = `${assetDetails.id}/${fname.slice(0,1)}/${fname.slice(1,8)}`;
            writeOps.push(
                writeFile(
                    `${cssDir}/${fpath}.css`,
                    `${entry.css}\n{display:none!important;}\n`
                )
            );
            entry.css = fname;
            cssEntries.push(entry);
        }
        log(`CSS entries: ${cssEntries.length}`);
        if ( cssEntries.length !== 0 ) {
            cssDetails.set(assetDetails.id, cssEntries);
        }

        rulesetDetails.push({
            id: assetDetails.id,
            name: assetDetails.name,
            enabled: assetDetails.enabled,
            lang: assetDetails.lang,
            homeURL: assetDetails.homeURL,
            filters: {
                total: network.filterCount,
                accepted: network.acceptedFilterCount,
                rejected: network.rejectedFilterCount,
            },
            rules: {
                total: rules.length,
                accepted: good.length,
                discarded: redirects.length + headers.length + removeparams.length,
                rejected: bad.length,
                regexes: regexes.length,
            },
            css: {
                specific: cssEntries.length,
            },
        });

        ruleResources.push({
            id: assetDetails.id,
            enabled: assetDetails.enabled,
            path: `/rulesets/${assetDetails.id}.json`
        });

        goodTotalCount += good.length;
        maybeGoodTotalCount += regexes.length;
    };

    // Get assets.json content
    const assets = await fs.readFile(
        `./assets.json`,
        { encoding: 'utf8' }
    ).then(text =>
        JSON.parse(text)
    );

    // Assemble all default lists as the default ruleset
    const contentURLs = [];
    for ( const asset of Object.values(assets) ) {
        if ( asset.content !== 'filters' ) { continue; }
        if ( asset.off === true ) { continue; }
        const contentURL = Array.isArray(asset.contentURL)
            ? asset.contentURL[0]
            : asset.contentURL;
        contentURLs.push(contentURL);
    }
    await rulesetFromURLS({
        id: 'default',
        name: 'Ads, trackers, miners, and more' ,
        enabled: true,
        urls: contentURLs,
        homeURL: 'https://github.com/uBlockOrigin/uAssets',
    });

    // Regional rulesets
    for ( const [ id, asset ] of Object.entries(assets) ) {
        if ( asset.content !== 'filters' ) { continue; }
        if ( asset.off !== true ) { continue; }
        if ( typeof asset.lang !== 'string' ) { continue; }

        const contentURL = Array.isArray(asset.contentURL)
            ? asset.contentURL[0]
            : asset.contentURL;
        await rulesetFromURLS({
            id: id.toLowerCase(),
            lang: asset.lang,
            name: asset.title,
            enabled: false,
            urls: [ contentURL ],
            homeURL: asset.supportURL,
        });
    }

    // Handpicked rulesets from assets.json
    const handpicked = [ 'block-lan', 'dpollock-0' ];
    for ( const id of handpicked ) {
        const asset = assets[id];
        if ( asset.content !== 'filters' ) { continue; }

        const contentURL = Array.isArray(asset.contentURL)
            ? asset.contentURL[0]
            : asset.contentURL;
        await rulesetFromURLS({
            id: id.toLowerCase(),
            name: asset.title,
            enabled: false,
            urls: [ contentURL ],
            homeURL: asset.supportURL,
        });
    }

    // Handpicked rulesets from abroad
    await rulesetFromURLS({
        id: 'stevenblack-hosts',
        name: 'Steven Black\'s hosts file',
        enabled: false,
        urls: [ 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts' ],
        homeURL: 'https://github.com/StevenBlack/hosts#readme',
    });

    writeOps.push(
        writeFile(
            `${rulesetDir}/ruleset-details.json`,
            `${JSON.stringify(rulesetDetails, null, 2)}\n`
        )
    );

    writeOps.push(
        writeFile(
            `${cssDir}/css-specific.json`,
            `${JSON.stringify(Array.from(cssDetails), null, 2)}\n`
        )
    );

    await Promise.all(writeOps);

    log(`Total good rules count: ${goodTotalCount}`);
    log(`Total regex rules count: ${maybeGoodTotalCount}`);

    // Patch manifest
    manifest.declarative_net_request = { rule_resources: ruleResources };
    const now = new Date();
    const yearPart = now.getUTCFullYear() - 2000;
    const monthPart = (now.getUTCMonth() + 1) * 1000;
    const dayPart = now.getUTCDate() * 10;
    const hourPart = Math.floor(now.getUTCHours() / 3) + 1;
    manifest.version = manifest.version + `.${yearPart}.${monthPart + dayPart + hourPart}`;
    await fs.writeFile(
        `${outputDir}/manifest.json`,
        JSON.stringify(manifest, null, 2) + '\n'
    );

    // Log results
    await fs.writeFile(`${outputDir}/log.txt`, stdOutput.join('\n') + '\n');
}

main();

/******************************************************************************/
