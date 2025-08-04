/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2025-present Raymond Hill

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

import fs from 'fs/promises';
import process from 'process';

/******************************************************************************/

const commandLineArgs = (( ) => {
    const args = Object.create(null);
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
        args[name] = value;
    }
    return args;
})();

/******************************************************************************/

// Apple store rejects when description (extShortDesc) is longer than 112
// characters.

async function fixLongDescription(path) {
    let text = await fs.readFile(path, { encoding: 'utf8' });
    const messages = JSON.parse(text);
    let message = messages.extShortDesc.message;
    if ( message.length <= 112 ) { return; }
    const pos = message.indexOf('.');
    if ( pos !== -1 ) {
        message = message.slice(0, pos+1);
    }
    if ( message.length >= 112 ) {
        message = `${message.slice(0, 111)}…`;
    }
    messages.extShortDesc.message = message;
    text = JSON.stringify(messages, null, 2);
    await fs.writeFile(path, text);
}

async function fixLongDescriptions() {
    const promises = [];
    const packageDir = commandLineArgs.packageDir;
    const entries = await fs.readdir(`${packageDir}/_locales/`, { withFileTypes: true });
    for ( const entry of entries ) {
        if ( entry.isDirectory() === false ) { continue; }
        promises.push(fixLongDescription(`${packageDir}/_locales/${entry.name}/messages.json`));
    }
    return Promise.all(promises);
}

/******************************************************************************/

// Apple store rejects when version has four components.

async function fixManifest() {
    const packageDir = commandLineArgs.packageDir;
    const path = `${packageDir}/manifest.json`;
    let text = await fs.readFile(path, { encoding: 'utf8' });
    const manifest = JSON.parse(text);
    const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(manifest.version);
    if ( match === null ) { return; }
    const month = parseInt(match[2], 10);
    const dayofmonth = parseInt(match[3], 10);
    const monthday /* sort of */ = month * 100 + dayofmonth;
    manifest.version = `${match[1]}.${monthday}.${match[4]}`;
    text = JSON.stringify(manifest, null, 2);
    await fs.writeFile(path, text);
}

/******************************************************************************/

async function main() {
    await Promise.all([
        fixLongDescriptions(),
        fixManifest(),
    ]);
}

main();

/******************************************************************************/
