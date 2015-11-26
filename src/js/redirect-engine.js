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
    this.resources = Object.create(null);
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
                            return this.resources[entry.r];
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
        return;
    }

    var pattern = (matches[1] + matches[2]).replace(/[.+?{}()|[\]\\]/g, '\\$&')
                                           .replace(/\^/g, '[^\\w\\d%-]')
                                           .replace(/\*/g, '.*?');

    var des = matches[1];
    var type;
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
        // One and only one type must be specified.
        if ( option in this.supportedTypes ) {
            if ( type !== undefined ) {
                return;
            }
            type = this.supportedTypes[option];
            continue;
        }
    }

    // Need a resource token.
    if ( redirect === '' ) {
        return;
    }

    // Need one single type -- not negated.
    if ( type === undefined || type.charAt(0) === '~' ) {
        return;
    }

    if ( des === '' ) {
        des = '*';
    }

    if ( srcs.length === 0 ) {
        srcs.push('*');
    }

    var out = [];
    var i = srcs.length, src;
    while ( i-- ) {
        src = srcs[i];
        if ( src === '' ) {
            continue;
        }
        if ( src.charAt(0) === '~' ) {
            continue;
        }
        // Need at least one specific src or des.
        if ( src === '*' && des === '*' ) {
            continue;
        }
        out.push(src + '\t' + des + '\t' + type + '\t' + pattern + '\t' + redirect);
    }

    return out;
};

/******************************************************************************/

RedirectEngine.prototype.reFilterParser = /^\|\|([^\/?#^*]+)([^$]+)\$([^$]+)$/;

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

RedirectEngine.prototype.resourcesFromString = function(text) {
    var textEnd = text.length;
    var lineBeg = 0, lineEnd;
    var line, fields, encoded;
    var reNonEmptyLine = /\S/;

    var resourceFromFields = function(fields, encoded) {
        var data = fields.slice(2).join(encoded ? '' : '\n');
        this.resources[fields[0]] =
            'data:' +
            fields[1] +
            (encoded ? '' : ';base64') +
            ',' +
            (encoded ? data : btoa(data));
    }.bind(this);

    this.resources = Object.create(null);

    while ( lineBeg < textEnd ) {
        lineEnd = text.indexOf('\n', lineBeg);
        if ( lineEnd < 0 ) {
            lineEnd = text.indexOf('\r', lineBeg);
            if ( lineEnd < 0 ) {
                lineEnd = textEnd;
            }
        }
        line = text.slice(lineBeg, lineEnd);
        lineBeg = lineEnd + 1;

        if ( line.charAt(0) === '#' ) {
            continue;
        }

        if ( fields === undefined ) {
            fields = line.trim().split(/\s+/);
            if ( fields.length === 2 ) {
                encoded = fields[1].indexOf(';') !== -1;
            } else {
                fields = undefined;
            }
            continue;
        }

        if ( reNonEmptyLine.test(line) ) {
            fields.push(encoded ? line.trim() : line);
            continue;
        }

        // No more data, add the resource.
        resourceFromFields(fields, encoded);

        fields = undefined;
    }

    // Process pending resource data.
    if ( fields !== undefined ) {
        resourceFromFields(fields, encoded);
    }
};

/******************************************************************************/

return new RedirectEngine();

/******************************************************************************/

})();
