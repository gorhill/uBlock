/*******************************************************************************

    uBlock - a browser extension to block requests.
    Copyright (C) 2015 Raymond Hill

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

/* global onmessage, postMessage */

'use strict';

/******************************************************************************/

var listEntries = Object.create(null);

/******************************************************************************/

var lookup = function(details) {
    var matches = [];
    var entry, pos;
    for ( var path in listEntries ) {
        entry = listEntries[path];
        if ( entry === undefined ) {
            continue;
        }
        pos = entry.content.indexOf(details.filter);
        if ( pos === -1 ) {
            continue;
        }
        matches.push({
            title: entry.title,
            supportURL: entry.supportURL
        });
    }

    postMessage({
        id: details.id,
        response: {
            filter: details.filter,
            matches: matches
        }
    });
};

/******************************************************************************/

onmessage = function(e) {
    var msg = e.data;

    switch ( msg.what ) {
    case 'resetLists':
        listEntries = Object.create(null);
        break;

    case 'setList':
        listEntries[msg.details.path] = msg.details;
        break;

    case 'reverseLookup':
        lookup(msg);
        break;
    }
};

/******************************************************************************/
