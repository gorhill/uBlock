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

import './lib/regexanalyzer/regex.js';

import * as makeScriptlets from './js/offscreen/make-scriptlets.js';

import {
    createHash,
    randomBytes,
} from 'crypto';
import {
    dnrRulesetFromRawLists,
    mergeRules,
} from './js/static-dnr-filtering.js';

import { execSync } from 'node:child_process';
import { fetchList } from './js/offscreen/fetch-list.js';
import fs from 'fs/promises';
import { hostnameCompare } from './js/offscreen/make-utils.js';
import { literalStrFromRegex } from './js/offscreen/regex-analyzer.js';
import { makeCosmeticScripts } from './js/offscreen/make-cosmetic-filters.js';
import { minimizeRuleset } from './js/ubo-parser.js';
import path from 'path';
import process from 'process';
import redirectResourcesMap from './js/redirect-resources.js';
import { safeReplace } from './js/offscreen/safe-replace.js';

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
const rePatternIsHostname = /^\|\|[^*/?|^]+\^$/;
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

/******************************************************************************/

const consoleLog = console.log;
const stdOutput = [];

const log = (text, silent = true) => {
    silent = silent && text.startsWith('!!!') === false;
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

/******************************************************************************/

// "secret" will be used to sign our inserted `!#trusted on` directives
const secret = await fs.readFile(`${cacheDir}/secret.txt`, {
    encoding: 'utf8'
}).catch(( ) => {
    const secret = createHash('sha256').update(randomBytes(16)).digest('hex').slice(0,16);
    writeFile(`${cacheDir}/secret.txt`, secret);
    return secret;
});
log(`Secret: ${secret}`, false);

/******************************************************************************/

const restrSeparator = '[^%.0-9a-z_-]';

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
                 .replace(rePatternFromUrlFilter.reAsterisks, '.*?');
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
    } else if ( reStr.endsWith(restrSeparator) ) {
        reStr += '?';
    }
    return (new RegExp(reStr)).source;
};
rePatternFromUrlFilter.rePlainChars = /[.+?${}()|[\]\\]/g;
rePatternFromUrlFilter.reSeparators = /\^/g;
rePatternFromUrlFilter.reDanglingAsterisks = /^\*+|\*+$/g;
rePatternFromUrlFilter.reAsterisks = /\*+/g;
rePatternFromUrlFilter.restrHostnameAnchor1 = '^[^:]+://([^:/]+\\.)?';
rePatternFromUrlFilter.restrHostnameAnchor2 = '^[^:]+://([^:/]+)?';

/******************************************************************************/

async function fetchListFromCache(assetDetails) {
    const fname = assetDetails.id;
    logProgress(`Reading locally cached ${fname}`);

    const content = await fs.readFile(`${cacheDir}/${fname}`,
        { encoding: 'utf8' }
    ).catch(( ) => { });
    if ( content !== undefined ) {
        log(`\tFetched local ${fname}`);
        return content;
    }

    const context = {
        env,
        secret,
        trustedPrefixes: [ 'https://ublockorigin.github.io/uAssets/filters/' ],
    };

    const text = await fetchList(context, assetDetails);
    writeFile(`${cacheDir}/${fname}`, text);

    if ( Boolean(text) === false ) {
        throw 'Filter list should not be empty';
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
    const nodupProps = [
        'domains',
        'excludedDomains',
        'requestDomains',
        'excludedRequestDomains',
        'initiatorDomains',
        'excludedInitiatorDomains',
        'topDomains',
        'excludedTopDomains',
    ];
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
    const { condition } = rule;
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
    return true;
}

function isStrictBlockRule(rule) {
    if ( rule.action.type !== 'block' ) { return; }
    const { condition } = rule;
    if ( condition === undefined ) { return; }
    if ( condition.domainType ) { return; }
    if ( condition.excludedResourceTypes ) { return; }
    if ( condition.requestMethods ) { return; }
    if ( condition.excludedRequestMethods ) { return; }
    if ( condition.responseHeaders ) { return; }
    if ( condition.requestHeaders ) { return; }
    if ( condition.excludedResponseHeaders ) { return; }
    if ( condition.initiatorDomains ) { return; }
    if ( condition.excludedInitiatorDomains ) { return; }
    const { resourceTypes } = condition;
    if ( resourceTypes ) {
        return resourceTypes.includes('main_frame');
    }
    if ( condition.requestDomains ) {
        return condition.urlFilter === undefined && condition.regexFilter === undefined;
    }
    return rePatternIsHostname.test(condition.urlFilter);
}

/******************************************************************************/

function splitDnrRules(rules) {
    const dnrRules = [];
    const popupRules = [];
    const sbRules = [];
    for ( const rule of rules ) {
        if ( rule._error ) { continue; }
        const nottypes = rule.condition?.excludedResourceTypes;
        if ( nottypes ) {
            rule.condition.excludedResourceTypes = nottypes.filter(a =>
                a !== 'popup'
            );
            if ( rule.condition.excludedResourceTypes.length === 0 ) {
                rule.condition.excludedResourceTypes = undefined;
            }
        }
        let types = rule.condition?.resourceTypes;
        if ( isStrictBlockRule(rule) ) {
            const sbRule = structuredClone(rule);
            sbRule.condition.resourceTypes = undefined;
            sbRules.push(sbRule);
            if ( types ) {
                types = types.filter(a => a !== 'main_frame');
            }
        }
        if ( isPopupRule(rule) ) {
            const popupRule = structuredClone(rule);
            popupRule.condition.resourceTypes = undefined;
            popupRules.push(popupRule);
            if ( types ) {
                types = types.filter(a => a !== 'popup');
            }
        }
        if ( types ) {
            if ( types.length === 0 ) { continue; }
            rule.condition.resourceTypes = types;
        }
        dnrRules.push(rule);
    }
    return { dnrRules, sbRules, popupRules };
}

/******************************************************************************/

async function processDnrRules(assetDetails, network, dnrRules) {
    log(`Input filter count: ${network.filterCount}`);
    log(`\tAccepted filter count: ${network.acceptedFilterCount}`);
    log(`\tRejected filter count: ${network.rejectedFilterCount}`);
    log(`Output rule count: ${dnrRules.length}`);

    // Minimize requestDomains arrays
    for ( const rule of dnrRules ) {
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
            dnrRules.push(rule);
        }
    }

    const staticRules = await patchRuleset(
        dnrRules.filter(rule => isGood(rule) && isRegex(rule) === false)
    );
    log(staticRules
        .filter(rule => Array.isArray(rule._warning))
        .map(rule => rule._warning.map(v => `\t\t${v}`))
        .join('\n'), true
    );

    const regexRules = await patchRuleset(
        dnrRules.filter(rule => isGood(rule) && isRegex(rule))
    );
    const minimizedRegexRuleset = minimizeRuleset(regexRules);
    log(`\tMaybe good regexes (raw/minimized): ${regexRules.length}/${minimizedRegexRuleset.length}`);

    staticRules.forEach(rule => {
        if ( rule.action.redirect?.extensionPath === undefined ) { return; }
        requiredRedirectResources.add(
            rule.action.redirect.extensionPath.replace(/^\/+/, '')
        );
    });

    // Minimize rulesets
    const minimizedStaticRuleset = minimizeRuleset(staticRules);
    log(`\tStatic rules (raw/minimized): ${staticRules.length}/${minimizedStaticRuleset.length}`);

    const urlskips = new Map();
    for ( const rule of dnrRules ) {
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

    const bad = dnrRules.filter(rule =>
        isUnsupported(rule)
    );
    log(`\tUnsupported: ${bad.length}`);
    log(bad.map(rule => rule._error.map(v => `\t\t${v}`)).join('\n'), true);

    writeFile(`${rulesetDir}/main/${assetDetails.id}.json`,
        toJSONRuleset(minimizedStaticRuleset)
    );

    if ( minimizedRegexRuleset.length !== 0 ) {
        writeFile(`${rulesetDir}/regex/${assetDetails.id}.json`,
            toJSONRuleset(minimizedRegexRuleset)
        );
    }

    if ( urlskips.size !== 0 ) {
        writeFile(`${rulesetDir}/urlskip/${assetDetails.id}.json`,
            JSON.stringify(Array.from(urlskips.values()), null, 1)
        );
    }

    return {
        total: minimizedStaticRuleset.length + minimizedRegexRuleset.length,
        plain: minimizedStaticRuleset.length,
        regex: minimizedRegexRuleset.length,
        rejected: bad.length,
        urlskip: urlskips.size || undefined,
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
    specificMap
) {
    const exceptionSet = new Set(
        exceptionList &&
        exceptionList.filter(a => a.key !== undefined).map(a => a.selector)
    );

    const lowlyGenericMap = new Map();
    const highlyGenericList = [];
    if ( selectorList ) {
        for ( const { key, selector } of selectorList ) {
            if ( key === undefined ) { continue; }
            if ( exceptionSet.has(selector) ) { continue; }
            const type = key.charCodeAt(0);
            const hash = hashFromStr(type, key.slice(1));
            if ( lowlyGenericMap.has(hash) ) {
                lowlyGenericMap.set(hash, `${lowlyGenericMap.get(hash)},\n${selector}`);
            } else {
                lowlyGenericMap.set(hash, selector);
            }
        }
        selectorList
            .filter(a => a.key === undefined)
            .forEach(a => highlyGenericList.push(a.selector));
    }

    // Specific exceptions
    const exceptionMap = new Map();
    if ( specificMap ) {
        for ( const [ exception, details ] of specificMap ) {
            if ( details.rejected ) { continue; }
            if ( details.matches !== undefined ) { continue; }
            if ( details.excludeMatches === undefined ) { continue; }
            if ( exception.startsWith('{') ) { continue; }
            for ( const hn of details.excludeMatches ) {
                const exceptions = exceptionMap.get(hn);
                if ( exceptions === undefined ) {
                    exceptionMap.set(hn, exception);
                } else {
                    exceptionMap.set(hn, `${exceptions}\n${exception}`);
                }
            }
        }
    }

    if ( lowlyGenericMap.size === 0 && highlyGenericList.length === 0 ) {
        if ( exceptionMap.size === 0 ) { return 0; }
    }

    const originalScriptletMap = await loadAllSourceScriptlets();
    let patchedScriptlet = originalScriptletMap.get('css-generic').replace(
        '$rulesetId$',
        assetDetails.id
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$lowlyGeneric\$/,
        `/* ${lowlyGenericMap.size} */${JSON.stringify(lowlyGenericMap, scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$highlyGeneric\$/,
        `/* ${highlyGenericList.length} */${JSON.stringify(highlyGenericList.join(',\n'))}`
    );
    const sortedExceptionList = Array.from(exceptionMap).sort((a, b) =>
        hostnameCompare(a[0], b[0])
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$exceptions\$/,
        `/* ${sortedExceptionList.length} */${JSON.stringify(sortedExceptionList.map(a => a[1]), scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$hostnames\$/,
        `/* ${sortedExceptionList.length} */${JSON.stringify(sortedExceptionList.map(a => a[0]), scriptletJsonReplacer)}`
    );
    patchedScriptlet = safeReplace(patchedScriptlet,
        /\bself\.\$hasEntities\$/,
        `${JSON.stringify(sortedExceptionList.some(a => a[0].endsWith('.*')))}`
    );

    writeFile(`${scriptletDir}/generic/${assetDetails.id}.js`,
        patchedScriptlet
    );

    log(`CSS-generic-low: ${lowlyGenericMap.size} plain CSS selectors`);
    log(`CSS-generic-high: ${highlyGenericList.length} plain CSS selectors`);
    log(`CSS-generic: ${exceptionMap.size} specific CSS exceptions`);

    return lowlyGenericMap.size + highlyGenericList.length + exceptionMap.size;
}

const hashFromStr = (type, s) => {
    const len = s.length;
    const step = len + 7 >>> 3;
    let hash = (type << 5) + type ^ len;
    for ( let i = 0; i < len; i += step ) {
        hash = (hash << 5) + hash ^ s.charCodeAt(i);
    }
    return hash & 0xFFFF;
};

/******************************************************************************/

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
    const template = await fs.readFile(`./scriptlets/css-specific.template.js`, {
        encoding: 'utf8',
    });
    const result = await makeCosmeticScripts(assetDetails.id, mapin);
    if ( result === undefined ) { return 0; }
    writeFile(`${scriptletDir}/specific/${assetDetails.id}.json`, JSON.stringify(result.data));
    writeFile(`${scriptletDir}/specific/${assetDetails.id}.js`,
        template.replace('self.$rulesetId$', JSON.stringify(assetDetails.id))
    );
    log(`CSS-specific: ${result.selectorCount} distinct filters for ${result.hostnameCount} distinct hostnames`);
    return result.hostnameCount + result.regexCount;
}

/******************************************************************************/

async function processScriptletFilters(assetDetails, mapin) {
    if ( mapin === undefined ) { return 0; }
    if ( mapin.size === 0 ) { return 0; }

    const { id } = assetDetails;
    for ( const details of mapin.values() ) {
        makeScriptlets.compile(id, details);
    }
    const template = await fs.readFile('./js/offscreen/scriptlet.template.js', {
        encoding: 'utf8',
    });
    const result = makeScriptlets.commit(id, template);
    const stats = {};
    let count = 0;
    if ( result.MAIN ) {
        writeFile(`${scriptletDir}/scriptlet/main/${id}.js`, result.MAIN.code);
        stats.MAIN = result.MAIN.hostnames;
        count += result.MAIN.hostnames.length;
    }
    if ( result.ISOLATED ) {
        writeFile(`${scriptletDir}/scriptlet/isolated/${id}.js`, result.ISOLATED.code);
        stats.ISOLATED = result.ISOLATED.hostnames;
        count += result.ISOLATED.hostnames.length;
    }
    if ( count !== 0 ) {
        scriptletStats.set(id, stats);
    }
    makeScriptlets.reset();
    return count;
}

/******************************************************************************/

async function processPopupRules(assetDetails, popupRules) {
    if ( popupRules.length === 0 ) { return; }
    const reduceRules = (data, rule) => {
        const { condition }  = rule;
        if ( condition.domainType ) { return data; }
        if ( condition.initiatorDomains ) { return data; }
        const { type } = rule.action;
        if ( type !== 'block' && type !== 'allow' ) { return data; }
        const realm = type === 'block' ? data.block : data.allow;
        const { urlFilter, regexFilter, isUrlFilterCaseSensitive } = condition;
        if ( urlFilter || regexFilter ) {
            if ( rePatternIsHostname.test(urlFilter) ) {
                realm.hostnames.push(urlFilter.slice(2, -1));
                return data;
            }
            let re;
            if ( urlFilter ) {
                re = rePatternFromUrlFilter(urlFilter);
            } else if ( regexFilter ) {
                re = regexFilter;
            }
            if ( re === undefined ) { return data; }
            const token = literalStrFromRegex(re).slice(0, 7);
            const key = `${isUrlFilterCaseSensitive ? ' ' : 'i'}${token}`;
            if ( realm.regexes.has(key) ) {
                realm.regexes.set(key, `${realm.regexes.get(key)}|${re}`);
            } else {
                realm.regexes.set(key, re);
            }
            return data;
        }
        if ( Array.isArray(condition.requestDomains) ) {
            realm.hostnames = realm.hostnames.concat(condition.requestDomains);
        }
        return data;
    };
    const data = {
        id: assetDetails.id,
        block: {
            hostnames: [],
            regexes: new Map(),
        },
        allow: {
            hostnames: [],
            regexes: new Map(),
        },
    };
    popupRules.reduce(reduceRules, data);
    const count = data.block.hostnames.length + data.block.regexes.size;
    if ( count === 0 ) { return; }
    data.block.hostnames = data.block.hostnames.toSorted(hostnameCompare);
    data.block.regexes = Array.from(data.block.regexes).flat();
    data.allow.hostnames = data.allow.hostnames.toSorted(hostnameCompare);
    data.allow.regexes = Array.from(data.allow.regexes).flat();
    const originalScriptletMap = await loadAllSourceScriptlets();
    let patchedScriptlet = originalScriptletMap.get(`prevent-popup`);
    patchedScriptlet = safeReplace(patchedScriptlet,
        /self\.\$details\$/,
        JSON.stringify(data)
    );
    writeFile(`${rulesetDir}/scripting/popup/${assetDetails.id}.js`,
        patchedScriptlet
    );
    return count;
}

function isPopupRule(rule) {
    return Boolean(rule.condition.resourceTypes?.includes('popup'));
}

/******************************************************************************/

async function rulesetFromURLs(assetDetails) {
    log('============================');
    log(`Listset for '${assetDetails.id}':`);

    if ( assetDetails.text === undefined && assetDetails.urls.length !== 0 ) {
        const text = await fetchListFromCache(assetDetails);
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

    const excludedResources = new Set([
        'click2load.html',
    ]);
    const extensionPaths = [];
    for ( const [ fname, details ] of redirectResourcesMap ) {
        if ( excludedResources.has(fname) ) { continue; }
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

    writeFile(`${rulesetDir}/debug/${assetDetails.id}.all.json`,
        JSON.stringify(results.network.ruleset, null, 2)
    );
    const { dnrRules, sbRules, popupRules } = splitDnrRules(results.network.ruleset)
    writeFile(`${rulesetDir}/debug/${assetDetails.id}.plain.json`,
        JSON.stringify(dnrRules, null, 2)
    );
    writeFile(`${rulesetDir}/debug/${assetDetails.id}.sb.json`,
        JSON.stringify(sbRules, null, 2)
    );
    writeFile(`${rulesetDir}/debug/${assetDetails.id}.popup.json`,
        JSON.stringify(popupRules, null, 2)
    );

    const netStats = await processDnrRules(assetDetails, results.network, dnrRules);
    const popupStats = await processPopupRules(assetDetails, popupRules);

    const strictBlocked = new Map();
    for ( const rule of sbRules ) {
        toStrictBlockRule(rule, strictBlocked);
    }
    if ( strictBlocked.size !== 0 ) {
        mergeRules(strictBlocked, 'requestDomains');
        writeFile(`${rulesetDir}/strictblock/${assetDetails.id}.json`,
            toJSONRuleset(Array.from(strictBlocked.values()))
        );
    }

    // Split cosmetic filters into two groups: declarative and procedural
    const rejectedCosmetic = [];
    const specificCosmetic = new Map();
    if ( results.specificCosmetic ) {
        for ( const [ selector, details ] of results.specificCosmetic ) {
            if ( details.rejected ) {
                rejectedCosmetic.push(selector);
                continue;
            }
            if ( selector.startsWith('{') === false ) {
                specificCosmetic.set(selector, details);
            } else {
                const parsed = JSON.parse(selector);
                parsed.raw = undefined;
                specificCosmetic.set(JSON.stringify(parsed), details);
            }
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
        specificCosmetic
    );
    const specificCosmeticStats = await processCosmeticFilters(
        assetDetails,
        specificCosmetic
    );

    await processScriptletFilters(assetDetails, results.scriptlet);

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
            strictblock: strictBlocked.size || undefined,
            urlskip: netStats.urlskip,
            discarded: netStats.discarded,
            rejected: netStats.rejected,
        },
        css: {
            generic: genericCosmeticStats,
            specific: specificCosmeticStats,
        },
        popups: popupStats,
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
