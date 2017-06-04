/*******************************************************************************

    uBlock Origin - a browser extension to black/white list requests.
    Copyright (C) 2015-2017 Raymond Hill

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

// The purpose of log filtering is to create ad hoc filtering rules, to
// diagnose and assist in the creation of custom filters.

µBlock.URLNetFiltering = (function() {

/*******************************************************************************

buckets: map of [hostname + type]
     bucket: array of rule entries, sorted from shorter to longer url
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

var indexOfURL = function(entries, url) {
    // TODO: binary search -- maybe, depends on common use cases
    var urlLen = url.length,
        entry;
    // URLs must be ordered by increasing length.
    for ( var i = 0; i < entries.length; i++ ) {
        entry = entries[i];
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

var indexOfMatch = function(entries, url) {
    var urlLen = url.length,
        i = entries.length;
    while ( i-- ) {
        if ( entries[i].url.length <= urlLen ) {
            break;
        }
    }
    if ( i !== -1 ) {
        do {
            if ( url.startsWith(entries[i].url) ) {
                return i;
            }
        } while ( i-- );
    }
    return -1;
};

/******************************************************************************/

var indexFromLength = function(entries, len) {
    // TODO: binary search -- maybe, depends on common use cases
    // URLs must be ordered by increasing length.
    for ( var i = 0; i < entries.length; i++ ) {
        if ( entries[i].url.length > len ) {
            return i;
        }
    }
    return -1;
};

/******************************************************************************/

var addRuleEntry = function(entries, url, action) {
    var entry = new RuleEntry(url, action),
        i = indexFromLength(entries, url.length);
    if ( i === -1 ) {
        entries.push(entry);
    } else {
        entries.splice(i, 0, entry);
    }
};

/******************************************************************************/

var URLNetFiltering = function() {
    this.reset();
};

/******************************************************************************/

URLNetFiltering.prototype.reset = function() {
    this.rules = new Map();
    // registers, filled with result of last evaluation
    this.context = '';
    this.url = '';
    this.type = '';
    this.r = 0;
};

/******************************************************************************/

URLNetFiltering.prototype.assign = function(other) {
    var thisRules = this.rules,
        otherRules = other.rules;
    // Remove rules not in other
    for ( var key of thisRules.keys() ) {
        if ( otherRules.has(key) === false ) {
            thisRules.delete(key);
        }
    }
    // Add/change rules in other
    for ( var entry of otherRules ) {
        thisRules.set(entry[0], entry[1].slice());
    }
};

/******************************************************************************/

URLNetFiltering.prototype.setRule = function(srcHostname, url, type, action) {
    if ( action === 0 ) {
        return this.removeRule(srcHostname, url, type);
    }
    var bucketKey = srcHostname + ' ' + type,
        entries = this.rules.get(bucketKey);
    if ( entries === undefined ) {
        entries = [];
        this.rules.set(bucketKey, entries);
    }
    var i = indexOfURL(entries, url),
        entry;
    if ( i !== -1 ) {
        entry = entries[i];
        if ( entry.action === action ) { return false; }
        entry.action = action;
    } else {
        addRuleEntry(entries, url, action);
    }
    return true;
};

/******************************************************************************/

URLNetFiltering.prototype.removeRule = function(srcHostname, url, type) {
    var bucketKey = srcHostname + ' ' + type,
        entries = this.rules.get(bucketKey);
    if ( entries === undefined ) {
        return false;
    }
    var i = indexOfURL(entries, url);
    if ( i === -1 ) {
        return false;
    }
    entries.splice(i, 1);
    if ( entries.length === 0 ) {
        this.rules.delete(bucketKey);
    }
    return true;
};

/******************************************************************************/

URLNetFiltering.prototype.evaluateZ = function(context, target, type) {
    this.r = 0;
    if ( this.rules.size === 0 ) {
        return 0;
    }
    var entries, pos, i, entry;
    for (;;) {
        this.context = context;
        if ( (entries = this.rules.get(context + ' ' + type)) ) {
            i = indexOfMatch(entries, target);
            if ( i !== -1 ) {
                entry = entries[i];
                this.url = entry.url;
                this.type = type;
                this.r = entry.action;
                return this.r;
            }
        }
        if ( (entries = this.rules.get(context + ' *')) ) {
            i = indexOfMatch(entries, target);
            if ( i !== -1 ) {
                entry = entries[i];
                this.url = entry.url;
                this.type = '*';
                this.r = entry.action;
                return this.r;
            }
        }
        if ( context === '*' ) { break; }
        pos = context.indexOf('.');
        context = pos !== -1 ? context.slice(pos + 1) : '*';
    }
    return 0;
};

/******************************************************************************/

URLNetFiltering.prototype.mustAllowCellZ = function(context, target, type) {
    return this.evaluateZ(context, target, type).r === 2;
};

/******************************************************************************/

URLNetFiltering.prototype.mustBlockOrAllow = function() {
    return this.r === 1 || this.r === 2;
};

/******************************************************************************/

URLNetFiltering.prototype.toLogData = function() {
    if ( this.r === 0 ) { return; }
    return {
        source: 'dynamicUrl',
        result: this.r,
        rule: [
            this.context,
            this.url,
            this.type,
            this.intToActionMap.get(this.r)
        ],
        raw: this.context + ' ' +
             this.url + ' ' +
             this.type + ' ' +
             this.intToActionMap.get(this.r)
    };
};

URLNetFiltering.prototype.intToActionMap = new Map([
    [ 1, ' block' ],
    [ 2, ' allow' ],
    [ 3, ' noop' ]
]);

/******************************************************************************/

URLNetFiltering.prototype.copyRules = function(other, context, urls, type) {
    var changed = false;
    var url, otherOwn, thisOwn;
    var i = urls.length;
    while ( i-- ) {
        url = urls[i];
        other.evaluateZ(context, url, type);
        otherOwn = other.r !== 0 && other.context === context && other.url === url && other.type === type;
        this.evaluateZ(context, url, type);
        thisOwn = this.r !== 0 && this.context === context && this.url === url && this.type === type;
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
    var out = [],
        key, pos, hn, type, entries, i, entry;
    for ( var item of this.rules ) {
        key = item[0];
        pos = key.indexOf(' ');
        hn = key.slice(0, pos);
        pos = key.lastIndexOf(' ');
        type = key.slice(pos + 1);
        entries = item[1];
        for ( i = 0; i < entries.length; i++ ) {
            entry = entries[i];
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
    this.reset();

    var lineIter = new µBlock.LineIterator(text),
        line, fields;
    while ( lineIter.eot() === false ) {
        line = lineIter.next().trim();
        if ( line === '' ) { continue; }
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
