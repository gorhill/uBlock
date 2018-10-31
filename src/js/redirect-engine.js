/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-present Raymond Hill

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

µBlock.redirectEngine = (function(){

/******************************************************************************/
/******************************************************************************/

const warResolve = (function() {
    var warPairs = [];

    var onPairsReady = function() {
        var reng = µBlock.redirectEngine;
        for ( var i = 0; i < warPairs.length; i += 2 ) {
            var resource = reng.resources.get(warPairs[i+0]);
            if ( resource === undefined ) { continue; }
            resource.warURL = vAPI.getURL(
                '/web_accessible_resources/' + warPairs[i+1]
            );
        }
        reng.selfieFromResources();
    };

    return function() {
        if ( vAPI.warSecret === undefined || warPairs.length !== 0 ) {
            return onPairsReady();
        }

        var onPairsLoaded = function(details) {
            var marker = '>>>>>';
            var pos = details.content.indexOf(marker);
            if ( pos === -1 ) { return; }
            var pairs = details.content.slice(pos + marker.length)
                                      .trim()
                                      .split('\n');
            if ( (pairs.length & 1) !== 0 ) { return; }
            for ( var i = 0; i < pairs.length; i++ ) {
                pairs[i] = pairs[i].trim();
            }
            warPairs = pairs;
            onPairsReady();
        };

        µBlock.assets.fetchText(
            '/web_accessible_resources/imported.txt?secret=' + vAPI.warSecret,
            onPairsLoaded
        );
    };
})();

// https://github.com/gorhill/uBlock/issues/3639
// https://github.com/EFForg/https-everywhere/issues/14961
// https://bugs.chromium.org/p/chromium/issues/detail?id=111700
//   Do not redirect to a WAR if the platform suffers from spurious redirect
//   conflicts, and the request to redirect is not `https:`.
//   This special handling code can removed once the Chromium issue is fixed.
const suffersSpuriousRedirectConflicts = vAPI.webextFlavor.soup.has('chromium');

/******************************************************************************/
/******************************************************************************/

const RedirectEntry = function() {
    this.mime = '';
    this.data = '';
    this.warURL = undefined;
};

/******************************************************************************/

// Prevent redirection to web accessible resources when the request is
// of type 'xmlhttprequest', because XMLHttpRequest.responseURL would
// cause leakage of extension id. See:
// - https://stackoverflow.com/a/8056313
// - https://bugzilla.mozilla.org/show_bug.cgi?id=998076

RedirectEntry.prototype.toURL = function(details) {
    if (
        this.warURL !== undefined &&
        details instanceof Object &&
        details.requestType !== 'xmlhttprequest' &&
        (
            suffersSpuriousRedirectConflicts === false ||
            details.requestURL.startsWith('https:')
        )
    ) {
        return this.warURL + '?secret=' + vAPI.warSecret;
    }
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
    r.warURL = selfie.warURL;
    return r;
};

/******************************************************************************/
/******************************************************************************/

const RedirectEngine = function() {
    this.resources = new Map();
    this.reset();
    this.resourceNameRegister = '';
    this._desAll = []; // re-use better than re-allocate
};

/******************************************************************************/

RedirectEngine.prototype.reset = function() {
    this.rules = new Map();
    this.ruleTypes = new Set();
    this.ruleSources = new Set();
    this.ruleDestinations = new Set();
    this.modifyTime = Date.now();
};

/******************************************************************************/

RedirectEngine.prototype.freeze = function() {
};

/******************************************************************************/

RedirectEngine.prototype.toBroaderHostname = function(hostname) {
    var pos = hostname.indexOf('.');
    if ( pos !== -1 ) {
        return hostname.slice(pos + 1);
    }
    return hostname !== '*' ? '*' : '';
};

/******************************************************************************/

RedirectEngine.prototype.lookup = function(context) {
    var type = context.requestType;
    if ( this.ruleTypes.has(type) === false ) { return; }
    var src = context.pageHostname,
        des = context.requestHostname,
        desAll = this._desAll,
        reqURL = context.requestURL;
    var n = 0;
    for (;;) {
        if ( this.ruleDestinations.has(des) ) {
            desAll[n] = des; n += 1;
        }
        des = this.toBroaderHostname(des);
        if ( des === '' ) { break; }
    }
    if ( n === 0 ) { return; }
    var entries;
    for (;;) {
        if ( this.ruleSources.has(src) ) {
            for ( var i = 0; i < n; i++ ) {
                entries = this.rules.get(src + ' ' + desAll[i] + ' ' + type);
                if ( entries && this.lookupToken(entries, reqURL) ) {
                    return this.resourceNameRegister;
                }
            }
        }
        src = this.toBroaderHostname(src);
        if ( src === '' ) { break; }
    }
};

RedirectEngine.prototype.lookupToken = function(entries, reqURL) {
    let j = entries.length;
    while ( j-- ) {
        let entry = entries[j];
        if ( entry.pat instanceof RegExp === false ) {
            entry.pat = new RegExp(entry.pat, 'i');
        }
        if ( entry.pat.test(reqURL) ) {
            this.resourceNameRegister = entry.tok;
            return true;
        }
    }
};

/******************************************************************************/

RedirectEngine.prototype.toURL = function(context) {
    let token = this.lookup(context);
    if ( token === undefined ) { return; }
    let entry = this.resources.get(token);
    if ( entry !== undefined ) {
        return entry.toURL(context);
    }
};

/******************************************************************************/

RedirectEngine.prototype.matches = function(context) {
    var token = this.lookup(context);
    return token !== undefined && this.resources.has(token);
};

/******************************************************************************/

RedirectEngine.prototype.addRule = function(src, des, type, pattern, redirect) {
    this.ruleSources.add(src);
    this.ruleDestinations.add(des);
    this.ruleTypes.add(type);
    var key = src + ' ' + des + ' ' + type,
        entries = this.rules.get(key);
    if ( entries === undefined ) {
        this.rules.set(key, [ { tok: redirect, pat: pattern } ]);
        this.modifyTime = Date.now();
        return;
    }
    var entry;
    for ( var i = 0, n = entries.length; i < n; i++ ) {
        entry = entries[i];
        if ( redirect === entry.tok ) { break; }
    }
    if ( i === n ) {
        entries.push({ tok: redirect, pat: pattern });
        return;
    }
    var p = entry.pat;
    if ( p instanceof RegExp ) {
        p = p.source;
    }
    // Duplicate?
    var pos = p.indexOf(pattern);
    if ( pos !== -1 ) {
        if ( pos === 0 || p.charAt(pos - 1) === '|' ) {
            pos += pattern.length;
            if ( pos === p.length || p.charAt(pos) === '|' ) { return; }
        }
    }
    entry.pat = p + '|' + pattern;
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
    var µburi = µBlock.URI,
        des = matches[1] || '',
        pattern = (des + matches[2]).replace(/[.+?{}()|[\]\/\\]/g, '\\$&')
                                    .replace(/\^/g, '[^\\w.%-]')
                                    .replace(/\*/g, '.*?'),
        type,
        redirect = '',
        srcs = [],
        options = matches[3].split(','), option;
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
            srcs.push(µburi.domainFromHostname(des) || des);
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
    // Because rules may contains RegExp instances, we need to manually
    // convert it to a serializable format. The serialized format must be
    // suitable to be used as an argument to the Map() constructor.
    var rules = [],
        rule, entries, i, entry;
    for ( var item of this.rules ) {
        rule = [ item[0], [] ];
        entries = item[1];
        i = entries.length;
        while ( i-- ) {
            entry = entries[i];
            rule[1].push({
                tok: entry.tok,
                pat: entry.pat instanceof RegExp ? entry.pat.source : entry.pat
            });
        }
        rules.push(rule);
    }
    return {
        rules: rules,
        ruleTypes: Array.from(this.ruleTypes),
        ruleSources: Array.from(this.ruleSources),
        ruleDestinations: Array.from(this.ruleDestinations)
    };
};

/******************************************************************************/

RedirectEngine.prototype.fromSelfie = function(selfie) {
    this.rules = new Map(selfie.rules);
    this.ruleTypes = new Set(selfie.ruleTypes);
    this.ruleSources = new Set(selfie.ruleSources);
    this.ruleDestinations = new Set(selfie.ruleDestinations);
    this.modifyTime = Date.now();
    return true;
};

/******************************************************************************/

RedirectEngine.prototype.resourceURIFromName = function(name, mime) {
    var entry = this.resources.get(name);
    if ( entry && (mime === undefined || entry.mime.startsWith(mime)) ) {
        return entry.toURL();
    }
};

/******************************************************************************/

RedirectEngine.prototype.resourceContentFromName = function(name, mime) {
    var entry;
    for (;;) {
        entry = this.resources.get(name);
        if ( entry === undefined ) { return; }
        if ( entry.mime.startsWith('alias/') === false ) {
            break;
        }
        name = entry.mime.slice(6);
    }
    if ( mime === undefined || entry.mime.startsWith(mime) ) {
        return entry.toContent();
    }
};

/******************************************************************************/

// TODO: combine same key-redirect pairs into a single regex.

// https://github.com/uBlockOrigin/uAssets/commit/deefe875551197d655f79cb540e62dfc17c95f42
//   Consider 'none' a reserved keyword, to be used to disable redirection.

RedirectEngine.prototype.resourcesFromString = function(text) {
    let fields, encoded,
        reNonEmptyLine = /\S/,
        lineIter = new µBlock.LineIterator(text);

    this.resources = new Map();

    while ( lineIter.eot() === false ) {
        let line = lineIter.next();
        if ( line.startsWith('#') ) { continue; }

        if ( fields === undefined ) {
            let head = line.trim().split(/\s+/);
            if ( head.length !== 2 ) { continue; }
            if ( head[0] === 'none' ) { continue; }
            encoded = head[1].indexOf(';') !== -1;
            fields = head;
            continue;
        }

        if ( reNonEmptyLine.test(line) ) {
            fields.push(encoded ? line.trim() : line);
            continue;
        }

        // No more data, add the resource.
        this.resources.set(
            fields[0],
            RedirectEntry.fromFields(fields[1], fields.slice(2))
        );

        fields = undefined;
    }

    // Process pending resource data.
    if ( fields !== undefined ) {
        this.resources.set(
            fields[0],
            RedirectEntry.fromFields(fields[1], fields.slice(2))
        );
    }

    warResolve();

    this.modifyTime = Date.now();
};

/******************************************************************************/

let resourcesSelfieVersion = 3;

RedirectEngine.prototype.selfieFromResources = function() {
    let selfie = {
        version: resourcesSelfieVersion,
        resources: Array.from(this.resources)
    };
    µBlock.cacheStorage.set({ resourcesSelfie: JSON.stringify(selfie) });
};

RedirectEngine.prototype.resourcesFromSelfie = function(callback) {
    µBlock.cacheStorage.get('resourcesSelfie', bin => {
        let selfie = bin && bin.resourcesSelfie;
        if ( typeof selfie === 'string' ) {
            try {
                selfie = JSON.parse(selfie);
            } catch(ex) {
            }
        }
        if (
            selfie instanceof Object === false ||
            selfie.version !== resourcesSelfieVersion ||
            Array.isArray(selfie.resources) === false
        ) {
            return callback(false);
        }
        this.resources = new Map();
        for ( let entry of selfie.resources ) {
            this.resources.set(entry[0], RedirectEntry.fromSelfie(entry[1]));
        }
        callback(true);
    });
};

RedirectEngine.prototype.invalidateResourcesSelfie = function() {
    µBlock.cacheStorage.remove('resourcesSelfie');
};

/******************************************************************************/
/******************************************************************************/

return new RedirectEngine();

/******************************************************************************/

})();
