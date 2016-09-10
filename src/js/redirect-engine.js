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
    this.data = '';
};

/******************************************************************************/

RedirectEntry.prototype.toURL = function() {
    if ( this.data.startsWith('data:') === false ) {
        if ( this.mime.indexOf(';') === -1 ) {
            this.data = 'data:' + this.mime + ';base64,' + btoa(this.data);
        } else {
            this.data = 'data:' + this.mime + ',' + this.data;
        }
    }
    return this.data;
};

/******************************************************************************/

RedirectEntry.prototype.toContent = function() {
    if ( this.data.startsWith('data:') ) {
        var pos = this.data.indexOf(',');
        var base64 = this.data.endsWith(';base64', pos);
        this.data = this.data.slice(pos + 1);
        if ( base64 ) {
            this.data = atob(this.data);
        }
    }
    return this.data;
};

/******************************************************************************/

RedirectEntry.fromFields = function(mime, lines) {
    var r = new RedirectEntry();
    r.mime = mime;
    r.data = lines.join(mime.indexOf(';') !== -1 ? '' : '\n');
    return r;
};

/******************************************************************************/

RedirectEntry.fromSelfie = function(selfie) {
    var r = new RedirectEntry();
    r.mime = selfie.mime;
    r.data = selfie.data;
    return r;
};

/******************************************************************************/
/******************************************************************************/

var RedirectEngine = function() {
    this.resources = Object.create(null);
    this.reset();
    this.resourceNameRegister = '';
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
        desEntry, rules, rule, pattern;
    for (;;) {
        desEntry = typeEntry[des];
        if ( desEntry !== undefined ) {
            src = srcHostname;
            for (;;) {
                rules = desEntry[src];
                if ( rules !== undefined ) {
                    for ( rule in rules ) {
                        pattern = rules[rule];
                        if ( pattern instanceof RegExp === false ) {
                            pattern = rules[rule] = new RegExp(pattern, 'i');
                        }
                        if ( pattern.test(reqURL) ) {
                            return (this.resourceNameRegister = rule);
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
        return entry.toURL();
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
    var rules = desEntry[src];
    if ( rules === undefined ) {
        rules = desEntry[src] = Object.create(null);
    }
    var p = rules[redirect];
    if ( p === undefined ) {
        rules[redirect] = pattern;
        return;
    }
    if ( p instanceof RegExp ) {
        p = p.source;
    }
    // Duplicate?
    var pos = p.indexOf(pattern);
    if ( pos !== -1 ) {
        if ( pos === 0 || p.charAt(pos - 1) === '|' ) {
            pos += pattern.length;
            if ( pos === p.length || p.charAt(pos) === '|' ) {
                return;
            }
        }
    }
    rules[redirect] = p + '|' + pattern;
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

    var des = matches[1] || '';
    var pattern = (des + matches[2]).replace(/[.+?{}()|[\]\/\\]/g, '\\$&')
                                    .replace(/\^/g, '[^\\w\\d%-]')
                                    .replace(/\*/g, '.*?');
    var type;
    var redirect = '';
    var srcs = [];
    var options = matches[3].split(','), option;
    while ( (option = options.pop()) ) {
        if ( option.startsWith('redirect=') ) {
            redirect = option.slice(9);
            continue;
        }
        if ( option.startsWith('domain=') ) {
            srcs = option.slice(7).split('|');
            continue;
        }
        if ( option === 'first-party' ) {
            srcs.push(des);
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
    if ( type === undefined || type.startsWith('~') ) {
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
        if ( src.startsWith('~') ) {
            continue;
        }
        out.push(src + '\t' + des + '\t' + type + '\t' + pattern + '\t' + redirect);
    }

    return out;
};

/******************************************************************************/

RedirectEngine.prototype.reFilterParser = /^(?:\|\|([^\/:?#^*]+)|\*)([^$]+)\$([^$]+)$/;

RedirectEngine.prototype.supportedTypes = (function() {
    var types = Object.create(null);
    types.font = 'font';
    types.image = 'image';
    types.media = 'media';
    types.object = 'object';
    types.script = 'script';
    types.stylesheet = 'stylesheet';
    types.subdocument = 'sub_frame';
    types.xmlhttprequest = 'xmlhttprequest';
    return types;
})();

/******************************************************************************/

RedirectEngine.prototype.toSelfie = function() {
    var r = {
        resources: this.resources,
        rules: []
    };

    var typeEntry, desEntry, rules, pattern;
    for ( var type in this.rules ) {
        typeEntry = this.rules[type];
        for ( var des in typeEntry ) {
            desEntry = typeEntry[des];
            for ( var src in desEntry ) {
                rules = desEntry[src];
                for ( var rule in rules ) {
                    pattern = rules[rule];
                    if ( pattern instanceof RegExp ) {
                        pattern = pattern.source;
                    }
                    r.rules.push(
                        src + '\t' +
                        des + '\t' +
                        type + '\t' +
                        pattern + '\t' +
                        rule
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

RedirectEngine.prototype.resourceURIFromName = function(name, mime) {
    var entry = this.resources[name];
    if ( entry && (mime === undefined || entry.mime.startsWith(mime)) ) {
        return entry.toURL();
    }
};

/******************************************************************************/

RedirectEngine.prototype.resourceContentFromName = function(name, mime) {
    var entry = this.resources[name];
    if ( entry && (mime === undefined || entry.mime.startsWith(mime)) ) {
        return entry.toContent();
    }
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

        if ( line.startsWith('#') ) {
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
