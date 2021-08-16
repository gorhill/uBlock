/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
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

/* eslint-disable-next-line no-redeclare */
/* globals process */

'use strict';

/******************************************************************************/

import { spawn } from "child_process";
import { promisify } from 'util';

/******************************************************************************/

async function spawnMocha() {
    await promisify(spawn)('mocha', [ '--experimental-vm-modules', '--no-warnings', 'tests', '--reporter', 'progress' ], { stdio: [ 'inherit', 'inherit', 'inherit' ] });
}

async function main() {
    if ( process.argv[2] === '--mocha' ) {
        await spawnMocha();
    }
}

main();

/******************************************************************************/
