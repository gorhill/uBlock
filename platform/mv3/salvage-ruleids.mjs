/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2024-present Raymond Hill

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
import process from 'process';

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

const beforeDir = commandLineArgs.get('before') || '';
const afterDir = commandLineArgs.get('after') || '';

if ( beforeDir === '' || afterDir === '' ) {
    process.exit(0);
}

/******************************************************************************/

async function main() {
    const afterFiles = await fs.readdir(`${afterDir}/rulesets/main`);
    const writePromises = [];
    for ( const file of afterFiles ) {
        let raw = await fs.readFile(`${beforeDir}/rulesets/main/${file}`, 'utf-8').catch(( ) => '');
        let beforeRules;
        try { beforeRules = JSON.parse(raw); } catch(_) { }
        if ( Array.isArray(beforeRules) === false ) { continue; }
        raw = await fs.readFile(`${afterDir}/rulesets/main/${file}`, 'utf-8').catch(( ) => '');
        let afterRules;
        try { afterRules = JSON.parse(raw); } catch(_) { }
        if ( Array.isArray(afterRules) === false ) { continue; }
        const beforeMap = new Map(beforeRules.map(a => {
            const id = a.id;
            a.id = 0;
            return [ JSON.stringify(a), id ];
        }));
        const usedIds = new Set();
        for ( const afterRule of afterRules ) {
            afterRule.id = 0;
            const key = JSON.stringify(afterRule);
            const beforeId = beforeMap.get(key);
            if ( beforeId === undefined ) { continue; }
            if ( usedIds.has(beforeId) ) { continue; }
            afterRule.id = beforeId;
            usedIds.add(beforeId);
        }
        // Assign new ids to unmatched rules
        let ruleIdGenerator = 1;
        for ( const afterRule of afterRules ) {
            if ( afterRule.id !== 0 ) { continue; }
            while ( usedIds.has(ruleIdGenerator) ) { ruleIdGenerator += 1; }
            afterRule.id = ruleIdGenerator++;
        }
        afterRules.sort((a, b) => a.id - b.id);
        const lines = [];
        for ( const afterRule of afterRules ) {
            lines.push(JSON.stringify(afterRule));
        }
        writePromises.push(
            fs.writeFile(
                `${afterDir}/rulesets/main/${file}`,
                `[\n${lines.join(',\n')}\n]\n`
            )
        );
    }
    await Promise.all(writePromises);
}

main();

/******************************************************************************/
