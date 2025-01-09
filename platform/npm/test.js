/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2014-present Raymond Hill

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

/* globals process */

import { promisify } from 'util';
import { spawn } from "child_process";

/******************************************************************************/

async function spawnMocha() {
    const files = [
        'tests/wasm.js',
        'tests/snfe.js',
    ];

    const options = [];

    if ( process.argv[3] === '--full-battery' ) {
        files.push('tests/request-data.js');

        options.push('--reporter', 'progress');
    }

    await promisify(spawn)('mocha', [ '--experimental-vm-modules', '--no-warnings', ...files, ...options ], { stdio: [ 'inherit', 'inherit', 'inherit' ] });
}

async function main() {
    if ( process.argv[2] === '--mocha' ) {
        await spawnMocha();
    }
}

main();

/******************************************************************************/
