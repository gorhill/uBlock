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
/******************************************************************************/

var RedirectEntry = function() {
    this.mime = '';
    this.encoded = false;
    this.ph = false;
    this.data = '';
};

/******************************************************************************/

RedirectEntry.rePlaceHolders = /\{\{.+?\}\}/;
RedirectEntry.reRequestURL = /\{\{requestURL\}\}/g;

/******************************************************************************/

RedirectEntry.prototype.toURL = function(requestURL) {
    if ( this.ph === false ) {
        return this.data;
    }
    return 'data:' +
           this.mime + ';base64,' +
           btoa(this.data.replace(RedirectEntry.reRequestURL, requestURL));
};

/******************************************************************************/

RedirectEntry.fromFields = function(mime, lines) {
    var r = new RedirectEntry();

    r.mime = mime;
    r.encoded = mime.indexOf(';') !== -1;
    var data = lines.join(r.encoded ? '' : '\n');
    // check for placeholders.
    r.ph = r.encoded === false && RedirectEntry.rePlaceHolders.test(data);
    if ( r.ph ) {
        r.data = data;
    } else {
        r.data = 
            'data:' +
            mime +
            (r.encoded ? '' : ';base64') +
            ',' +
            (r.encoded ? data : btoa(data));
    }

    return r;
};

/******************************************************************************/

RedirectEntry.fromSelfie = function(selfie) {
    var r = new RedirectEntry();

    r.mime = selfie.mime;
    r.encoded = selfie.encoded;
    r.ph = selfie.ph;
    r.data = selfie.data;

    return r;
};

/******************************************************************************/
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
                            return entry.r;
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

RedirectEngine.prototype.toURL = function(context) {
    var token = this.lookup(context);
    if ( token === undefined ) {
        return;
    }
    var entry = this.resources[token];
    if ( entry !== undefined ) {
        return entry.toURL(context.requestURL);
    }
};

/******************************************************************************/

RedirectEngine.prototype.matches = function(context) {
    var token = this.lookup(context);
    return token !== undefined && this.resources[token] !== undefined;
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

RedirectEngine.prototype.toSelfie = function() {
    var r = {
        resources: this.resources,
        rules: []
    };

    var typeEntry, desEntry, entries, entry;
    for ( var type in this.rules ) {
        typeEntry = this.rules[type];
        for ( var des in typeEntry ) {
            desEntry = typeEntry[des];
            for ( var src in desEntry ) {
                entries = desEntry[src];
                for ( var i = 0; i < entries.length; i++ ) {
                    entry = entries[i];
                    r.rules.push(
                        src + '\t' +
                        des + '\t' +
                        type + '\t' +
                        entry.c.source + '\t' +
                        entry.r
                    );
                }
            }
        }
    }

    return r;
};

/******************************************************************************/

RedirectEngine.prototype.fromSelfie = function(selfie) {
    // Resources.
    var resources = selfie.resources;
    for ( var token in resources ) {
        if ( resources.hasOwnProperty(token) === false ) {
            continue;
        }
        this.resources[token] = RedirectEntry.fromSelfie(resources[token]);
    }

    // Rules.
    var rules = selfie.rules;
    var i = rules.length;
    while ( i-- ) {
        this.fromCompiledRule(rules[i]);
    }

    return true;
};

/******************************************************************************/

// TODO: combine same key-redirect pairs into a single regex.

RedirectEngine.prototype.resourcesFromString = function(text) {
    var textEnd = text.length;
    var lineBeg = 0, lineEnd;
    var line, fields, encoded;
    var reNonEmptyLine = /\S/;

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
        this.resources[fields[0]] = RedirectEntry.fromFields(fields[1], fields.slice(2));

        fields = undefined;
    }

    // Process pending resource data.
    if ( fields !== undefined ) {
        this.resources[fields[0]] = RedirectEntry.fromFields(fields[1], fields.slice(2));
    }
};

/******************************************************************************/
/******************************************************************************/

return new RedirectEngine();

/******************************************************************************/

})();
