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
import process from 'process';

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

const fetchList = url => {
    return new Promise((resolve, reject) => {
        log(`\tFetching ${url}`);
        https.get(url, response => {
            const data = [];
            response.on('data', chunk => {
                data.push(chunk.toString());
            });
            response.on('end', ( ) => {
                resolve({ url, content: data.join('') });
            });
        }).on('error', error => {
            reject(error);
        });
    });
};

/******************************************************************************/

async function main() {

    const env = [ 'chromium' ];

    const writeOps = [];
    const ruleResources = [];
    const rulesetDetails = [];
    const regexRulesetDetails = new Map();
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
    const rulesetDirPromise = fs.mkdir(`${rulesetDir}`, { recursive: true });

    const writeFile = (path, data) =>
        rulesetDirPromise.then(( ) =>
            fs.writeFile(path, data));

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
                    fetchList(part.url).then(details => {
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

        const details = await dnrRulesetFromRawLists([ { name: assetDetails.id, text } ], { env });
        const { ruleset: rules } = details;
        log(`Input filter count: ${details.filterCount}`);
        log(`\tAccepted filter count: ${details.acceptedFilterCount}`);
        log(`\tRejected filter count: ${details.rejectedFilterCount}`);
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

        rulesetDetails.push({
            id: assetDetails.id,
            name: assetDetails.name,
            enabled: assetDetails.enabled,
            lang: assetDetails.lang,
            filters: {
                total: details.filterCount,
                accepted: details.acceptedFilterCount,
                rejected: details.rejectedFilterCount,
            },
            rules: {
                total: rules.length,
                accepted: good.length,
                discarded: redirects.length + headers.length + removeparams.length,
                rejected: bad.length,
                regexes: regexes.length,
            },
        });

        writeOps.push(
            writeFile(
                `${rulesetDir}/${assetDetails.id}.json`,
                `${JSON.stringify(good, replacer, 2)}\n`
            )
        );

        regexRulesetDetails.set(assetDetails.id, regexes);

        writeOps.push(
            writeFile(
                `${rulesetDir}/${assetDetails.id}.regexes.json`,
                `${JSON.stringify(regexes, replacer, 2)}\n`
            )
        );

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
        });
    }

    // Handpicked rulesets
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
        });
    }

    writeOps.push(
        writeFile(
            `${rulesetDir}/ruleset-details.json`,
            `${JSON.stringify(rulesetDetails, replacer, 2)}\n`
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
