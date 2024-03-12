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
    const folders = [
        'main',
        'modify-headers',
        'redirect',
        'regex',
        'removeparam',
    ];
    const writePromises = [];
    for ( const folder of folders ) {
        const afterFiles = await fs.readdir(`${afterDir}/rulesets/${folder}`);
        for ( const file of afterFiles ) {
            let raw = await fs.readFile(`${beforeDir}/rulesets/${folder}/${file}`, 'utf-8').catch(( ) => '');
            let beforeRules;
            try { beforeRules = JSON.parse(raw); } catch(_) { }
            if ( Array.isArray(beforeRules) === false ) { continue; }
            raw = await fs.readFile(`${afterDir}/rulesets/${folder}/${file}`, 'utf-8').catch(( ) => '');
            let afterRules;
            try { afterRules = JSON.parse(raw); } catch(_) { }
            if ( Array.isArray(afterRules) === false ) { continue; }
            const beforeMap = new Map(beforeRules.map(a => {
                const id = a.id;
                a.id = 0;
                return [ JSON.stringify(a), id ];
            }));
            const reusedIds = new Set();
            for ( const afterRule of afterRules ) {
                afterRule.id = 0;
                const key = JSON.stringify(afterRule);
                const beforeId = beforeMap.get(key);
                if ( beforeId === undefined ) { continue; }
                if ( reusedIds.has(beforeId) ) { continue; }
                afterRule.id = beforeId;
                reusedIds.add(beforeId);
            }
            // Assign new ids to unmatched rules
            let ruleIdGenerator = 1;
            for ( const afterRule of afterRules ) {
                if ( afterRule.id !== 0 ) { continue; }
                while ( reusedIds.has(ruleIdGenerator) ) { ruleIdGenerator += 1; }
                afterRule.id = ruleIdGenerator++;
            }
            afterRules.sort((a, b) => a.id - b.id);
            const indent = afterRules.length > 10 ? undefined : 1;
            const lines = [];
            for ( const afterRule of afterRules ) {
                lines.push(JSON.stringify(afterRule, null, indent));
            }
            const path = `${afterDir}/rulesets/${folder}/${file}`;
            console.log(`    Salvaged ${reusedIds.size} ids in ${folder}/${file}`);
            writePromises.push(
                fs.writeFile(path, `[\n${lines.join(',\n')}\n]\n`)
            );
        }
    }
    await Promise.all(writePromises);
}

main();

/******************************************************************************/
