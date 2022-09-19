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

const outputDir = commandLineArgs.get('output') || '.';
const cacheDir = `${outputDir}/../mv3-data`;
const rulesetDir = `${outputDir}/rulesets`;
const scriptletDir = `${rulesetDir}/js`;
const env = [ 'chromium', 'ubol' ];

/******************************************************************************/

const jsonSetMapReplacer = (k, v) => {
    if ( v instanceof Set || v instanceof Map ) {
        if ( v.size === 0 ) { return; }
        return Array.from(v);
    }
    return v;
};

const uid = (s, l = 8) =>
    createHash('sha256').update(s).digest('hex').slice(0,l);

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
    const promise = fs.writeFile(fname, data);
    writeOps.push(promise);
    return promise;
};

const writeOps = [];

/******************************************************************************/

const ruleResources = [];
const rulesetDetails = [];
const scriptingDetails = new Map();

/******************************************************************************/

async function fetchAsset(assetDetails) {
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
    }
    return text;
}

/******************************************************************************/

async function processNetworkFilters(assetDetails, network) {
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

    writeFile(
        `${rulesetDir}/${assetDetails.id}.json`,
        `${JSON.stringify(good, replacer)}\n`
    );

    if ( regexes.length !== 0 ) {
        writeFile(
            `${rulesetDir}/${assetDetails.id}.regexes.json`,
            `${JSON.stringify(regexes, replacer)}\n`
        );
    }

    return {
        total: rules.length,
        accepted: good.length,
        discarded: redirects.length + headers.length + removeparams.length,
        rejected: bad.length,
        regexes: regexes.length,
    };
}

/******************************************************************************/

// TODO: unify css/scriptlet processing code since now css styles are
// injected using scriptlet injection.

// Load all available scriptlets into a key-val map, where the key is the
// scriptlet token, and val is the whole content of the file.

const scriptletDealiasingMap = new Map(); 
let scriptletsMapPromise;

function loadAllSourceScriptlets() {
    if ( scriptletsMapPromise !== undefined ) {
        return scriptletsMapPromise;
    }

    scriptletsMapPromise = fs.readdir('./scriptlets').then(files => {
        const reScriptletNameOrAlias = /^\/\/\/\s+(?:name|alias)\s+(\S+)/gm;
        const readPromises = [];
        for ( const file of files ) {
            readPromises.push(
                fs.readFile(`./scriptlets/${file}`, { encoding: 'utf8' })
            );
        }
        return Promise.all(readPromises).then(results => {
            const originalScriptletMap = new Map();
            for ( const text of results ) {
                const aliasSet = new Set();
                for (;;) {
                    const match = reScriptletNameOrAlias.exec(text);
                    if ( match === null ) { break; }
                    aliasSet.add(match[1]);
                }
                if ( aliasSet.size === 0 ) { continue; }
                const aliases = Array.from(aliasSet);
                originalScriptletMap.set(aliases[0], text);
                for ( let i = 0; i < aliases.length; i++ ) {
                    scriptletDealiasingMap.set(aliases[i], aliases[0]);
                }
            }
            return originalScriptletMap;
        });
    });

    return scriptletsMapPromise;
}

/******************************************************************************/

const globalPatchedScriptletsSet = new Set();

function addScriptingAPIResources(id, entry, prop, fname) {
    if ( entry[prop] === undefined ) { return; }
    for ( const hn of entry[prop] ) {
        let details = scriptingDetails.get(id);
        if ( details === undefined ) {
            details = {
                matches: new Map(),
                excludeMatches: new Map(),
            };
            scriptingDetails.set(id, details);
        }
        let fnames = details[prop].get(hn);
        if ( fnames === undefined ) {
            fnames = new Set();
            details[prop].set(hn, fnames);
        }
        fnames.add(fname);
    }
}

/******************************************************************************/

async function processCosmeticFilters(assetDetails, mapin) {
    if ( mapin === undefined ) { return 0; }

    // This groups together selectors which are used by the same hostname.
    const optimized = (filters => {
        if ( filters === undefined ) { return []; }
        const merge = new Map();
        for ( const [ selector, details ] of filters ) {
            const json = JSON.stringify(details);
            let entries = merge.get(json);
            if ( entries === undefined ) {
                entries = new Set();
                merge.set(json, entries);
            }
            entries.add(selector);
        }
        const out = [];
        for ( const [ json, entries ] of merge ) {
            const details = JSON.parse(json);
            details.selector = Array.from(entries).join(',');
            out.push(details);
        }
        return out;
    })(mapin);

    // This creates a map of unique selectorset => all hostnames
    // including/excluding the selectorset. This allows to avoid duplication
    // of css content.
    const cssContentMap = new Map();
    for ( const entry of optimized ) {
        // ends-with 0 = css resource
        const id = parseInt(uid(entry.selector), 16);
        let details = cssContentMap.get(id);
        if ( details === undefined ) {
            details = { a: entry.selector };
            cssContentMap.set(id, details);
        }
        if ( entry.matches !== undefined ) {
            if ( details.y === undefined ) {
                details.y = new Set();
            }
            for ( const hn of entry.matches ) {
                details.y.add(hn);
            }
        }
        if ( entry.excludeMatches !== undefined ) {
            if ( details.n === undefined ) {
                details.n = new Set();
            }
            for ( const hn of entry.excludeMatches ) {
                details.n.add(hn);
            }
        }
    }

    // We do not want more than 16 CSS files per subscription, so we will
    // group multiple unrelated selectors in the same file, and distinct
    // css declarations will be injected programmatically according to the
    // hostname of the current document.
    //
    // The cosmetic filters will be injected programmatically as content
    // script and the decisions to activate the cosmetic filters will be
    // done at injection time according to the document's hostname.
    const originalScriptletMap = await loadAllSourceScriptlets();
    const contentPerFile = Math.ceil(cssContentMap.size / 16);
    const cssContentArray = Array.from(cssContentMap);

    const jsonReplacer = (k, v) => {
        if ( k === 'n' ) {
            if ( v === undefined || v.size === 0 ) { return; }
            return Array.from(v);
        }
        if ( v instanceof Set || v instanceof Map ) {
            if ( v.size === 0 ) { return; }
            return Array.from(v);
        }
        return v;
    };

    const toHostnamesMap = (hostnames, id, out) => {
        for ( const hn of hostnames ) {
            const existing = out.get(hn);
            if ( existing === undefined ) {
                out.set(hn, id);
            } else if ( Array.isArray(existing) ) {
                existing.push(id);
            } else {
                out.set(hn, [ existing, id ]);
            }
        }
    };

    const generatedFiles = [];

    for ( let i = 0; i < cssContentArray.length; i += contentPerFile ) {
        const slice = cssContentArray.slice(i, i + contentPerFile);
        const argsMap = slice.map(entry => [
            entry[0], { a: entry[1].a, n: entry[1].n }
        ]);
        const hostnamesMap = new Map();
        for ( const [ id, details ] of slice ) {
            if ( details.y === undefined ) { continue; }
            toHostnamesMap(details.y, id, hostnamesMap);
        }
        const patchedScriptlet = originalScriptletMap.get('css-specific')
            .replace(
                /\bself\.\$argsMap\$/m,
                `${JSON.stringify(argsMap, jsonReplacer)}`
            ).replace(
                /\bself\.\$hostnamesMap\$/m,
                `${JSON.stringify(hostnamesMap, jsonReplacer)}`
            );
        // ends-with 0 = css resource
        const fname = uid(patchedScriptlet) + '0';
        if ( globalPatchedScriptletsSet.has(fname) === false ) {
            globalPatchedScriptletsSet.add(fname);
            writeFile(`${scriptletDir}/${fname.slice(0,1)}/${fname.slice(1)}.js`, patchedScriptlet, {});
            generatedFiles.push(fname);
        }
        for ( const entry of slice ) {
            addScriptingAPIResources(
                assetDetails.id,
                { matches: entry[1].y },
                'matches',
                fname
            );
            addScriptingAPIResources(
                assetDetails.id,
                { excludeMatches: entry[1].n },
                'excludeMatches',
                fname
            );
        }
    }

    if ( generatedFiles.length !== 0 ) {
        log(`CSS-related distinct filters: ${cssContentArray.length} distinct combined selectors`);
        log(`CSS-related injectable files: ${generatedFiles.length}`);
        log(`\t${generatedFiles.join(', ')}`);
    }

    return cssContentArray.length;
}

/******************************************************************************/

async function processScriptletFilters(assetDetails, mapin) {
    if ( mapin === undefined ) { return 0; }

    // Load all available scriptlets into a key-val map, where the key is the
    // scriptlet token, and val is the whole content of the file.
    const originalScriptletMap = await loadAllSourceScriptlets();

    const parseArguments = (raw) => {
        const out = [];
        let s = raw;
        let len = s.length;
        let beg = 0, pos = 0;
        let i = 1;
        while ( beg < len ) {
            pos = s.indexOf(',', pos);
            // Escaped comma? If so, skip.
            if ( pos > 0 && s.charCodeAt(pos - 1) === 0x5C /* '\\' */ ) {
                s = s.slice(0, pos - 1) + s.slice(pos);
                len -= 1;
                continue;
            }
            if ( pos === -1 ) { pos = len; }
            out.push(s.slice(beg, pos).trim());
            beg = pos = pos + 1;
            i++;
        }
        return out;
    };

    const parseFilter = (raw) => {
        const filter = raw.slice(4, -1);
        const end = filter.length;
        let pos = filter.indexOf(',');
        if ( pos === -1 ) { pos = end; }
        const parts = filter.trim().split(',').map(s => s.trim());
        const token = scriptletDealiasingMap.get(parts[0]) || '';
        if ( token !== '' && originalScriptletMap.has(token) ) {
            return {
                token,
                args: parseArguments(parts.slice(1).join(',').trim()),
            };
        }
    };

    // For each instance of distinct scriptlet, we will collect distinct
    // instances of arguments, and for each distinct set of argument, we
    // will collect the set of hostnames for which the scriptlet/args is meant
    // to execute. This will allow us a single content script file and the
    // scriptlets execution will depend on hostname testing against the
    // URL of the document at scriptlet execution time. In the end, we
    // should have no more generated content script per subscription than the
    // number of distinct source scriptlets.
    const scriptletDetails = new Map();
    for ( const [ rawFilter, entry ] of mapin ) {
        const normalized = parseFilter(rawFilter);
        if ( normalized === undefined ) { continue; }
        let argsDetails = scriptletDetails.get(normalized.token);
        if ( argsDetails === undefined ) {
            argsDetails = new Map();
            scriptletDetails.set(normalized.token, argsDetails);
        }
        const argsHash = JSON.stringify(normalized.args);
        let hostnamesDetails = argsDetails.get(argsHash);
        if ( hostnamesDetails === undefined ) {
            hostnamesDetails = {
                a: normalized.args,
                y: new Set(),
                n: new Set(),
            };
            argsDetails.set(argsHash, hostnamesDetails);
        }
        if ( entry.matches ) {
            for ( const hn of entry.matches ) {
                hostnamesDetails.y.add(hn);
            }
        }
        if ( entry.excludeMatches ) {
            for ( const hn of entry.excludeMatches ) {
                hostnamesDetails.n.add(hn);
            }
        }
    }

    const generatedFiles = [];

    const jsonReplacer = (k, v) => {
        if ( k === 'n' ) {
            if ( v.size === 0 ) { return; }
            return Array.from(v);
        }
        if ( v instanceof Set || v instanceof Map ) {
            if ( v.size === 0 ) { return; }
            return Array.from(v);
        }
        return v;
    };

    const toHostnamesMap = (hostnames, hash, out) => {
        for ( const hn of hostnames ) {
            const existing = out.get(hn);
            if ( existing === undefined ) {
                out.set(hn, hash);
            } else if ( Array.isArray(existing) ) {
                existing.push(hash);
            } else {
                out.set(hn, [ existing, hash ]);
            }
        }
    };

    for ( const [ token, argsDetails ] of scriptletDetails ) {
        const argsMap = Array.from(argsDetails).map(entry => [
            parseInt(uid(entry[0]),16),
            { a: entry[1].a, n: entry[1].n }
        ]);
        const hostnamesMap = new Map();
        for ( const [ argsHash, details ] of argsDetails ) {
            toHostnamesMap(details.y, parseInt(uid(argsHash),16), hostnamesMap);
        }
        const patchedScriptlet = originalScriptletMap.get(token)
            .replace(
                /\bself\.\$argsMap\$/m,
                `${JSON.stringify(argsMap, jsonReplacer)}`
            ).replace(
                /\bself\.\$hostnamesMap\$/m,
                `${JSON.stringify(hostnamesMap, jsonReplacer)}`
            );
        // ends-with 1 = scriptlet resource
        const fname = uid(patchedScriptlet) + '1';
        if ( globalPatchedScriptletsSet.has(fname) === false ) {
            globalPatchedScriptletsSet.add(fname);
            writeFile(`${scriptletDir}/${fname.slice(0,1)}/${fname.slice(1)}.js`, patchedScriptlet, {});
            generatedFiles.push(fname);
        }
        for ( const details of argsDetails.values() ) {
            addScriptingAPIResources(
                assetDetails.id,
                { matches: details.y },
                'matches',
                fname
            );
            addScriptingAPIResources(
                assetDetails.id,
                { excludeMatches: details.n },
                'excludeMatches',
                fname
            );
        }
    }

    if ( generatedFiles.length !== 0 ) {
        const scriptletFilterCount = Array.from(scriptletDetails.values())
            .reduce((a, b) => a + b.size, 0);
        log(`Scriptlet-related distinct filters: ${scriptletFilterCount}`);
        log(`Scriptlet-related injectable files: ${generatedFiles.length}`);
        log(`\t${generatedFiles.join(', ')}`);
    }

    return generatedFiles.length;
}

/******************************************************************************/

async function main() {

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

    const rulesetFromURLS = async function(assetDetails) {
        log('============================');
        log(`Listset for '${assetDetails.id}':`);

        const text = await fetchAsset(assetDetails);

        const results = await dnrRulesetFromRawLists(
            [ { name: assetDetails.id, text } ],
            { env }
        );

        const netStats = await processNetworkFilters(
            assetDetails,
            results.network
        );

        const cosmeticStats = await processCosmeticFilters(
            assetDetails,
            results.cosmetic
        );

        const scriptletStats = await processScriptletFilters(
            assetDetails,
            results.scriptlet
        );

        rulesetDetails.push({
            id: assetDetails.id,
            name: assetDetails.name,
            enabled: assetDetails.enabled,
            lang: assetDetails.lang,
            homeURL: assetDetails.homeURL,
            filters: {
                total: results.network.filterCount,
                accepted: results.network.acceptedFilterCount,
                rejected: results.network.rejectedFilterCount,
            },
            rules: {
                total: netStats.total,
                accepted: netStats.accepted,
                discarded: netStats.discarded,
                rejected: netStats.rejected,
                regexes: netStats.regexes,
            },
            css: {
                specific: cosmeticStats,
            },
            scriptlets: {
                total: scriptletStats,
            },
        });

        ruleResources.push({
            id: assetDetails.id,
            enabled: assetDetails.enabled,
            path: `/rulesets/${assetDetails.id}.json`
        });
    };

    // Get assets.json content
    const assets = await fs.readFile(
        `./assets.json`,
        { encoding: 'utf8' }
    ).then(text =>
        JSON.parse(text)
    );

    // Assemble all default lists as the default ruleset
    const contentURLs = [
        'https://ublockorigin.pages.dev/filters/filters.txt',
        'https://ublockorigin.pages.dev/filters/badware.txt',
        'https://ublockorigin.pages.dev/filters/privacy.txt',
        'https://ublockorigin.pages.dev/filters/resource-abuse.txt',
        'https://ublockorigin.pages.dev/filters/unbreak.txt',
        'https://ublockorigin.pages.dev/filters/quick-fixes.txt',
        'https://secure.fanboy.co.nz/easylist.txt',
        'https://secure.fanboy.co.nz/easyprivacy.txt',
        'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext',
    ];
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

    writeFile(
        `${rulesetDir}/ruleset-details.json`,
        `${JSON.stringify(rulesetDetails, null, 1)}\n`
    );

    writeFile(
        `${rulesetDir}/scripting-details.json`,
        `${JSON.stringify(scriptingDetails, jsonSetMapReplacer)}\n`
    );

    await Promise.all(writeOps);

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
