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

import * as makeScriptlet from './make-scriptlets.js';
import * as sfp from './js/static-filtering-parser.js';

import {
    createHash,
    randomBytes,
} from 'crypto';
import {
    dnrRulesetFromRawLists,
    mergeRules,
} from './js/static-dnr-filtering.js';

import fs from 'fs/promises';
import https from 'https';
import path from 'path';
import process from 'process';
import redirectResourcesMap from './js/redirect-resources.js';
import { safeReplace } from './safe-replace.js';

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

const platform = commandLineArgs.get('platform') || 'chromium';
const outputDir = commandLineArgs.get('output') || '.';
const cacheDir = `${outputDir}/../mv3-data`;
const rulesetDir = `${outputDir}/rulesets`;
const scriptletDir = `${rulesetDir}/scripting`;
const env = [
    platform,
    'mv3',
    'ublock',
    'ubol',
    'user_stylesheet',
];

if ( platform !== 'firefox' ) {
    env.push('native_css_has');
}

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
        .replace(/\//g, '_');
};

const fetchText = (url, cacheDir) => {
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
                    } catch {
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

const copyFile = async (from, to) => {
    const dir = path.dirname(to);
    await fs.mkdir(dir, { recursive: true });
    const promise = fs.copyFile(from, to);
    writeOps.push(promise);
    return promise;
};

const writeOps = [];

/******************************************************************************/

const ruleResources = [];
const rulesetDetails = [];
const scriptletStats = new Map();
const genericDetails = new Map();
const requiredRedirectResources = new Set();

// This will be used to sign our inserted `!#trusted on` directives
const secret = createHash('sha256').update(randomBytes(16)).digest('hex').slice(0,16);
log(`Secret: ${secret}`);

/******************************************************************************/

const restrSeparator = '(?:[^%.0-9a-z_-]|$)';

const rePatternFromUrlFilter = s => {
    let anchor = 0b000;
    if ( s.startsWith('||') ) {
        anchor = 0b100;
        s = s.slice(2);
    } else if ( s.startsWith('|') ) {
        anchor = 0b010;
        s = s.slice(1);
    }
    if ( s.endsWith('|') ) {
        anchor |= 0b001;
        s = s.slice(0, -1);
    }
    let reStr = s.replace(rePatternFromUrlFilter.rePlainChars, '\\$&')
                 .replace(rePatternFromUrlFilter.reSeparators, restrSeparator)
                 .replace(rePatternFromUrlFilter.reDanglingAsterisks, '')
                 .replace(rePatternFromUrlFilter.reAsterisks, '\\S*?');
    if ( anchor & 0b100 ) {
        reStr = (
            reStr.startsWith('\\.') ?
                rePatternFromUrlFilter.restrHostnameAnchor2 :
                rePatternFromUrlFilter.restrHostnameAnchor1
        ) + reStr;
    } else if ( anchor & 0b010 ) {
        reStr = '^' + reStr;
    }
    if ( anchor & 0b001 ) {
        reStr += '$';
    }
    return reStr;
};
rePatternFromUrlFilter.rePlainChars = /[.+?${}()|[\]\\]/g;
rePatternFromUrlFilter.reSeparators = /\^/g;
rePatternFromUrlFilter.reDanglingAsterisks = /^\*+|\*+$/g;
rePatternFromUrlFilter.reAsterisks = /\*+/g;
rePatternFromUrlFilter.restrHostnameAnchor1 = '^[a-z-]+://(?:[^/?#]+\\.)?';
rePatternFromUrlFilter.restrHostnameAnchor2 = '^[a-z-]+://(?:[^/?#]+)?';

/******************************************************************************/

async function fetchList(assetDetails) {
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
            if ( part.url.startsWith('https://ublockorigin.github.io/uAssets/filters/') ) {
                newParts.push(`!#trusted on ${secret}`);
            }
            newParts.push(
                fetchText(part.url, cacheDir).then(details => {
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
            newParts.push(`!#trusted off ${secret}`);
        }
        parts = await Promise.all(newParts);
        parts = sfp.utils.preparser.expandIncludes(parts, env);
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

const isRedirect = rule => {
    if ( isUnsupported(rule) ) { return false; }
    if ( rule.action.type !== 'redirect' ) { return false; }
    if ( rule.action.redirect?.extensionPath !== undefined ) { return true; }
    if ( rule.action.redirect?.transform?.path !== undefined ) { return true; }
    return false;
};

const isModifyHeaders = rule =>
    isUnsupported(rule) === false &&
    rule.action.type === 'modifyHeaders';

const isRemoveparam = rule =>
    isUnsupported(rule) === false &&
    rule.action.type === 'redirect' &&
    rule.action.redirect.transform !== undefined;

const isSafe = rule =>
    isUnsupported(rule) === false &&
    rule.action !== undefined && (
        rule.action.type === 'block' ||
        rule.action.type === 'allow' ||
        rule.action.type === 'allowAllRequests'
    );

const isURLSkip = rule =>
    isUnsupported(rule) === false &&
    rule.action !== undefined &&
    rule.action.type === 'urlskip';

/******************************************************************************/

// Two distinct hostnames:
//   www.example.com
//   example.com
// Can be reduced to a single one:
//   example.com
// Since if example.com matches, then www.example.com (or any other subdomain
// of example.com) will always match.

function pruneHostnameArray(hostnames) {
    const rootMap = new Map();
    for ( const hostname of hostnames ) {
        const labels = hostname.split('.');
        let currentMap = rootMap;
        let i = labels.length;
        while ( i-- ) {
            const label = labels[i];
            let nextMap = currentMap.get(label);
            if ( nextMap === null ) { break; }
            if ( nextMap === undefined ) {
                if ( i === 0 ) {
                    currentMap.set(label, (nextMap = null));
                } else {
                    currentMap.set(label, (nextMap = new Map()));
                }
            } else if ( i === 0 ) {
                currentMap.set(label, null);
            }
            currentMap = nextMap;
        }
    }
    const assemble = (currentMap, currentHostname, out) => {
        for ( const [ label, nextMap ] of currentMap ) {
            const nextHostname = currentHostname === ''
                ? label
                : `${label}.${currentHostname}`;
            if ( nextMap === null ) {
                out.push(nextHostname);
            } else {
                assemble(nextMap, nextHostname, out);
            }
        }
        return out;
    };
    return assemble(rootMap, '', []);
}

/*******************************************************************************
 * 
 * For large rulesets, one rule per line for compromise between size and
 * readability. This also means that the number of lines in resulting file
 * representative of the number of rules in the ruleset.
 * 
 * */

function toJSONRuleset(ruleset) {
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
    const indent = ruleset.length > 10 ? undefined : 1;
    const out = [];
    for ( const rule of ruleset ) {
        out.push(JSON.stringify(rule, replacer, indent));
    }
    return `[\n${out.join(',\n')}\n]\n`;
}

/******************************************************************************/

function toStrictBlockRule(rule, out) {
    if ( rule.action.type !== 'block' ) { return; }
    const { condition } = rule;
    if ( condition === undefined ) { return; }
    if ( condition.domainType ) { return; }
    if ( condition.excludedResourceTypes ) { return; }
    if ( condition.requestMethods ) { return; }
    if ( condition.excludedRequestMethods ) { return; }
    if ( condition.responseHeaders ) { return; }
    if ( condition.excludedResponseHeaders ) { return; }
    if ( condition.initiatorDomains ) { return; }
    if ( condition.excludedInitiatorDomains ) { return; }
    if ( condition.excludedRequestDomains ) { return; }
    const { resourceTypes } = condition;
    if ( resourceTypes === undefined ) {
        if ( condition.requestDomains === undefined ) { return; }
    } else {
        if ( resourceTypes.length !== 1 ) { return; }
        if ( resourceTypes[0] !== 'main_frame' ) { return; }
    }
    let regexFilter;
    if ( condition.urlFilter ) {
        regexFilter = rePatternFromUrlFilter(condition.urlFilter);
    } else if ( condition.regexFilter ) {
        regexFilter = condition.regexFilter;
    } else {
        regexFilter = '^https?://.*';
    }
    if (
        regexFilter.startsWith('^') === false
    ) {
        regexFilter = `^.*${regexFilter}`;
    }
    if (
        regexFilter.endsWith('$') === false &&
        regexFilter.endsWith('.*') === false &&
        regexFilter.endsWith('.+') === false
    ) {
        regexFilter = `${regexFilter}.*`;
    }
    const strictBlockRule = {
        action: {
            type: 'redirect',
            redirect: {
                regexSubstitution: `/strictblock.html#\\0`,
            },
        },
        condition: {
            regexFilter,
            resourceTypes: [ 'main_frame' ],
        },
        priority: 29,
    };
    if ( condition.requestDomains ) {
        strictBlockRule.condition.requestDomains = condition.requestDomains.slice();
    }
    out.set(toStrictBlockRule.ruleId++, strictBlockRule);
}
toStrictBlockRule.ruleId = 1;

/******************************************************************************/

async function processNetworkFilters(assetDetails, network) {
    const { ruleset: rules } = network;
    log(`Input filter count: ${network.filterCount}`);
    log(`\tAccepted filter count: ${network.acceptedFilterCount}`);
    log(`\tRejected filter count: ${network.rejectedFilterCount}`);
    log(`Output rule count: ${rules.length}`);

    // Minimize requestDomains arrays
    for ( const rule of rules ) {
        const condition = rule.condition;
        if ( condition === undefined ) { continue; }
        const requestDomains = condition.requestDomains;
        if ( requestDomains === undefined ) { continue; }
        const beforeCount = requestDomains.length;
        condition.requestDomains = pruneHostnameArray(requestDomains);
        const afterCount = condition.requestDomains.length;
        if ( afterCount !== beforeCount ) {
            log(`\tPruning requestDomains: from ${beforeCount} to ${afterCount}`);
        }
    }

    // Add native DNR ruleset if present
    if ( assetDetails.dnrURL ) {
        const result = await fetchText(assetDetails.dnrURL, cacheDir);
        for ( const rule of JSON.parse(result.content) ) {
            rules.push(rule);
        }
    }

    const plainGood = rules.filter(rule => isSafe(rule) && isRegex(rule) === false);
    log(`\tPlain good: ${plainGood.length}`);
    log(plainGood
        .filter(rule => Array.isArray(rule._warning))
        .map(rule => rule._warning.map(v => `\t\t${v}`))
        .join('\n'), true
    );

    const regexes = rules.filter(rule => isSafe(rule) && isRegex(rule));
    log(`\tMaybe good (regexes): ${regexes.length}`);

    const redirects = rules.filter(rule =>
        isUnsupported(rule) === false &&
        isRedirect(rule)
    );
    redirects.forEach(rule => {
        if ( rule.action.redirect.extensionPath === undefined ) { return; }
        requiredRedirectResources.add(
            rule.action.redirect.extensionPath.replace(/^\/+/, '')
        );
    });
    log(`\tredirect=: ${redirects.length}`);

    const removeparamsGood = rules.filter(rule =>
        isUnsupported(rule) === false && isRemoveparam(rule)
    );
    const removeparamsBad = rules.filter(rule =>
        isUnsupported(rule) && isRemoveparam(rule)
    );
    log(`\tremoveparams= (accepted/discarded): ${removeparamsGood.length}/${removeparamsBad.length}`);

    const modifyHeaders = rules.filter(rule =>
        isUnsupported(rule) === false &&
        isModifyHeaders(rule)
    );
    log(`\tmodifyHeaders=: ${modifyHeaders.length}`);

    const urlskips = new Map();
    for ( const rule of rules ) {
        if ( isURLSkip(rule) === false ) { continue; }
        if ( rule.__modifierAction !== 0 ) { continue; }
        const { condition } = rule;
        if ( condition.resourceTypes ) {
            if ( condition.resourceTypes.includes('main_frame') === false ) {
                continue;
            }
        }
        const { urlFilter, regexFilter, requestDomains } = condition;
        let re;
        if ( urlFilter !== undefined ) {
            re = rePatternFromUrlFilter(urlFilter);
        } else if ( regexFilter !== undefined ) {
            re = regexFilter;
        } else {
            re = '^';
        }
        const rawSteps = rule.__modifierValue;
        const steps = rawSteps.includes(' ') && rawSteps.split(/ +/) || [ rawSteps ];
        const keyEntry = {
            re,
            c: condition.isUrlFilterCaseSensitive,
            steps,
        }
        const key = JSON.stringify(keyEntry);
        let actualEntry = urlskips.get(key);
        if ( actualEntry === undefined ) {
            urlskips.set(key, keyEntry);
            actualEntry = keyEntry;
        }
        if ( requestDomains !== undefined ) {
            if ( actualEntry.hostnames === undefined ) {
                actualEntry.hostnames = [];
            }
            actualEntry.hostnames.push(...requestDomains);
        }
    }
    log(`\turlskip=: ${urlskips.size}`);

    const bad = rules.filter(rule =>
        isUnsupported(rule)
    );
    log(`\tUnsupported: ${bad.length}`);
    log(bad.map(rule => rule._error.map(v => `\t\t${v}`)).join('\n'), true);

    writeFile(
        `${rulesetDir}/main/${assetDetails.id}.json`,
        toJSONRuleset(plainGood)
    );

    if ( regexes.length !== 0 ) {
        writeFile(
            `${rulesetDir}/regex/${assetDetails.id}.json`,
            toJSONRuleset(regexes)
        );
    }

    if ( removeparamsGood.length !== 0 ) {
        writeFile(
            `${rulesetDir}/removeparam/${assetDetails.id}.json`,
            toJSONRuleset(removeparamsGood)
        );
    }

    if ( redirects.length !== 0 ) {
        writeFile(
            `${rulesetDir}/redirect/${assetDetails.id}.json`,
            toJSONRuleset(redirects)
        );
    }

    if ( modifyHeaders.length !== 0 ) {
        writeFile(
            `${rulesetDir}/modify-headers/${assetDetails.id}.json`,
            toJSONRuleset(modifyHeaders)
        );
    }

    const strictBlocked = new Map();
    for ( const rule of plainGood ) {
        toStrictBlockRule(rule, strictBlocked);
    }
    if ( strictBlocked.size !== 0 ) {
        mergeRules(strictBlocked, 'requestDomains');
        let id = 1;
        for ( const rule of strictBlocked.values() ) {
            rule.id = id++;
        }
        writeFile(
            `${rulesetDir}/strictblock/${assetDetails.id}.json`,
            toJSONRuleset(Array.from(strictBlocked.values()))
        );
    }

    if ( urlskips.size !== 0 ) {
        writeFile(
            `${rulesetDir}/urlskip/${assetDetails.id}.json`,
            JSON.stringify(Array.from(urlskips.values()), null, 1)
        );
    }

    return {
        total: rules.length,
        plain: plainGood.length,
        discarded: removeparamsBad.length,
        rejected: bad.length,
        regex: regexes.length,
        removeparam: removeparamsGood.length,
        redirect: redirects.length,
        modifyHeaders: modifyHeaders.length,
        strictblock: strictBlocked.size,
        urlskip: urlskips.size,
    };
}

/******************************************************************************/

// TODO: unify css/scriptlet processing code since now css styles are
// injected using scriptlet injection.

// Load all available scriptlets into a key-val map, where the key is the
// scriptlet token, and val is the whole content of the file.

let scriptletsMapPromise;

function loadAllSourceScriptlets() {
    if ( scriptletsMapPromise !== undefined ) {
        return scriptletsMapPromise;
    }

    scriptletsMapPromise = fs.readdir('./scriptlets').then(files => {
        const readTemplateFile = file =>
            fs.readFile(`./scriptlets/${file}`, { encoding: 'utf8' })
              .then(text => ({ file, text }));
        const readPromises = [];
        for ( const file of files ) {
            readPromises.push(readTemplateFile(file));
        }
        return Promise.all(readPromises).then(results => {
            const originalScriptletMap = new Map();
            for ( const details of results ) {
                originalScriptletMap.set(
                    details.file.replace('.template.js', '')
                                .replace('.template.css', ''),
                    details.text
                );
            }
            return originalScriptletMap;
        });
    });

    return scriptletsMapPromise;
}

/******************************************************************************/

async function processGenericCosmeticFilters(assetDetails, bucketsMap, exceptionSet) {
    if ( bucketsMap === undefined ) { return 0; }
    if ( exceptionSet ) {
        for ( const [ hash, selectors ] of bucketsMap ) {
            let i = selectors.length;
            while ( i-- ) {
                const selector = selectors[i];
                if ( exceptionSet.has(selector) === false ) { continue; }
                selectors.splice(i, 1);
                //log(`\tRemoving excepted generic filter ##${selector}`);
            }
            if ( selectors.length === 0 ) {
                bucketsMap.delete(hash);
            }
        }
    }
    if ( bucketsMap.size === 0 ) { return 0; }
    const bucketsList = Array.from(bucketsMap);
    const count = bucketsList.reduce((a, v) => a += v[1].length, 0);
    if ( count === 0 ) { return 0; }
    const selectorLists = bucketsList.map(v => [ v[0], v[1].join(',') ]);
    const originalScriptletMap = await loadAllSourceScriptlets();

    let patchedScriptlet = originalScriptletMap.get('css-generic').replace(
        '$rulesetId$',
        assetDetails.id
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$genericSelectorMap\$/,
        `${JSON.stringify(selectorLists, scriptletJsonReplacer)}`
    );

    writeFile(
        `${scriptletDir}/generic/${assetDetails.id}.js`,
        patchedScriptlet
    );

    log(`CSS-generic: ${count} plain CSS selectors`);

    return count;
}

/******************************************************************************/

async function processGenericHighCosmeticFilters(assetDetails, selectorSet, exceptionSet) {
    if ( selectorSet === undefined ) { return 0; }
    if ( exceptionSet ) {
        for ( const selector of selectorSet ) {
            if ( exceptionSet.has(selector) === false ) { continue; }
            selectorSet.delete(selector);
            //log(`\tRemoving excepted generic filter ##${selector}`);
        }
    }
    if ( selectorSet.size === 0 ) { return 0; }
    const selectorLists = Array.from(selectorSet).sort().join(',\n');
    const originalScriptletMap = await loadAllSourceScriptlets();

    let patchedScriptlet = originalScriptletMap.get('css-generichigh').replace(
        '$rulesetId$',
        assetDetails.id
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\$selectorList\$/,
        selectorLists
    );

    writeFile(
        `${scriptletDir}/generichigh/${assetDetails.id}.css`,
        patchedScriptlet
    );

    log(`CSS-generic-high: ${selectorSet.size} plain CSS selectors`);

    return selectorSet.size;
}

/******************************************************************************/

// This merges selectors which are used by the same hostnames

function groupSelectorsByHostnames(mapin) {
    if ( mapin === undefined ) { return []; }
    const merged = new Map();
    for ( const [ selector, details ] of mapin ) {
        if ( details.rejected ) { continue; }
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

function groupHostnamesBySelectors(arrayin) {
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
            y: a[1].y ? Array.from(a[1].y) : undefined,
            n: a[1].n ? Array.from(a[1].n) : undefined,
        }
    ]);
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

function argsMap2List(argsMap, hostnamesMap) {
    const argsList = [];
    const indexMap = new Map();
    for ( const [ id, details ] of argsMap ) {
        indexMap.set(id, argsList.length);
        argsList.push(details);
    }
    for ( const [ hn, ids ] of hostnamesMap ) {
        if ( typeof ids === 'number' ) {
            hostnamesMap.set(hn, indexMap.get(ids));
            continue;
        }
        for ( let i = 0; i < ids.length; i++ ) {
            ids[i] = indexMap.get(ids[i]);
        }
    }
    return argsList;
}

/******************************************************************************/

async function processCosmeticFilters(assetDetails, mapin) {
    if ( mapin === undefined ) { return 0; }
    if ( mapin.size === 0 ) { return 0; }

    const domainBasedEntries = groupHostnamesBySelectors(
        groupSelectorsByHostnames(mapin)
    );
    // We do not want more than n CSS files per subscription, so we will
    // group multiple unrelated selectors in the same file, and distinct
    // css declarations will be injected programmatically according to the
    // hostname of the current document.
    //
    // The cosmetic filters will be injected programmatically as content
    // script and the decisions to activate the cosmetic filters will be
    // done at injection time according to the document's hostname.
    const generatedFiles = [];

    const argsMap = domainBasedEntries.map(entry => [
        entry[0],
        {
            a: entry[1].a ? entry[1].a.join(',\n') : undefined,
            n: entry[1].n
        }
    ]);
    const hostnamesMap = new Map();
    for ( const [ id, details ] of domainBasedEntries ) {
        if ( details.y === undefined ) { continue; }
        scriptletHostnameToIdMap(details.y, id, hostnamesMap);
    }
    const argsList = argsMap2List(argsMap, hostnamesMap);
    const entitiesMap = new Map();
    for ( const [ hn, details ] of hostnamesMap ) {
        if ( hn.endsWith('.*') === false ) { continue; }
        hostnamesMap.delete(hn);
        entitiesMap.set(hn.slice(0, -2), details);
    }

    // Extract exceptions from argsList, simplify argsList entries
    const exceptionsMap = new Map();
    for ( let i = 0; i < argsList.length; i++ ) {
        const details = argsList[i];
        if ( details.n ) {
            for ( const hn of details.n ) {
                if ( exceptionsMap.has(hn) === false ) {
                    exceptionsMap.set(hn, []);
                }
                exceptionsMap.get(hn).push(i);
            }
        }
        argsList[i] = details.a;
    }

    const originalScriptletMap = await loadAllSourceScriptlets();
    let patchedScriptlet = originalScriptletMap.get('css-specific').replace(
        '$rulesetId$',
        assetDetails.id
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$argsList\$/,
        `${JSON.stringify(argsList, scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$hostnamesMap\$/,
        `${JSON.stringify(hostnamesMap, scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$entitiesMap\$/,
        `${JSON.stringify(entitiesMap, scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$exceptionsMap\$/,
        `${JSON.stringify(exceptionsMap, scriptletJsonReplacer)}`
    );
    writeFile(`${scriptletDir}/specific/${assetDetails.id}.js`, patchedScriptlet);
    generatedFiles.push(`${assetDetails.id}`);

    if ( generatedFiles.length !== 0 ) {
        log(`CSS-specific: ${mapin.size} distinct filters`);
        log(`\tCombined into ${hostnamesMap.size} distinct hostnames`);
        log(`\tCombined into ${entitiesMap.size} distinct entities`);
    }

    return hostnamesMap.size + entitiesMap.size;
}

/******************************************************************************/

async function processDeclarativeCosmeticFilters(assetDetails, mapin) {
    if ( mapin === undefined ) { return 0; }
    if ( mapin.size === 0 ) { return 0; }

    // Distinguish declarative-compiled-as-procedural from actual procedural.
    const declaratives = new Map();
    mapin.forEach((details, jsonSelector) => {
        const selector = JSON.parse(jsonSelector);
        if ( selector.cssable !== true ) { return; }
        selector.cssable = undefined;
        declaratives.set(JSON.stringify(selector), details);
    });
    if ( declaratives.size === 0 ) { return 0; }

    const contentArray = groupHostnamesBySelectors(
        groupSelectorsByHostnames(declaratives)
    );

    const argsMap = contentArray.map(entry => [
        entry[0],
        {
            a: entry[1].a,
            n: entry[1].n,
        }
    ]);
    const hostnamesMap = new Map();
    for ( const [ id, details ] of contentArray ) {
        if ( details.y === undefined ) { continue; }
        scriptletHostnameToIdMap(details.y, id, hostnamesMap);
    }
    const argsList = argsMap2List(argsMap, hostnamesMap);
    const entitiesMap = new Map();
    for ( const [ hn, details ] of hostnamesMap ) {
        if ( hn.endsWith('.*') === false ) { continue; }
        hostnamesMap.delete(hn);
        entitiesMap.set(hn.slice(0, -2), details);
    }

    // Extract exceptions from argsList, simplify argsList entries
    const exceptionsMap = new Map();
    for ( let i = 0; i < argsList.length; i++ ) {
        const details = argsList[i];
        if ( details.n ) {
            for ( const hn of details.n ) {
                if ( exceptionsMap.has(hn) === false ) {
                    exceptionsMap.set(hn, []);
                }
                exceptionsMap.get(hn).push(i);
            }
        }
        argsList[i] = details.a;
    }

    const originalScriptletMap = await loadAllSourceScriptlets();
    let patchedScriptlet = originalScriptletMap.get('css-declarative').replace(
        '$rulesetId$',
        assetDetails.id
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$argsList\$/,
        `${JSON.stringify(argsList, scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$hostnamesMap\$/,
        `${JSON.stringify(hostnamesMap, scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$entitiesMap\$/,
        `${JSON.stringify(entitiesMap, scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$exceptionsMap\$/,
        `${JSON.stringify(exceptionsMap, scriptletJsonReplacer)}`
    );
    writeFile(`${scriptletDir}/declarative/${assetDetails.id}.js`, patchedScriptlet);

    if ( contentArray.length !== 0 ) {
        log(`CSS-declarative: ${declaratives.size} distinct filters`);
        log(`\tCombined into ${hostnamesMap.size} distinct hostnames`);
        log(`\tCombined into ${entitiesMap.size} distinct entities`);
    }

    return hostnamesMap.size + entitiesMap.size;
}

/******************************************************************************/

async function processProceduralCosmeticFilters(assetDetails, mapin) {
    if ( mapin === undefined ) { return 0; }
    if ( mapin.size === 0 ) { return 0; }

    // Distinguish declarative-compiled-as-procedural from actual procedural.
    const procedurals = new Map();
    mapin.forEach((details, jsonSelector) => {
        const selector = JSON.parse(jsonSelector);
        if ( selector.cssable ) { return; }
        procedurals.set(jsonSelector, details);
    });
    if ( procedurals.size === 0 ) { return 0; }

    const contentArray = groupHostnamesBySelectors(
        groupSelectorsByHostnames(procedurals)
    );

    const argsMap = contentArray.map(entry => [
        entry[0],
        {
            a: entry[1].a,
            n: entry[1].n,
        }
    ]);
    const hostnamesMap = new Map();
    for ( const [ id, details ] of contentArray ) {
        if ( details.y === undefined ) { continue; }
        scriptletHostnameToIdMap(details.y, id, hostnamesMap);
    }
    const argsList = argsMap2List(argsMap, hostnamesMap);
    const entitiesMap = new Map();
    for ( const [ hn, details ] of hostnamesMap ) {
        if ( hn.endsWith('.*') === false ) { continue; }
        hostnamesMap.delete(hn);
        entitiesMap.set(hn.slice(0, -2), details);
    }

    // Extract exceptions from argsList, simplify argsList entries
    const exceptionsMap = new Map();
    for ( let i = 0; i < argsList.length; i++ ) {
        const details = argsList[i];
        if ( details.n ) {
            for ( const hn of details.n ) {
                if ( exceptionsMap.has(hn) === false ) {
                    exceptionsMap.set(hn, []);
                }
                exceptionsMap.get(hn).push(i);
            }
        }
        argsList[i] = details.a;
    }

    const originalScriptletMap = await loadAllSourceScriptlets();
    let patchedScriptlet = originalScriptletMap.get('css-procedural').replace(
        '$rulesetId$',
        assetDetails.id
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$argsList\$/,
        `${JSON.stringify(argsList, scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$hostnamesMap\$/,
        `${JSON.stringify(hostnamesMap, scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$entitiesMap\$/,
        `${JSON.stringify(entitiesMap, scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$exceptionsMap\$/,
        `${JSON.stringify(exceptionsMap, scriptletJsonReplacer)}`
    );
    writeFile(`${scriptletDir}/procedural/${assetDetails.id}.js`, patchedScriptlet);

    if ( contentArray.length !== 0 ) {
        log(`Procedural-related distinct filters: ${procedurals.size} distinct combined selectors`);
        log(`\tCombined into ${hostnamesMap.size} distinct hostnames`);
        log(`\tCombined into ${entitiesMap.size} distinct entities`);
    }

    return hostnamesMap.size + entitiesMap.size;
}

/******************************************************************************/

async function processScriptletFilters(assetDetails, mapin) {
    if ( mapin === undefined ) { return 0; }
    if ( mapin.size === 0 ) { return 0; }

    makeScriptlet.init();

    for ( const details of mapin.values() ) {
        makeScriptlet.compile(details);
    }
    const stats = await makeScriptlet.commit(
        assetDetails.id,
        `${scriptletDir}/scriptlet`,
        writeFile
    );
    if ( stats.length !== 0 ) {
        scriptletStats.set(assetDetails.id, stats);
    }
    makeScriptlet.reset();
    return stats.length;
}

/******************************************************************************/

async function rulesetFromURLs(assetDetails) {
    log('============================');
    log(`Listset for '${assetDetails.id}':`);

    if ( assetDetails.text === undefined && assetDetails.urls.length !== 0 ) {
        const text = await fetchList(assetDetails);
        assetDetails.text = text;
    } else {
        assetDetails.text = '';
    }

    if ( Array.isArray(assetDetails.filters) && assetDetails.filters.length ) {
        const extra = [
            `!#trusted on ${secret}`,
            ...assetDetails.filters,
            `!#trusted off ${secret}`,
            assetDetails.text,
        ];
        assetDetails.text = extra.join('\n').trim();
    }

    if ( assetDetails.text === '' ) { return; }

    const extensionPaths = [];
    for ( const [ fname, details ] of redirectResourcesMap ) {
        const path = `/web_accessible_resources/${fname}`;
        extensionPaths.push([ fname, path ]);
        if ( details.alias === undefined ) { continue; }
        if ( typeof details.alias === 'string' ) {
            extensionPaths.push([ details.alias, path ]);
            continue;
        }
        if ( Array.isArray(details.alias) === false ) { continue; }
        for ( const alias of details.alias ) {
            extensionPaths.push([ alias, path ]);
        }
    }

    const results = await dnrRulesetFromRawLists(
        [ { name: assetDetails.id, text: assetDetails.text } ],
        { env, extensionPaths, secret }
    );

    const netStats = await processNetworkFilters(
        assetDetails,
        results.network
    );

    // Split cosmetic filters into two groups: declarative and procedural
    const declarativeCosmetic = new Map();
    const proceduralCosmetic = new Map();
    const rejectedCosmetic = [];
    if ( results.specificCosmetic ) {
        for ( const [ selector, details ] of results.specificCosmetic ) {
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
    if ( rejectedCosmetic.length !== 0 ) {
        log(`Rejected cosmetic filters: ${rejectedCosmetic.length}`);
        log(rejectedCosmetic.map(line => `\t${line}`).join('\n'), true);
    }

    if (
        Array.isArray(results.network.generichideExclusions) &&
        results.network.generichideExclusions.length !== 0
    ) {
        genericDetails.set(
            assetDetails.id,
            results.network.generichideExclusions.filter(hn => hn.endsWith('.*') === false).sort()
        );
    }

    const genericCosmeticStats = await processGenericCosmeticFilters(
        assetDetails,
        results.genericCosmetic,
        results.genericCosmeticExceptions
    );
    const genericHighCosmeticStats = await processGenericHighCosmeticFilters(
        assetDetails,
        results.genericHighCosmetic,
        results.genericCosmeticExceptions
    );
    const specificCosmeticStats = await processCosmeticFilters(
        assetDetails,
        declarativeCosmetic
    );
    const declarativeStats = await processDeclarativeCosmeticFilters(
        assetDetails,
        proceduralCosmetic
    );
    const proceduralStats = await processProceduralCosmeticFilters(
        assetDetails,
        proceduralCosmetic
    );
    const scriptletStats = await processScriptletFilters(
        assetDetails,
        results.scriptlet
    );

    rulesetDetails.push({
        id: assetDetails.id,
        name: assetDetails.name,
        group: assetDetails.group,
        parent: assetDetails.parent,
        enabled: assetDetails.enabled,
        lang: assetDetails.lang,
        tags: assetDetails.tags,
        homeURL: assetDetails.homeURL,
        filters: {
            total: results.network.filterCount,
            accepted: results.network.acceptedFilterCount,
            rejected: results.network.rejectedFilterCount,
        },
        rules: {
            total: netStats.total,
            plain: netStats.plain,
            regex: netStats.regex,
            removeparam: netStats.removeparam,
            redirect: netStats.redirect,
            modifyHeaders: netStats.modifyHeaders,
            strictblock: netStats.strictblock,
            urlskip: netStats.urlskip,
            discarded: netStats.discarded,
            rejected: netStats.rejected,
        },
        css: {
            generic: genericCosmeticStats,
            generichigh: genericHighCosmeticStats,
            specific: specificCosmeticStats,
            declarative: declarativeStats,
            procedural: proceduralStats,
        },
        scriptlets: scriptletStats,
    });

    ruleResources.push({
        id: assetDetails.id,
        enabled: assetDetails.enabled,
        path: `/rulesets/main/${assetDetails.id}.json`
    });
}

/******************************************************************************/

async function main() {

    let version = '';
    {
        const now = new Date();
        const yearPart = now.getUTCFullYear();
        const monthPart = now.getUTCMonth() + 1;
        const dayPart = now.getUTCDate();
        const hourPart = Math.floor(now.getUTCHours());
        const minutePart = Math.floor(now.getUTCMinutes());
        version = `${yearPart}.${monthPart}.${dayPart}.${hourPart * 60 + minutePart}`;
    }
    log(`Version: ${version}`);

    // Get assets.json content
    const assets = await fs.readFile(
        `./assets.dev.json`,
        { encoding: 'utf8' }
    ).then(text =>
        JSON.parse(text)
    );

    // Assemble all default lists as the default ruleset
    await rulesetFromURLs({
        id: 'default',
        name: 'Ads, trackers, miners, and more' ,
        enabled: true,
        urls: [
            'https://ublockorigin.github.io/uAssets/filters/filters.min.txt',
            'https://ublockorigin.github.io/uAssets/filters/privacy.min.txt',
            'https://ublockorigin.github.io/uAssets/filters/unbreak.min.txt',
            'https://ublockorigin.github.io/uAssets/filters/quick-fixes.min.txt',
            'https://ublockorigin.github.io/uAssets/filters/ubol-filters.txt',
            'https://ublockorigin.github.io/uAssets/thirdparties/easylist.txt',
            'https://ublockorigin.github.io/uAssets/thirdparties/easyprivacy.txt',
            'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext',
        ],
        dnrURL: 'https://ublockorigin.github.io/uAssets/dnr/default.json',
        homeURL: 'https://github.com/uBlockOrigin/uAssets',
        filters: [
        ],
    });

    await rulesetFromURLs({
        id: 'badware',
        name: 'Badware risks' ,
        group: 'malware',
        enabled: true,
        urls: [
            'https://ublockorigin.github.io/uAssets/filters/badware.min.txt',
        ],
        homeURL: 'https://github.com/uBlockOrigin/uAssets',
        filters: [
        ],
    });

    // Handpicked rulesets from assets.json
    const handpicked = [
        'block-lan',
        'dpollock-0',
        'adguard-spyware-url',
    ];
    for ( const id of handpicked ) {
        const asset = assets[id];
        if ( asset.content !== 'filters' ) { continue; }
        const contentURL = Array.isArray(asset.contentURL)
            ? asset.contentURL[0]
            : asset.contentURL;
        await rulesetFromURLs({
            id: id.toLowerCase(),
            name: asset.title,
            enabled: false,
            urls: [ contentURL ],
            homeURL: asset.supportURL,
        });
    }

    // Handpicked annoyance rulesets from assets.json
    await rulesetFromURLs({
        id: 'annoyances-cookies',
        name: 'EasyList/uBO – Cookie Notices',
        group: 'annoyances',
        enabled: false,
        urls: [
            'https://ublockorigin.github.io/uAssets/thirdparties/easylist-cookies.txt',
            'https://ublockorigin.github.io/uAssets/filters/annoyances-cookies.txt',
        ],
        homeURL: 'https://github.com/easylist/easylist#fanboy-lists',
    });
    await rulesetFromURLs({
        id: 'annoyances-overlays',
        name: 'EasyList/uBO – Overlay Notices',
        group: 'annoyances',
        enabled: false,
        urls: [
            'https://ublockorigin.github.io/uAssets/thirdparties/easylist-newsletters.txt',
            'https://ublockorigin.github.io/uAssets/filters/annoyances-others.txt',
        ],
        homeURL: 'https://github.com/easylist/easylist#fanboy-lists',
    });
    await rulesetFromURLs({
        id: 'annoyances-social',
        name: 'EasyList – Social Widgets',
        group: 'annoyances',
        enabled: false,
        urls: [
            'https://ublockorigin.github.io/uAssets/thirdparties/easylist-social.txt',
        ],
        homeURL: 'https://github.com/easylist/easylist#fanboy-lists',
    });
    await rulesetFromURLs({
        id: 'annoyances-widgets',
        name: 'EasyList – Chat Widgets',
        group: 'annoyances',
        enabled: false,
        urls: [
            'https://ublockorigin.github.io/uAssets/thirdparties/easylist-chat.txt',
        ],
        homeURL: 'https://github.com/easylist/easylist#fanboy-lists',
    });
    await rulesetFromURLs({
        id: 'annoyances-others',
        name: 'EasyList – Other Annoyances',
        group: 'annoyances',
        enabled: false,
        urls: [
            'https://ublockorigin.github.io/uAssets/thirdparties/easylist-annoyances.txt'
        ],
        homeURL: 'https://github.com/easylist/easylist#fanboy-lists',
    });

    // Handpicked rulesets from abroad
    await rulesetFromURLs({
        id: 'urlhaus-full',
        name: 'Malicious URL Blocklist',
        group: 'malware',
        enabled: true,
        urls: [
            'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts.txt',
        ],
        filters: [
        ],
        homeURL: 'https://gitlab.com/malware-filter/urlhaus-filter',
    });
    await rulesetFromURLs({
        id: 'openphish-domains',
        name: 'OpenPhish Domain Blocklist',
        group: 'malware',
        enabled: true,
        urls: [
            'https://raw.githubusercontent.com/stephenhawk8054/openphish-adblock/refs/heads/main/filters_init_domains.txt',
        ],
        filters: [
        ],
        homeURL: 'https://github.com/stephenhawk8054/openphish-adblock',
    });

    await rulesetFromURLs({
        id: 'stevenblack-hosts',
        name: 'Steven Black’s Unified Hosts (adware + malware)',
        enabled: false,
        urls: [ 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts' ],
        homeURL: 'https://github.com/StevenBlack/hosts#readme',
    });

    // Regional rulesets
    const excludedLists = [
        'ara-0',
        'EST-0',
    ];
    // Merge lists which have same target languages
    const langToListsMap = new Map();
    for ( const [ id, asset ] of Object.entries(assets) ) {
        if ( asset.content !== 'filters' ) { continue; }
        if ( asset.off !== true ) { continue; }
        if ( asset.group !== 'regions' ) { continue; }
        if ( excludedLists.includes(id) ) { continue; }
        // Not all "regions" lists have a set language
        const bundleId = asset.lang ||
            createHash('sha256').update(randomBytes(16)).digest('hex').slice(0,16);
        let ids = langToListsMap.get(bundleId);
        if ( ids === undefined ) {
            langToListsMap.set(bundleId, ids = []);
        }
        ids.push(id);
    }
    for ( const ids of langToListsMap.values() ) {
        const urls = [];
        for ( const id of ids ) {
            const asset = assets[id];
            const contentURL = Array.isArray(asset.contentURL)
                ? asset.contentURL[0]
                : asset.contentURL;
            urls.push(contentURL);
        }
        const id = ids[0];
        const asset = assets[id];
        const rulesetDetails = {
            id: id.toLowerCase(),
            group: 'regions',
            parent: asset.parent,
            lang: asset.lang,
            name: asset.title,
            tags: asset.tags,
            enabled: false,
            urls,
            homeURL: asset.supportURL,
        };
        await rulesetFromURLs(rulesetDetails);
    }

    await rulesetFromURLs({
        id: 'est-0',
		group: 'regions',
		lang: 'et',
        name: '🇪🇪ee: Eesti saitidele kohandatud filter',
        enabled: false,
        urls: [ 'https://ubol-et.adblock.ee/list.txt' ],
        homeURL: 'https://github.com/sander85/uBOL-et',
    });

    writeFile(
        `${rulesetDir}/ruleset-details.json`,
        `${JSON.stringify(rulesetDetails, null, 1)}\n`
    );

    writeFile(
        `${rulesetDir}/scriptlet-details.json`,
        `${JSON.stringify(scriptletStats, jsonSetMapReplacer, 1)}\n`
    );

    writeFile(
        `${rulesetDir}/generic-details.json`,
        `${JSON.stringify(genericDetails, jsonSetMapReplacer, 1)}\n`
    );

    // Copy required redirect resources
    for ( const path of requiredRedirectResources ) {
        copyFile(`./${path}`, `${outputDir}/${path}`);
    }

    await Promise.all(writeOps);

    // Patch manifest
    // Get manifest content
    const manifest = await fs.readFile(
        `${outputDir}/manifest.json`,
        { encoding: 'utf8' }
    ).then(text =>
        JSON.parse(text)
    );
    // Patch declarative_net_request key
    manifest.declarative_net_request = { rule_resources: ruleResources };
    // Patch web_accessible_resources key
    manifest.web_accessible_resources = manifest.web_accessible_resources || [];
    const web_accessible_resources = {
        resources: Array.from(requiredRedirectResources).map(path => `/${path}`),
        matches: [ '<all_urls>' ],
    };
    if ( platform === 'chromium' ) {
        web_accessible_resources.use_dynamic_url = true;
    }
    manifest.web_accessible_resources.push(web_accessible_resources);

    // Patch manifest version property
    manifest.version = version;
    // Commit changes
    await fs.writeFile(
        `${outputDir}/manifest.json`,
        JSON.stringify(manifest, null, 2) + '\n'
    );

    // Log results
    const logContent = stdOutput.join('\n') + '\n';
    await fs.writeFile(`${outputDir}/log.txt`, logContent);
}

main();

/******************************************************************************/
