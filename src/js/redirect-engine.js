/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
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

/* global µBlock */

/******************************************************************************/

µBlock.redirectEngine = (function(){

'use strict';

/******************************************************************************/

var toBroaderHostname = function(hostname) {
    var pos = hostname.indexOf('.');
    if ( pos !== -1 ) {
        return hostname.slice(pos + 1);
    }
    return hostname !== '*' && hostname !== '' ? '*' : '';
};

/******************************************************************************/

var RedirectEngine = function() {
    this.reset();
};

/******************************************************************************/

RedirectEngine.prototype.reset = function() {
    this.redirects = Object.create(null);
    this.rules = Object.create(null);
};

/******************************************************************************/

RedirectEngine.prototype.lookup = function(context) {
    var typeEntry = this.rules[context.requestType];
    if ( typeEntry === undefined ) {
        return;
    }
    var src, des = context.requestHostname,
        srcHostname = context.pageHostname,
        reqURL = context.requestURL,
        desEntry, entries, i, entry;
    for (;;) {
        desEntry = typeEntry[des];
        if ( desEntry !== undefined ) {
            src = srcHostname;
            for (;;) {
                entries = desEntry[src];
                if ( entries !== undefined ) {
                    i = entries.length;
                    while ( i-- ) {
                        entry = entries[i];
                        if ( entry.c.test(reqURL) ) {
                            return this.redirects[entry.r];
                        }
                    }
                }
                src = toBroaderHostname(src);
                if ( src === '' ) {
                    break;
                }
            }
        }
        des = toBroaderHostname(des);
        if ( des === '' ) {
            break;
        }
    }
};

/******************************************************************************/

// TODO: combine same key-redirect pairs into a single regex.

RedirectEngine.prototype.fromString = function(text) {
    var textEnd = text.length;
    var lineBeg = 0, lineEnd;
    var mode, modeData, line, fields, encoded, data;
    var reSource, typeEntry, desEntry, ruleEntries;

    this.reset();

    while ( lineBeg < textEnd ) {
        lineEnd = text.indexOf('\n', lineBeg);
        if ( lineEnd < 0 ) {
            lineEnd = text.indexOf('\r', lineBeg);
            if ( lineEnd < 0 ) {
                lineEnd = textEnd;
            }
        }
        line = text.slice(lineBeg, lineEnd).trim();
        lineBeg = lineEnd + 1;

        if ( line.charAt(0) === '#' ) {
            continue;
        }

        if ( line.slice(-1) === ':' ) {
            mode = line.slice(0, -1);
            continue;
        }

        if ( mode === 'redirects' ) {
            fields = line.split(/\s+/);
            if ( fields.length !== 2 ) {
                continue;
            }
            mode = 'redirects/redirect';
            modeData = fields;
            continue;
        }

        if ( mode === 'redirects/redirect' ) {
            if ( line !== '' ) {
                modeData.push(line);
                continue;
            }
            encoded = modeData[1].indexOf(';') !== -1;
            data = modeData.slice(2).join(encoded ? '' : '\n');
            this.redirects[modeData[0]] =
                'data:' +
                modeData[1] + 
                (encoded ? '' : ';base64') +
                ',' +
                (encoded ? data : btoa(data));
            mode = 'redirects';
            continue;
        }

        if ( mode === 'rules' ) {
            fields = line.split(/\s+/);
            if ( fields.length !== 5 ) {
                continue;
            }
            reSource = fields[3];
            if ( reSource.charAt(0) !== '/' || reSource.slice(-1) !== '/' ) {
                reSource = reSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            } else {
                reSource = reSource.slice(1, -1);
            }
            typeEntry = this.rules[fields[2]];
            if ( typeEntry === undefined ) {
                typeEntry = this.rules[fields[2]] = Object.create(null);
            }
            desEntry = typeEntry[fields[1]];
            if ( desEntry === undefined ) {
                desEntry = typeEntry[fields[1]] = Object.create(null);
            }
            ruleEntries = desEntry[fields[0]];
            if ( ruleEntries === undefined ) {
                ruleEntries = desEntry[fields[0]] = [];
            }
            ruleEntries.push({
                c: new RegExp(reSource),
                r: fields[4]
            });
            continue;
        }
    }
};

/******************************************************************************/

return new RedirectEngine();

/******************************************************************************/

})();
