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

import rulesetConfigs from './ruleset-config.js';
import { dnrRulesetFromRawLists } from './js/static-dnr-filtering.js';

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

async function main() {

    const writeOps = [];
    const ruleResources = [];
    const rulesetDetails = [];
    const outputDir = commandLineArgs.get('output') || '.';

    let goodTotalCount = 0;
    let maybeGoodTotalCount = 0;

    const output = [];
    const log = (text, silent = false) => {
        output.push(text);
        if ( silent === false ) {
            console.log(text);
        }
    };

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
        isRemoveparam(rule) === false
        ;

    const rulesetDir = `${outputDir}/rulesets`;
    const rulesetDirPromise = fs.mkdir(`${rulesetDir}`, { recursive: true });

    const fetchList = url => {
        return new Promise((resolve, reject) => {
            https.get(url, response => {
                const data = [];
                response.on('data', chunk => {
                    data.push(chunk.toString());
                });
                response.on('end', ( ) => {
                    resolve({ name: url, text: data.join('') });
                });
            }).on('error', error => {
                reject(error);
            });
        });
    };

    const readList = path =>
        fs.readFile(path, { encoding: 'utf8' })
            .then(text => ({ name: path, text }));

    const writeFile = (path, data) =>
        rulesetDirPromise.then(( ) =>
            fs.writeFile(path, data));

    for ( const ruleset of rulesetConfigs ) {
        const lists = [];

        log('============================');
        log(`Listset for '${ruleset.id}':`);

        if ( Array.isArray(ruleset.paths) ) {
            for ( const path of ruleset.paths ) {
                log(`\t${path}`);
                lists.push(readList(`assets/${path}`));
            }
        }
        if ( Array.isArray(ruleset.urls) ) {
            for ( const url of ruleset.urls ) {
                log(`\t${url}`);
                lists.push(fetchList(url));
            }
        }

        const details = await dnrRulesetFromRawLists(lists, {
            env: [ 'chromium' ],
        });
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

        writeOps.push(
            writeFile(
                `${rulesetDir}/${ruleset.id}.json`,
                `${JSON.stringify(good, replacer, 2)}\n`
            )
        );

        rulesetDetails.push({
            id: ruleset.id,
            name: ruleset.name,
            enabled: ruleset.enabled,
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
                regexes,
            },
        });

        ruleResources.push({
            id: ruleset.id,
            enabled: ruleset.enabled,
            path: `/rulesets/${ruleset.id}.json`
        });

        goodTotalCount += good.length;
        maybeGoodTotalCount += regexes.length;
    }

    writeOps.push(
        writeFile(
            `${rulesetDir}/ruleset-details.js`,
            `export default ${JSON.stringify(rulesetDetails, replacer, 2)};\n`
        )
    );

    await Promise.all(writeOps);

    log(`Total good rules count: ${goodTotalCount}`);
    log(`Total regex rules count: ${maybeGoodTotalCount}`);

    // Patch manifest
    const manifest = await fs.readFile(
        `${outputDir}/manifest.json`,
        { encoding: 'utf8' }
    ).then(text =>
        JSON.parse(text)
    );
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
    await fs.writeFile(`${outputDir}/log.txt`, output.join('\n') + '\n');
}

main();

/******************************************************************************/
