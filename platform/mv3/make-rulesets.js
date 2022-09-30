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
import { fnameFromFileId } from './js/utils.js';

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
const env = [
    'chromium',
    'native_css_has',
    'ublock',
    'ubol',
    'user_stylesheet',
];

/******************************************************************************/

const jsonSetMapReplacer = (k, v) => {
    if ( v instanceof Set || v instanceof Map ) {
        if ( v.size === 0 ) { return; }
        return Array.from(v);
    }
    return v;
};

const uidint32 = (s) => {
    const h = createHash('sha256').update(s).digest('hex').slice(0,8);
    return parseInt(h,16) & 0x7FFFFFFF;
};

const hnSort = (a, b) =>
    a.split('.').reverse().join('.').localeCompare(
        b.split('.').reverse().join('.')
    );

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

async function processNetworkFilters(assetDetails, network) {
    const replacer = (k, v) => {
        if ( k.startsWith('_') ) { return; }
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

    const plainGood = rules.filter(rule => isGood(rule) && isRegex(rule) === false);
    log(`\tPlain good: ${plainGood.length}`);

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

    const removeparamsGood = rules.filter(rule =>
        isUnsupported(rule) === false && isRemoveparam(rule)
    );
    const removeparamsBad = rules.filter(rule =>
        isUnsupported(rule) && isRemoveparam(rule)
    );
    log(`\tremoveparams= (accepted/discarded): ${removeparamsGood.length}/${removeparamsBad.length}`);

    const bad = rules.filter(rule =>
        isUnsupported(rule)
    );
    log(`\tUnsupported: ${bad.length}`);
    log(bad.map(rule => rule._error.map(v => `\t\t${v}`)).join('\n'), true);

    writeFile(
        `${rulesetDir}/${assetDetails.id}.json`,
        `${JSON.stringify(plainGood, replacer)}\n`
    );

    if ( regexes.length !== 0 ) {
        writeFile(
            `${rulesetDir}/${assetDetails.id}.regexes.json`,
            `${JSON.stringify(regexes, replacer)}\n`
        );
    }

    if ( removeparamsGood.length !== 0 ) {
        writeFile(
            `${rulesetDir}/${assetDetails.id}.removeparams.json`,
            `${JSON.stringify(removeparamsGood, replacer)}\n`
        );
    }

    return {
        total: rules.length,
        plain: plainGood.length,
        discarded: redirects.length + headers.length + removeparamsBad.length,
        rejected: bad.length,
        regexes: regexes.length,
        removeparams: removeparamsGood.length,
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

function addScriptingAPIResources(id, hostnames, fid) {
    if ( hostnames === undefined ) { return; }
    for ( const hn of hostnames ) {
        let hostnamesToFidMap = scriptingDetails.get(id);
        if ( hostnamesToFidMap === undefined ) {
            hostnamesToFidMap = new Map();
            scriptingDetails.set(id, hostnamesToFidMap);
        }
        let fids = hostnamesToFidMap.get(hn);
        if ( fids === undefined ) {
            hostnamesToFidMap.set(hn, fid);
        } else if ( fids instanceof Set ) {
            fids.add(fid);
        } else if ( fid !== fids ) {
            fids = new Set([ fids, fid ]);
            hostnamesToFidMap.set(hn, fids);
        }
    }
}

const        toCSSFileId = s => (uidint32(s) & ~0b11) | 0b00;
const         toJSFileId = s => (uidint32(s) & ~0b11) | 0b01;
const toProceduralFileId = s => (uidint32(s) & ~0b11) | 0b10;

const pathFromFileName = fname => `${scriptletDir}/${fname.slice(0,2)}/${fname.slice(2)}.js`;

/******************************************************************************/

const MAX_COSMETIC_FILTERS_PER_FILE = 128;

// This merges selectors which are used by the same hostnames

function groupCosmeticByHostnames(mapin) {
    if ( mapin === undefined ) { return []; }
    const merged = new Map();
    for ( const [ selector, details ] of mapin ) {
        const json = JSON.stringify(details);
        let entries = merged.get(json);
        if ( entries === undefined ) {
            entries = new Set();
            merged.set(json, entries);
        }
        entries.add(selector);
    }
    const out = [];
    for ( const [ json, entries ] of merged ) {
        const details = JSON.parse(json);
        details.selectors = Array.from(entries).sort();
        out.push(details);
    }
    return out;
}

// This merges hostnames which have the same set of selectors.
//
// Also, we sort the hostnames to increase likelihood that selector with
// same hostnames will end up in same generated scriptlet.

function groupCosmeticBySelectors(arrayin) {
    const contentMap = new Map();
    for ( const entry of arrayin ) {
        const id = uidint32(JSON.stringify(entry.selectors));
        let details = contentMap.get(id);
        if ( details === undefined ) {
            details = { a: entry.selectors };
            contentMap.set(id, details);
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
    const out = Array.from(contentMap).map(a => [
        a[0], {
            a: a[1].a,
            y: a[1].y ? Array.from(a[1].y).sort(hnSort) : undefined,
            n: a[1].n ? Array.from(a[1].n) : undefined,
        }
    ]).sort((a, b) => {
        const ha = Array.isArray(a[1].y) ? a[1].y[0] : '*';
        const hb = Array.isArray(b[1].y) ? b[1].y[0] : '*';
        return hnSort(ha, hb);
    });
    return out;
}

const scriptletHostnameToIdMap = (hostnames, id, map) => {
    for ( const hn of hostnames ) {
        const existing = map.get(hn);
        if ( existing === undefined ) {
            map.set(hn, id);
        } else if ( Array.isArray(existing) ) {
            existing.push(id);
        } else {
            map.set(hn, [ existing, id ]);
        }
    }
};

const scriptletJsonReplacer = (k, v) => {
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

/******************************************************************************/

async function processCosmeticFilters(assetDetails, mapin) {
    if ( mapin === undefined ) { return 0; }

    const contentArray = groupCosmeticBySelectors(
        groupCosmeticByHostnames(mapin)
    );

    // We do not want more than n CSS files per subscription, so we will
    // group multiple unrelated selectors in the same file, and distinct
    // css declarations will be injected programmatically according to the
    // hostname of the current document.
    //
    // The cosmetic filters will be injected programmatically as content
    // script and the decisions to activate the cosmetic filters will be
    // done at injection time according to the document's hostname.
    const originalScriptletMap = await loadAllSourceScriptlets();
    const generatedFiles = [];

    for ( let i = 0; i < contentArray.length; i += MAX_COSMETIC_FILTERS_PER_FILE ) {
        const slice = contentArray.slice(i, i + MAX_COSMETIC_FILTERS_PER_FILE);
        const argsMap = slice.map(entry => [
            entry[0],
            {
                a: entry[1].a ? entry[1].a.join(',\n') : undefined,
                n: entry[1].n
            }
        ]);
        const hostnamesMap = new Map();
        for ( const [ id, details ] of slice ) {
            if ( details.y === undefined ) { continue; }
            scriptletHostnameToIdMap(details.y, id, hostnamesMap);
        }
        const patchedScriptlet = originalScriptletMap.get('css-specific')
            .replace(
                '$rulesetId$',
                assetDetails.id
            ).replace(
                /\bself\.\$argsMap\$/m,
                `${JSON.stringify(argsMap, scriptletJsonReplacer)}`
            ).replace(
                /\bself\.\$hostnamesMap\$/m,
                `${JSON.stringify(hostnamesMap, scriptletJsonReplacer)}`
            );
        const fid = toCSSFileId(patchedScriptlet);
        if ( globalPatchedScriptletsSet.has(fid) === false ) {
            globalPatchedScriptletsSet.add(fid);
            const fname = fnameFromFileId(fid);
            writeFile(pathFromFileName(fname), patchedScriptlet, {});
            generatedFiles.push(fname);
        }
        for ( const entry of slice ) {
            addScriptingAPIResources(assetDetails.id, entry[1].y, fid);
        }
    }

    if ( generatedFiles.length !== 0 ) {
        log(`CSS-related distinct filters: ${contentArray.length} distinct combined selectors`);
        log(`CSS-related injectable files: ${generatedFiles.length}`);
        log(`\t${generatedFiles.join(', ')}`);
    }

    return contentArray.length;
}

/******************************************************************************/

async function processProceduralCosmeticFilters(assetDetails, mapin) {
    if ( mapin === undefined ) { return 0; }

    const contentArray = groupCosmeticBySelectors(
        groupCosmeticByHostnames(mapin)
    );

    // We do not want more than n CSS files per subscription, so we will
    // group multiple unrelated selectors in the same file, and distinct
    // css declarations will be injected programmatically according to the
    // hostname of the current document.
    //
    // The cosmetic filters will be injected programmatically as content
    // script and the decisions to activate the cosmetic filters will be
    // done at injection time according to the document's hostname.
    const originalScriptletMap = await loadAllSourceScriptlets();
    const generatedFiles = [];

    for ( let i = 0; i < contentArray.length; i += MAX_COSMETIC_FILTERS_PER_FILE ) {
        const slice = contentArray.slice(i, i + MAX_COSMETIC_FILTERS_PER_FILE);
        const argsMap = slice.map(entry => [
            entry[0],
            {
                a: entry[1].a ? entry[1].a.map(v => JSON.parse(v)) : undefined,
                n: entry[1].n
            }
        ]);
        const hostnamesMap = new Map();
        for ( const [ id, details ] of slice ) {
            if ( details.y === undefined ) { continue; }
            scriptletHostnameToIdMap(details.y, id, hostnamesMap);
        }
        const patchedScriptlet = originalScriptletMap.get('css-specific-procedural')
            .replace(
                '$rulesetId$',
                assetDetails.id
            ).replace(
                /\bself\.\$argsMap\$/m,
                `${JSON.stringify(argsMap, scriptletJsonReplacer)}`
            ).replace(
                /\bself\.\$hostnamesMap\$/m,
                `${JSON.stringify(hostnamesMap, scriptletJsonReplacer)}`
            );
        const fid = toProceduralFileId(patchedScriptlet);
        if ( globalPatchedScriptletsSet.has(fid) === false ) {
            globalPatchedScriptletsSet.add(fid);
            const fname = fnameFromFileId(fid);
            writeFile(pathFromFileName(fname), patchedScriptlet, {});
            generatedFiles.push(fname);
        }
        for ( const entry of slice ) {
            addScriptingAPIResources(assetDetails.id, entry[1].y, fid);
        }
    }

    if ( generatedFiles.length !== 0 ) {
        log(`Procedural-related distinct filters: ${contentArray.length} distinct combined selectors`);
        log(`Procedural-related injectable files: ${generatedFiles.length}`);
        log(`\t${generatedFiles.join(', ')}`);
    }

    return contentArray.length;
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

    for ( const [ token, argsDetails ] of scriptletDetails ) {
        const argsMap = Array.from(argsDetails).map(entry => [
            uidint32(entry[0]),
            { a: entry[1].a, n: entry[1].n }
        ]);
        const hostnamesMap = new Map();
        for ( const [ argsHash, details ] of argsDetails ) {
            scriptletHostnameToIdMap(details.y, uidint32(argsHash), hostnamesMap);
        }
        const patchedScriptlet = originalScriptletMap.get(token)
            .replace(
                '$rulesetId$',
                assetDetails.id
            ).replace(
                /\bself\.\$argsMap\$/m,
                `${JSON.stringify(argsMap, scriptletJsonReplacer)}`
            ).replace(
                /\bself\.\$hostnamesMap\$/m,
                `${JSON.stringify(hostnamesMap, scriptletJsonReplacer)}`
            );
        // ends-with 1 = scriptlet resource
        const fid = toJSFileId(patchedScriptlet);
        if ( globalPatchedScriptletsSet.has(fid) === false ) {
            globalPatchedScriptletsSet.add(fid);
            const fname = fnameFromFileId(fid);
            writeFile(pathFromFileName(fname), patchedScriptlet, {});
            generatedFiles.push(fname);
        }
        for ( const details of argsDetails.values() ) {
            addScriptingAPIResources(assetDetails.id, details.y, fid);
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

const rulesetFromURLS = async function(assetDetails) {
    log('============================');
    log(`Listset for '${assetDetails.id}':`);

    const text = await fetchAsset(assetDetails);
    if ( text === '' ) { return; }

    const results = await dnrRulesetFromRawLists(
        [ { name: assetDetails.id, text } ],
        { env }
    );

    const netStats = await processNetworkFilters(
        assetDetails,
        results.network
    );

    // Split cosmetic filters into two groups: declarative and procedural
    const declarativeCosmetic = new Map();
    const proceduralCosmetic = new Map();
    const rejectedCosmetic = [];
    if ( results.cosmetic ) {
        for ( const [ selector, details ] of results.cosmetic ) {
            if ( details.rejected ) {
                rejectedCosmetic.push(selector);
                continue;
            }
            if ( selector.startsWith('{') === false ) {
                declarativeCosmetic.set(selector, details);
                continue;
            }
            const parsed = JSON.parse(selector);
            parsed.raw = undefined;
            proceduralCosmetic.set(JSON.stringify(parsed), details);
        }
    }
    const cosmeticStats = await processCosmeticFilters(
        assetDetails,
        declarativeCosmetic
    );
    const proceduralStats = await processProceduralCosmeticFilters(
        assetDetails,
        proceduralCosmetic
    );
    if ( rejectedCosmetic.length !== 0 ) {
        log(`Rejected cosmetic filters: ${rejectedCosmetic.length}`);
        log(rejectedCosmetic.map(line => `\t${line}`).join('\n'));
    }

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
            plain: netStats.plain,
            regexes: netStats.regexes,
            removeparams: netStats.removeparams,
            discarded: netStats.discarded,
            rejected: netStats.rejected,
        },
        css: {
            specific: cosmeticStats,
            procedural: proceduralStats,
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
    const excludedLists = [
        'ara-0',
        'EST-0',
    ];
    for ( const [ id, asset ] of Object.entries(assets) ) {
        if ( asset.content !== 'filters' ) { continue; }
        if ( asset.off !== true ) { continue; }
        if ( typeof asset.lang !== 'string' ) { continue; }
        if ( excludedLists.includes(id) ) { continue; }
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
    const handpicked = [ 'block-lan', 'dpollock-0', 'adguard-spyware-url' ];
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

    // We sort the hostnames for convenience/performance in the extension's
    // script manager -- the scripting API does a sort() internally.
    for ( const [ rulesetId, hostnamesToFidsMap ] of scriptingDetails ) {
        scriptingDetails.set(
            rulesetId,
            Array.from(hostnamesToFidsMap).sort()
        );
    }
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
    const logContent = stdOutput.join('\n') + '\n';
    await fs.writeFile(`${outputDir}/log.txt`, logContent);
    await fs.writeFile(`${cacheDir}/log.txt`, logContent);
}

main();

/******************************************************************************/
