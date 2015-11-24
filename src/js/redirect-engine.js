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
    this.redirects = Object.create(null);
    this.reset();
};

/******************************************************************************/

RedirectEngine.prototype.reset = function() {
    this.rules = Object.create(null);
};

/******************************************************************************/

RedirectEngine.prototype.freeze = function() {
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

RedirectEngine.prototype.addRule = function(src, des, type, pattern, redirect) {
    var typeEntry = this.rules[type];
    if ( typeEntry === undefined ) {
        typeEntry = this.rules[type] = Object.create(null);
    }
    var desEntry = typeEntry[des];
    if ( desEntry === undefined ) {
        desEntry = typeEntry[des] = Object.create(null);
    }
    var ruleEntries = desEntry[src];
    if ( ruleEntries === undefined ) {
        ruleEntries = desEntry[src] = [];
    }
    ruleEntries.push({
        c: new RegExp(pattern),
        r: redirect
    });
};

/******************************************************************************/

RedirectEngine.prototype.fromCompiledRule = function(line) {
    var fields = line.split('\t');
    if ( fields.length !== 5 ) {
        return;
    }
    this.addRule(fields[0], fields[1], fields[2], fields[3], fields[4]);
};

/******************************************************************************/

RedirectEngine.prototype.compileRuleFromStaticFilter = function(line) {
    var matches = this.reFilterParser.exec(line);
    if ( matches === null || matches.length !== 4 ) {
        return '';
    }

    var pattern = (matches[1] + matches[2]).replace(/[.+?{}()|[\]\\]/g, '\\$&')
                                           .replace(/\^/g, '[^\\w\\d%-]')
                                           .replace(/\*/g, '.*?');

    var des = matches[1];
    var types = [];
    var redirect = '';
    var srcs = [];
    var options = matches[3].split(','), option;
    while ( (option = options.pop()) ) {
        if ( option.lastIndexOf('redirect=', 0) === 0 ) {
            redirect = option.slice(9);
            continue;
        }
        if ( option.lastIndexOf('domain=', 0) === 0 ) {
            srcs = option.slice(7).split('|');
            continue;
        }
        if ( option in this.supportedTypes ) {
            types.push(option);
            continue;
        }
    }

    if ( redirect === '' || types.length === 0 ) {
        return '';
    }

    if ( des === '' ) {
        des = '*';
    }

    if ( srcs.length === 0 ) {
        srcs.push('*');
    }

    var out = [];
    var i = srcs.length, j;
    while ( i-- ) {
        j = types.length;
        while ( j-- ) {
            out.push(srcs[i] + '\t' + des + '\t' + types[j] + '\t' + pattern + '\t' + redirect);
        }
    }

    return out;
};

/******************************************************************************/

RedirectEngine.prototype.reFilterParser = /^\|\|([^\/\?#]+)([^$]+)\$([^$]+)$/;

RedirectEngine.prototype.supportedTypes = (function() {
    var types = Object.create(null);
    types.stylesheet = 'stylesheet';
    types.image = 'image';
    types.object = 'object';
    types.script = 'script';
    types.xmlhttprequest = 'xmlhttprequest';
    types.subdocument = 'sub_frame';
    types.font = 'font';
    return types;
})();

/******************************************************************************/

// TODO: combine same key-redirect pairs into a single regex.

RedirectEngine.prototype.redirectDataFromString = function(text) {
    var textEnd = text.length;
    var lineBeg = 0, lineEnd;
    var mode, modeData, line, fields, encoded, data;

    this.redirects = Object.create(null);

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
    }
};

/******************************************************************************/

return new RedirectEngine();

/******************************************************************************/

})();
