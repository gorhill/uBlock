/*******************************************************************************

    uBlock - a browser extension to black/white list requests.
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

// The purpose of log filtering is to create ad hoc filtering rules, to
// diagnose and assist in the creation of custom filters.

µBlock.URLNetFiltering = (function() {

'use strict';

/*******************************************************************************

buckets: map of [origin + urlkey + type]
     bucket: array of rule entry, sorted from shorter to longer url

rule entry: { url, action }


*******************************************************************************/

/******************************************************************************/

var actionToNameMap = {
    1: 'block',
    2: 'allow',
    3: 'noop'
};

var nameToActionMap = {
    'block': 1,
    'allow': 2,
     'noop': 3
};

/******************************************************************************/

var RuleEntry = function(url, action) {
    this.url = url;
    this.action = action;
};

/******************************************************************************/

var indexOfURL = function(urls, url) {
    // TODO: binary search -- maybe, depends on common use cases
    var urlLen = url.length;
    var entry;
    // urls must be ordered by increasing length.
    for ( var i = 0; i< urls.length; i++ ) {
        entry = urls[i];
        if ( entry.url.length > urlLen ) {
            break;
        }
        if ( entry.url === url ) {
            return i;
        }
    }
    return -1;
};

/******************************************************************************/

var indexOfMatch = function(urls, url) {
    // TODO: binary search -- maybe, depends on common use cases
    var urlLen = url.length;
    var i = urls.length;
    var entry;
    while ( i-- ) {
        entry = urls[i];
        if ( entry.url.length > urlLen ) {
            continue;
        }
        if ( url.startsWith(entry.url) ) {
            return i;
        }
    }
    return -1;
};

/******************************************************************************/

var indexFromLength = function(urls, len) {
    // TODO: binary search -- maybe, depends on common use cases
    // urls must be ordered by increasing length.
    for ( var i = 0; i< urls.length; i++ ) {
        if ( urls[i].url.length > len ) {
            return i;
        }
    }
    return -1;
};

/******************************************************************************/

var addRuleEntry = function(urls, url, action) {
    var entry = new RuleEntry(url, action);
    var i = indexFromLength(urls, url.length);
    if ( i === -1 ) {
        urls.push(entry);
    } else {
        urls.splice(i, 0, entry);
    }
};

/******************************************************************************/

var urlKeyFromURL = function(url) {
    // Experimental: running benchmarks first
    //if ( url === '*' ) {
    //    return url;
    //}
    var match = reURLKey.exec(url);
    return match !== null ? match[0] : '';
};

var reURLKey = /^[a-z]+:\/\/[^\/?#]+/;

/******************************************************************************/

var URLNetFiltering = function() {
    this.reset();
};

/******************************************************************************/

// rules:
//   origin + urlkey + type => urls
//     urls = collection of urls to match

URLNetFiltering.prototype.reset = function() {
    this.rules = Object.create(null);
    // registers, filled with result of last evaluation
    this.context = '';
    this.url = '';
    this.type = '';
    this.r = 0;
};

/******************************************************************************/

URLNetFiltering.prototype.assign = function(other) {
    var thisRules = this.rules;
    var otherRules = other.rules;
    var k;

    // Remove rules not in other
    for ( k in thisRules ) {
        if ( otherRules[k] === undefined ) {
            delete thisRules[k];
        }
    }

    // Add/change rules in other
    for ( k in otherRules ) {
        thisRules[k] = otherRules[k].slice();
    }
};

/******************************************************************************/

URLNetFiltering.prototype.setRule = function(srcHostname, url, type, action) {
    if ( action === 0 ) {
        return this.removeRule(srcHostname, url, type);
    }

    var urlKey = urlKeyFromURL(url);
    if ( urlKey === '' ) {
        return false;
    }

    var bucketKey = srcHostname + ' ' + urlKey + ' ' + type;
    var urls = this.rules[bucketKey];
    if ( urls === undefined ) {
        urls = this.rules[bucketKey] = [];
    }

    var entry;
    var i = indexOfURL(urls, url);
    if ( i !== -1 ) {
        entry = urls[i];
        if ( entry.action === action ) {
            return false;
        }
        entry.action = action;
        return true;
    }

    addRuleEntry(urls, url, action);
    return true;
};

/******************************************************************************/

URLNetFiltering.prototype.removeRule = function(srcHostname, url, type) {
    var urlKey = urlKeyFromURL(url);
    if ( urlKey === '' ) {
        return false;
    }

    var bucketKey = srcHostname + ' ' + urlKey + ' ' + type;
    var urls = this.rules[bucketKey];
    if ( urls === undefined ) {
        return false;
    }

    var i = indexOfURL(urls, url);
    if ( i === -1 ) {
        return false;
    }

    urls.splice(i, 1);
    if ( urls.length === 0 ) {
        delete this.rules[bucketKey];
    }

    return true;
};

/******************************************************************************/

URLNetFiltering.prototype.evaluateZ = function(context, target, type) {
    var urlKey = urlKeyFromURL(target);
    if ( urlKey === '' ) {
        this.r = 0;
        return this;
    }

    var urls, pos, i, entry, keyShard;

    for (;;) {
        this.context = context;
        keyShard = context + ' ' + urlKey;
        if ( (urls = this.rules[keyShard + ' ' + type]) ) {
            i = indexOfMatch(urls, target);
            if ( i !== -1 ) {
                entry = urls[i];
                this.url = entry.url;
                this.type = type;
                this.r = entry.action;
                return this;
            }
        }
        if ( (urls = this.rules[keyShard + ' *']) ) {
            i = indexOfMatch(urls, target);
            if ( i !== -1 ) {
                entry = urls[i];
                this.url = entry.url;
                this.type = '*';
                this.r = entry.action;
                return this;
            }
        }
        /* Experimental: running benchmarks first
        if ( urls = this.rules[context + ' * ' + type] ) {
            entry = urls[0];
            this.url = '*';
            this.type = type;
            this.r = entry.action;
            return this;
        }
        if ( urls = this.rules[context + ' * *'] ) {
            entry = urls[0];
            this.url = this.type = '*';
            this.r = entry.action;
            return this;
        }
        */
        if ( context === '*' ) {
            break;
        }
        pos = context.indexOf('.');
        context = pos !== -1 ? context.slice(pos + 1) : '*';
    }

    this.r = 0;
    return this;
};

/******************************************************************************/

URLNetFiltering.prototype.mustBlockOrAllow = function() {
    return this.r === 1 || this.r === 2;
};

/******************************************************************************/

URLNetFiltering.prototype.toFilterString = function() {
    if ( this.r === 0 ) {
        return '';
    }
    var body = this.context + ' ' + this.url + ' ' + this.type;
    if ( this.r === 1 ) {
        return 'lb:' + body + ' block';
    }
    if ( this.r === 2 ) {
        return 'la:' + body + ' allow';
    }
    /* this.r === 3 */
    return 'ln:' + body + ' noop';
};

/******************************************************************************/

URLNetFiltering.prototype.copyRules = function(other, context, urls, type) {
    var changed = false;
    var url, otherOwn, thisOwn;
    var i = urls.length;
    while ( i-- ) {
        url = urls[i];
        other.evaluateZ(context, url, type);
        otherOwn = other.context === context && other.url === url && other.type === type;
        this.evaluateZ(context, url, type);
        thisOwn = this.context === context && this.url === url && this.type === type;
        if ( otherOwn && !thisOwn ) {
            this.setRule(context, url, type, other.r);
            changed = true;
        }
        if ( !otherOwn && thisOwn ) {
            this.removeRule(context, url, type);
            changed = true;
        }
    }
    return changed;
};

/******************************************************************************/

// "url-filtering:" hostname url type action

URLNetFiltering.prototype.toString = function() {
    var out = [];
    var pos, hn, type, urls, i, entry;
    for ( var bucketKey in this.rules ) {
        pos = bucketKey.indexOf(' ');
        hn = bucketKey.slice(0, pos);
        pos = bucketKey.lastIndexOf(' ');
        type = bucketKey.slice(pos + 1);
        urls = this.rules[bucketKey];
        for ( i = 0; i < urls.length; i++ ) {
            entry = urls[i];
            out.push(
                hn + ' ' +
                entry.url + ' ' +
                type + ' ' +
                actionToNameMap[entry.action]
            );
        }
    }
    return out.sort().join('\n');
};

/******************************************************************************/

URLNetFiltering.prototype.fromString = function(text) {
    var textEnd = text.length;
    var lineBeg = 0, lineEnd;
    var line, fields;

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

        if ( line === '' ) {
            continue;
        }

        // Coarse test
        if ( line.indexOf('://') === -1 ) {
            continue;
        }

        fields = line.split(/\s+/);
        if ( fields.length !== 4 ) {
            continue;
        }

        // Finer test
        if ( fields[1].indexOf('://') === -1 ) {
            continue;
        }

        if ( nameToActionMap.hasOwnProperty(fields[3]) === false ) {
            continue;
        }

        this.setRule(fields[0], fields[1], fields[2], nameToActionMap[fields[3]]);
    }
};

/******************************************************************************/

return URLNetFiltering;

/******************************************************************************/

})();

/******************************************************************************/

µBlock.sessionURLFiltering = new µBlock.URLNetFiltering();
µBlock.permanentURLFiltering = new µBlock.URLNetFiltering();

/******************************************************************************/
