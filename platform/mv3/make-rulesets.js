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

import { execSync } from 'node:child_process';
import fs from 'fs/promises';
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
const envExtra = (( ) => {
    const env = commandLineArgs.get('env');
    return env ? env.split('|') : [];
})();
const env = [
    platform,
    'native_css_has',
    'mv3',
    'ublock',
    'ubol',
    'user_stylesheet',
    ...envExtra,
];

if ( platform === 'edge' ) {
    env.push('chromium');
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

const consoleLog = console.log;
const stdOutput = [];

const log = (text, silent = true) => {
    stdOutput.push(text);
    if ( silent === false ) {
        consoleLog(text);
    }
};

console.log = log;

const logProgress = text => {
    process?.stdout?.clearLine?.();
    process?.stdout?.cursorTo?.(0);
    process?.stdout?.write?.(text.length > 120 ? `${text.slice(0, 119)}… ` : `${text} `);
};

/******************************************************************************/

async function fetchText(url, cacheDir) {
    logProgress(`Reading locally cached ${path.basename(url)}`);
    const fname = url
        .replace(/^https?:\/\//, '')
        .replace(/\//g, '_');(url);
    const content = await fs.readFile(
        `${cacheDir}/${fname}`,
        { encoding: 'utf8' }
    ).catch(( ) => { });
    if ( content !== undefined ) {
        log(`\tFetched local ${url}`);
        return { url, content };
    }
    logProgress(`Fetching remote ${path.basename(url)}`);
    log(`\tFetching remote ${url}`);
    const response = await fetch(url).catch(( ) => { });
    if ( response === undefined ) {
        return { url, error: `Fetching failed: ${url}` };
    }
    let text;
    if ( response.ok ) {
        text = await response.text().catch(( ) => { });
    } else {
        text = await fallbackFetchText(url).catch(( ) => { });
    }
    if ( text === undefined ) {
        return { url, error: `Fetching text content failed: ${url}` };
    }
    writeFile(`${cacheDir}/${fname}`, text);
    return { url, content: text };
}

async function fallbackFetchText(url) {
    const match = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/master\/([^?]+)/.exec(url);
    if ( match === null ) { return; }
    logProgress(`\tGitHub CLI-fetching remote ${path.basename(url)}`);
    // https://docs.github.com/en/rest/repos/contents
    const content = execSync(`gh api \
        -H "Accept: application/vnd.github.raw+json" \
        -H "X-GitHub-Api-Version: 2022-11-28" \
        /repos/${match[1]}/${match[2]}/contents/${match[3]} \
    `, { encoding: 'utf8' });
    return content;
}

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
let networkBad = new Set();

// This will be used to sign our inserted `!#trusted on` directives
const secret = createHash('sha256').update(randomBytes(16)).digest('hex').slice(0,16);
log(`Secret: ${secret}`, false);

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
            if (
                assetDetails.trusted ||
                part.url.startsWith('https://ublockorigin.github.io/uAssets/filters/')
            ) {
                newParts.push(`!#trusted on ${secret}`);
            }
            newParts.push(
                fetchText(part.url, cacheDir).then(details => {
                    const { url, error } = details;
                    if ( error !== undefined ) { return details; }
                    const content = details.content.trim();
                    if ( /* content === '' || */ /^<.*>$/.test(content) ) {
                        return { url, error: `Bad content: ${url}` };
                    }
                    return { url, content };
                })
            );
            newParts.push(`!#trusted off ${secret}`);
        }
        if ( parts.some(v => typeof v === 'object' && v.error) ) { return; }
        parts = await Promise.all(newParts);
        parts = sfp.utils.preparser.expandIncludes(parts, env);
    }
    const text = parts.join('\n');

    if ( text === '' ) {
        log('No filterset found', false);
    }
    return text;
}

/******************************************************************************/

const isUnsupported = rule =>
    rule._error !== undefined;

const isRegex = rule =>
    rule.condition !== undefined &&
    rule.condition.regexFilter !== undefined;

const isGood = rule =>
    isUnsupported(rule) === false &&
    /^(allow|block|redirect|modifyHeaders|allowAllRequests)$/.test(rule.action?.type);

const isURLSkip = rule =>
    isUnsupported(rule) === false &&
    rule.action !== undefined &&
    rule.action.type === 'urlskip';

/******************************************************************************/

async function patchRuleset(ruleset) {
    return import(`./${platform}/patch-ruleset.js`).then(module => {
        return module.patchRuleset(ruleset)
    }).catch(( ) => {
        return ruleset;
    });
}

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
    const nodupProps = [ 'domains', 'excludedDomains', 'requestDomains', 'excludedRequestDomains', 'initiatorDomains', 'excludedInitiatorDomains' ];
    for ( const { condition } of ruleset ) {
        if ( condition === undefined ) { continue; }
        for ( const prop of nodupProps ) {
            if ( condition[prop] === undefined ) { continue; }
            condition[prop] = Array.from(new Set(condition[prop]));
        }
    }
    const sortProps = [ 'requestDomains', 'initiatorDomains', 'domains' ];
    ruleset.sort((a, b) => {
        let aLen = 0, bLen = 0;
        for ( const prop of sortProps ) {
            aLen += a.condition[prop]?.length ?? 0;
            bLen += b.condition[prop]?.length ?? 0;
        }
        return bLen - aLen;
    });
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
    let id = 1;
    for ( const rule of ruleset ) {
        rule.id = id++;
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
    const { resourceTypes } = condition;
    if ( resourceTypes === undefined ) {
        if ( condition.requestDomains === undefined ) { return; }
    } else if ( resourceTypes.includes('main_frame') === false ) {
        return;
    }
    let regexFilter;
    if ( condition.urlFilter ) {
        regexFilter = rePatternFromUrlFilter(condition.urlFilter);
    } else if ( condition.regexFilter ) {
        regexFilter = condition.regexFilter;
    } else {
        regexFilter = '^https?://.*';
    }
    if ( regexFilter.startsWith('^') === false ) {
        regexFilter = `^.*${regexFilter}`;
    }
    if (
        regexFilter.endsWith('$') === false &&
        regexFilter.endsWith('.*') === false &&
        regexFilter.endsWith('.+') === false
    ) {
        regexFilter = `${regexFilter}.*`;
    }
    const strictBlockRule = out.get(regexFilter) || {
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
        strictBlockRule.condition.requestDomains ??= [];
        strictBlockRule.condition.requestDomains = Array.from(
            new Set([
                ...strictBlockRule.condition.requestDomains,
                ...condition.requestDomains,
            ])
        );
    }
    if ( condition.excludedRequestDomains ) {
        strictBlockRule.condition.excludedRequestDomains ??= [];
        strictBlockRule.condition.excludedRequestDomains = Array.from(
            new Set([
                ...strictBlockRule.condition.excludedRequestDomains,
                ...condition.excludedRequestDomains,
            ])
        );
    }
    out.set(regexFilter, strictBlockRule);
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

    const staticRules = await patchRuleset(
        rules.filter(rule => isGood(rule) && isRegex(rule) === false)
    );
    log(`\tStatic rules: ${staticRules.length}`);
    log(staticRules
        .filter(rule => Array.isArray(rule._warning))
        .map(rule => rule._warning.map(v => `\t\t${v}`))
        .join('\n'), true
    );

    const regexRules = await patchRuleset(
        rules.filter(rule => isGood(rule) && isRegex(rule))
    );
    log(`\tMaybe good (regexes): ${regexRules.length}`);

    staticRules.forEach(rule => {
        if ( rule.action.redirect?.extensionPath === undefined ) { return; }
        requiredRedirectResources.add(
            rule.action.redirect.extensionPath.replace(/^\/+/, '')
        );
    });

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

    writeFile(`${rulesetDir}/main/${assetDetails.id}.json`,
        toJSONRuleset(staticRules)
    );

    if ( regexRules.length !== 0 ) {
        writeFile(`${rulesetDir}/regex/${assetDetails.id}.json`,
            toJSONRuleset(regexRules)
        );
    }

    const strictBlocked = new Map();
    for ( const rule of staticRules ) {
        toStrictBlockRule(rule, strictBlocked);
    }
    if ( strictBlocked.size !== 0 ) {
        mergeRules(strictBlocked, 'requestDomains');
        writeFile(`${rulesetDir}/strictblock/${assetDetails.id}.json`,
            toJSONRuleset(Array.from(strictBlocked.values()))
        );
    }

    if ( urlskips.size !== 0 ) {
        writeFile(`${rulesetDir}/urlskip/${assetDetails.id}.json`,
            JSON.stringify(Array.from(urlskips.values()), null, 1)
        );
    }

    return {
        total: rules.length,
        plain: staticRules.length,
        rejected: bad.length,
        regex: regexRules.length,
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

// http://www.cse.yorku.ca/~oz/hash.html#djb2
//   Must mirror content script surveyor's version

async function processGenericCosmeticFilters(
    assetDetails,
    selectorList,
    exceptionList,
    declarativeMap
) {
    const exceptionSet = new Set(
        exceptionList &&
        exceptionList.filter(a => a.key !== undefined).map(a => a.selector)
    );

    const genericSelectorMap = new Map();
    if ( selectorList ) {
        for ( const { key, selector } of selectorList ) {
            if ( key === undefined ) { continue; }
            if ( exceptionSet.has(selector) ) { continue; }
            const type = key.charCodeAt(0);
            const hash = hashFromStr(type, key.slice(1));
            const selectors = genericSelectorMap.get(hash);
            if ( selectors === undefined ) {
                genericSelectorMap.set(hash, selector)
            } else {
                genericSelectorMap.set(hash, `${selectors},\n${selector}`)
            }
        }
    }

    // Specific exceptions
    const genericExceptionSieve = new Set();
    const genericExceptionMap = new Map();
    if ( declarativeMap ) {
        for ( const [ exception, details ] of declarativeMap ) {
            if ( details.rejected ) { continue; }
            if ( details.key === undefined ) { continue; }
            if ( details.matches !== undefined ) { continue; }
            if ( details.excludeMatches === undefined ) { continue; }
            const type = details.key.charCodeAt(0);
            const hash = hashFromStr(type, details.key.slice(1));
            genericExceptionSieve.add(hash);
            for ( const hn of details.excludeMatches ) {
                const exceptions = genericExceptionMap.get(hn);
                if ( exceptions === undefined ) {
                    genericExceptionMap.set(hn, exception);
                } else {
                    genericExceptionMap.set(hn, `${exceptions}\n${exception}`);
                }
            }
        }
    }

    if ( genericSelectorMap.size === 0 ) {
        if ( genericExceptionMap.size === 0 ) { return 0; }
    }

    const originalScriptletMap = await loadAllSourceScriptlets();
    let patchedScriptlet = originalScriptletMap.get('css-generic').replace(
        '$rulesetId$',
        assetDetails.id
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$genericSelectorMap\$/,
        `${JSON.stringify(genericSelectorMap, scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$genericExceptionSieve\$/,
        `${JSON.stringify(genericExceptionSieve, scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$genericExceptionMap\$/,
        `${JSON.stringify(genericExceptionMap, scriptletJsonReplacer)}`
    );

    writeFile(`${scriptletDir}/generic/${assetDetails.id}.js`,
        patchedScriptlet
    );

    log(`CSS-generic: ${genericExceptionSieve.size} specific CSS exceptions`);
    log(`CSS-generic: ${genericSelectorMap.size} plain CSS selectors`);

    return genericSelectorMap.size + genericExceptionSieve.size;
}

const hashFromStr = (type, s) => {
    const len = s.length;
    const step = len + 7 >>> 3;
    let hash = (type << 5) + type ^ len;
    for ( let i = 0; i < len; i += step ) {
        hash = (hash << 5) + hash ^ s.charCodeAt(i);
    }
    return hash & 0xFFF;
};

/******************************************************************************/

async function processGenericHighCosmeticFilters(
    assetDetails,
    genericSelectorList,
    genericExceptionList
) {
    if ( genericSelectorList === undefined ) { return 0; }
    const genericSelectorSet = new Set(
        genericSelectorList
            .filter(a => a.key === undefined)
            .map(a => a.selector)
    );
    // https://github.com/uBlockOrigin/uBOL-home/issues/365
    if ( genericExceptionList ) {
        for ( const entry of genericExceptionList ) {
            if ( entry.key !== undefined ) { continue; }
            globalHighlyGenericExceptionSet.add(entry.selector);
        }
    }
    for ( const selector of globalHighlyGenericExceptionSet ) {
        if ( genericSelectorSet.has(selector) === false ) { continue; }
        genericSelectorSet.delete(selector);
        log(`\tRemoving excepted highly generic filter ##${selector}`);
    }
    if ( genericSelectorSet.size === 0 ) { return 0; }
    const selectorLists = Array.from(genericSelectorSet).sort().join(',\n');
    const originalScriptletMap = await loadAllSourceScriptlets();

    let patchedScriptlet = originalScriptletMap.get('css-generichigh').replace(
        '$rulesetId$',
        assetDetails.id
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\$selectorList\$/,
        selectorLists
    );

    writeFile(`${scriptletDir}/generichigh/${assetDetails.id}.css`,
        patchedScriptlet
    );

    log(`CSS-generic-high: ${genericSelectorSet.size} plain CSS selectors`);

    return genericSelectorSet.size;
}

const globalHighlyGenericExceptionSet = new Set();

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
    const argsList = [ '' ];
    const indexMap = new Map();
    for ( const [ id, details ] of argsMap ) {
        indexMap.set(id, argsList.length);
        argsList.push(details);
    }
    const argsSeqs = [ 0 ];
    const argsSeqsIndices = new Map();
    for ( const [ hn, ids ] of hostnamesMap ) {
        const seqKey = JSON.stringify(ids);
        if ( argsSeqsIndices.has(seqKey) ) {
            hostnamesMap.set(hn, argsSeqsIndices.get(seqKey));
            continue;
        }
        const seqIndex = argsSeqs.length;
        argsSeqsIndices.set(seqKey, seqIndex);
        hostnamesMap.set(hn, seqIndex);
        if ( typeof ids === 'number' ) {
            argsSeqs.push(indexMap.get(ids));
            continue;
        }
        for ( let i = 0; i < ids.length; i++ ) {
            argsSeqs.push(-indexMap.get(ids[i]));
        }
        argsSeqs[argsSeqs.length-1] = -argsSeqs[argsSeqs.length-1];
    }
    return { argsList, argsSeqs };
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
        entry[1].a ? entry[1].a.join('\n') : undefined,
    ]);
    const hostnamesMap = new Map();
    let hasEntities = false;
    for ( const [ id, details ] of domainBasedEntries ) {
        if ( details.y ) {
            scriptletHostnameToIdMap(details.y, id, hostnamesMap);
            hasEntities ||= details.y.some(a => a.endsWith('.*'));
        }
        if ( details.n ) {
            scriptletHostnameToIdMap(details.n.map(a => `~${a}`), id, hostnamesMap);
            hasEntities ||= details.n.some(a => a.endsWith('.*'));
        }
    }
    const { argsList, argsSeqs } = argsMap2List(argsMap, hostnamesMap);

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
        /\bself\.\$argsSeqs\$/,
        `${JSON.stringify(argsSeqs, scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$hostnamesMap\$/,
        `${JSON.stringify(hostnamesMap, scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        'self.$hasEntities$',
        JSON.stringify(hasEntities)
    );
    writeFile(`${scriptletDir}/specific/${assetDetails.id}.js`, patchedScriptlet);
    generatedFiles.push(`${assetDetails.id}`);

    if ( generatedFiles.length !== 0 ) {
        log(`CSS-specific: ${mapin.size} distinct filters`);
        log(`\tCombined into ${hostnamesMap.size} distinct hostnames`);
    }

    return hostnamesMap.size;
}

/******************************************************************************/

async function processProceduralCosmeticFilters(assetDetails, mapin) {
    if ( mapin === undefined ) { return 0; }
    if ( mapin.size === 0 ) { return 0; }

    const procedurals = new Map();
    mapin.forEach((details, jsonSelector) => {
        procedurals.set(jsonSelector, details);
    });
    if ( procedurals.size === 0 ) { return 0; }

    const contentArray = groupHostnamesBySelectors(
        groupSelectorsByHostnames(procedurals)
    );

    const argsMap = contentArray.map(entry => [
        entry[0],
        entry[1].a,
    ]);
    const hostnamesMap = new Map();
    let hasEntities = false;
    for ( const [ id, details ] of contentArray ) {
        if ( details.y ) {
            scriptletHostnameToIdMap(details.y, id, hostnamesMap);
            hasEntities ||= details.y.some(a => a.endsWith('.*'));
        }
        if ( details.n ) {
            scriptletHostnameToIdMap(details.n.map(a => `~${a}`), id, hostnamesMap);
            hasEntities ||= details.n.some(a => a.endsWith('.*'));
        }
    }
    const { argsList, argsSeqs } = argsMap2List(argsMap, hostnamesMap);
    const argsListAfter = [];
    for ( const a of argsList ) {
        const aAfter = [];
        for ( let b of a ) {
            aAfter.push(JSON.parse(b));
        }
        argsListAfter.push(JSON.stringify(aAfter));
    }
    const originalScriptletMap = await loadAllSourceScriptlets();
    let patchedScriptlet = originalScriptletMap.get('css-procedural').replace(
        '$rulesetId$',
        assetDetails.id
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$argsList\$/,
        `${JSON.stringify(argsListAfter, scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$argsSeqs\$/,
        `${JSON.stringify(argsSeqs, scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$hostnamesMap\$/,
        `${JSON.stringify(hostnamesMap, scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        'self.$hasEntities$',
        JSON.stringify(hasEntities)
    );
    writeFile(`${scriptletDir}/procedural/${assetDetails.id}.js`, patchedScriptlet);

    if ( contentArray.length !== 0 ) {
        log(`Procedural-related distinct filters: ${procedurals.size} distinct combined selectors`);
        log(`\tCombined into ${hostnamesMap.size} distinct hostnames`);
    }

    return hostnamesMap.size;
}

/******************************************************************************/

async function processScriptletFilters(assetDetails, mapin) {
    if ( mapin === undefined ) { return 0; }
    if ( mapin.size === 0 ) { return 0; }

    makeScriptlet.init();

    for ( const details of mapin.values() ) {
        makeScriptlet.compile(assetDetails, details);
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
        if ( text === undefined ) {
            process.exit(1);
        }
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
        { env, extensionPaths, secret, networkBad }
    );
    networkBad = results.networkBad;

    // Release memory used by filter list content
    assetDetails.text = undefined;

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

    const genericDetailsForRuleset = {};
    if (
        Array.isArray(results.network.generichideExclusions) &&
        results.network.generichideExclusions.length !== 0
    ) {
        genericDetailsForRuleset.unhide = results.network.generichideExclusions
            .filter(hn => hn.endsWith('.*') === false)
            .sort();
    }
    if (
        Array.isArray(results.network.generichideInclusions) &&
        results.network.generichideInclusions.length !== 0
    ) {
        genericDetailsForRuleset.hide = results.network.generichideInclusions
            .filter(hn => hn.endsWith('.*') === false)
            .sort();
    }
    if ( genericDetailsForRuleset.unhide || genericDetailsForRuleset.hide ) {
        genericDetails.set(assetDetails.id, genericDetailsForRuleset);
    }

    const genericCosmeticStats = await processGenericCosmeticFilters(
        assetDetails,
        results.genericCosmeticFilters,
        results.genericCosmeticExceptions,
        declarativeCosmetic
    );
    const genericHighCosmeticStats = await processGenericHighCosmeticFilters(
        assetDetails,
        results.genericCosmeticFilters,
        results.genericCosmeticExceptions,
    );
    const specificCosmeticStats = await processCosmeticFilters(
        assetDetails,
        declarativeCosmetic
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
        version = `${yearPart}.${monthPart*100+dayPart}.${hourPart*100+minutePart}`;
    }
    log(`Version: ${version}`, false);

    // Get list of rulesets
    const rulesets = await fs.readFile('rulesets.json', {
        encoding: 'utf8'
    }).then(text =>
        JSON.parse(text)
    );

    for ( const ruleset of rulesets ) {
        if ( ruleset.excludedPlatforms?.includes(platform) ) { continue; }
        await rulesetFromURLs(ruleset);
    }

    logProgress('');

    writeFile(`${rulesetDir}/ruleset-details.json`,
        `${JSON.stringify(rulesetDetails, null, 1)}\n`
    );

    writeFile(`${rulesetDir}/scriptlet-details.json`,
        `${JSON.stringify(scriptletStats, jsonSetMapReplacer, 1)}\n`
    );

    writeFile(`${rulesetDir}/generic-details.json`,
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
        resources: Array.from(requiredRedirectResources).map(path => `${path}`),
        matches: [ '<all_urls>' ],
    };
    if ( env.includes('chromium') && env.includes('safari') === false ) {
        web_accessible_resources.use_dynamic_url = true;
    }
    manifest.web_accessible_resources.push(web_accessible_resources);

    // Patch manifest version property
    manifest.version = version;
    // Commit changes
    await fs.writeFile(`${outputDir}/manifest.json`,
        JSON.stringify(manifest, null, 2) + '\n'
    );

    // Log results
    const logContent = stdOutput.join('\n') + '\n';
    await fs.writeFile(`${outputDir}/log.txt`, logContent);
}

main();

/******************************************************************************/
