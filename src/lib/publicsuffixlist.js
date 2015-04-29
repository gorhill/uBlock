/*******************************************************************************

    publicsuffixlist.js - an efficient javascript implementation to deal with
    Mozilla Foundation's Public Suffix List <http://publicsuffix.org/list/>
    Copyright (C) 2013  Raymond Hill

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

*/

/*! Home: https://github.com/gorhill/publicsuffixlist.js */

/*
    This code is mostly dumb: I consider this to be lower-level code, thus
    in order to ensure efficiency, the caller is responsible for sanitizing
    the inputs.
*/

/******************************************************************************/

// A single instance of PublicSuffixList is enough.

;(function(root) {

'use strict';

/******************************************************************************/

var exceptions = {};
var rules = {};
var selfieMagic = 'iscjsfsaolnm';

// This value dictate how the search will be performed:
//    < this.cutoffLength = indexOf()
//   >= this.cutoffLength = binary search
var cutoffLength = 256;
var mustPunycode = /[^a-z0-9.-]/;

var onChangedListeners = [];

/******************************************************************************/

// In the context of this code, a domain is defined as:
//   "{label}.{public suffix}".
// A single standalone label is a public suffix as per
// http://publicsuffix.org/list/:
//   "If no rules match, the prevailing rule is '*' "
// This means 'localhost' is not deemed a domain by this
// code, since according to the definition above, it would be
// evaluated as a public suffix. The caller is therefore responsible to
// decide how to further interpret such public suffix.
//
// `hostname` must be a valid ascii-based hostname.

function getDomain(hostname) {
    // A hostname starting with a dot is not a valid hostname.
    if ( !hostname || hostname.charAt(0) === '.' ) {
        return '';
    }
    hostname = hostname.toLowerCase();
    var suffix = getPublicSuffix(hostname);
    if ( suffix === hostname ) {
        return '';
    }
    var pos = hostname.lastIndexOf('.', hostname.lastIndexOf('.', hostname.length - suffix.length) - 1);
    if ( pos <= 0 ) {
        return hostname;
    }
    return hostname.slice(pos + 1);
}

/******************************************************************************/

// Return longest public suffix.
//
// `hostname` must be a valid ascii-based string which respect hostname naming.

function getPublicSuffix(hostname) {
    if ( !hostname ) {
        return '';
    }
    // Since we slice down the hostname with each pass, the first match
    // is the longest, so no need to find all the matching rules.
    var pos;
    while ( true ) {
        pos = hostname.indexOf('.');
        if ( pos < 0 ) {
            return hostname;
        }
        if ( search(exceptions, hostname) ) {
            return hostname.slice(pos + 1);
        }
        if ( search(rules, hostname) ) {
            return hostname;
        }
        if ( search(rules, '*' + hostname.slice(pos)) ) {
            return hostname;
        }
        hostname = hostname.slice(pos + 1);
    }
    // unreachable
}

/******************************************************************************/

// Look up a specific hostname.

function search(store, hostname) {
    // Extract TLD
    var pos = hostname.lastIndexOf('.');
    var tld, remainder;
    if ( pos < 0 ) {
        tld = hostname;
        remainder = hostname;
    } else {
        tld = hostname.slice(pos + 1);
        remainder = hostname.slice(0, pos);
    }
    var substore = store[tld];
    if ( !substore ) {
        return false;
    }
    // If substore is a string, use indexOf()
    if ( typeof substore === 'string' ) {
        return substore.indexOf(' ' + remainder + ' ') >= 0;
    }
    // It is an array: use binary search.
    var l = remainder.length;
    var haystack = substore[l];
    if ( !haystack ) {
        return false;
    }
    var left = 0;
    var right = Math.floor(haystack.length / l + 0.5);
    var i, needle;
    while ( left < right ) {
        i = left + right >> 1;
        needle = haystack.substr( l * i, l );
        if ( remainder < needle ) {
            right = i;
        } else if ( remainder > needle ) {
            left = i + 1;
        } else {
            return true;
        }
    }
    return false;
}

/******************************************************************************/

// Parse and set a UTF-8 text-based suffix list. Format is same as found at:
// http://publicsuffix.org/list/
//
// `toAscii` is a converter from unicode to punycode. Required since the
// Public Suffix List contains unicode characters.
// Suggestion: use <https://github.com/bestiejs/punycode.js> it's quite good.

function parse(text, toAscii) {
    exceptions = {};
    rules = {};

    // http://publicsuffix.org/list/:
    // "... all rules must be canonicalized in the normal way
    // for hostnames - lower-case, Punycode ..."
    text = text.toLowerCase();

    var lineBeg = 0, lineEnd;
    var textEnd = text.length;
    var line, store, pos, tld;

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

        if ( line.length === 0 ) {
            continue;
        }

        // Ignore comments
        pos = line.indexOf('//');
        if ( pos >= 0 ) {
            line = line.slice(0, pos);
        }

        // Ignore surrounding whitespaces
        line = line.trim();
        if ( !line ) {
            continue;
        }

        if ( mustPunycode.test(line) ) {
            line = toAscii(line);
        }

        // Is this an exception rule?
        if ( line.charAt(0) === '!' ) {
            store = exceptions;
            line = line.slice(1);
        } else {
            store = rules;
        }

        // Extract TLD
        pos = line.lastIndexOf('.');
        if ( pos < 0 ) {
            tld = line;
        } else {
            tld = line.slice(pos + 1);
            line = line.slice(0, pos);
        }

        // Store suffix using tld as key
        if ( !store.hasOwnProperty(tld) ) {
            store[tld] = [];
        }
        if ( line ) {
            store[tld].push(line);
        }
    }
    crystallize(exceptions);
    crystallize(rules);
    callListeners(onChangedListeners);
}

/******************************************************************************/

// Cristallize the storage of suffixes using optimal internal representation
// for future look up.

function crystallize(store) {
    var suffixes, suffix, i, l;

    for ( var tld in store ) {
        if ( !store.hasOwnProperty(tld) ) {
            continue;
        }
        suffixes = store[tld].join(' ');
        // No suffix
        if ( !suffixes ) {
            store[tld] = '';
            continue;
        }
        // Concatenated list of suffixes less than cutoff length:
        //   Store as string, lookup using indexOf()
        if ( suffixes.length < cutoffLength ) {
            store[tld] = ' ' + suffixes + ' ';
            continue;
        }
        // Concatenated list of suffixes greater or equal to cutoff length
        //   Store as array keyed on suffix length, lookup using binary search.
        // I borrowed the idea to key on string length here:
        //   http://ejohn.org/blog/dictionary-lookups-in-javascript/#comment-392072

        i = store[tld].length;
        suffixes = [];
        while ( i-- ) {
            suffix = store[tld][i];
            l = suffix.length;
            if ( !suffixes[l] ) {
                suffixes[l] = [];
            }
            suffixes[l].push(suffix);
        }
        l = suffixes.length;
        while ( l-- ) {
            if ( suffixes[l] ) {
                suffixes[l] = suffixes[l].sort().join('');
            }
        }
        store[tld] = suffixes;
    }
    return store;
}

/******************************************************************************/

function toSelfie() {
    return {
        magic: selfieMagic,
        rules: rules,
        exceptions: exceptions
    };
}

function fromSelfie(selfie) {
    if ( typeof selfie !== 'object' || typeof selfie.magic !== 'string' || selfie.magic !== selfieMagic ) {
        return false;
    }
    rules = selfie.rules;
    exceptions = selfie.exceptions;
    callListeners(onChangedListeners);
    return true;
}

/******************************************************************************/

var addListener = function(listeners, callback) {
    if ( typeof callback !== 'function' ) {
        return;
    }
    if ( listeners.indexOf(callback) === -1 ) {
        listeners.push(callback);
    }
};

var removeListener = function(listeners, callback) {
    var pos = listeners.indexOf(callback);
    if ( pos !== -1 ) {
        listeners.splice(pos, 1);
    }
};

var callListeners = function(listeners) {
    for ( var i = 0; i < listeners.length; i++ ) {
        listeners[i]();
    }
};

/******************************************************************************/

var onChanged = {
    addListener: function(callback) {
        addListener(onChangedListeners, callback);
    },
    removeListener: function(callback) {
        removeListener(onChangedListeners, callback);
    }
};

/******************************************************************************/

// Public API

root = root || window;

root.publicSuffixList = {
    'version': '1.0',
    'parse': parse,
    'getDomain': getDomain,
    'getPublicSuffix': getPublicSuffix,
    'toSelfie': toSelfie,
    'fromSelfie': fromSelfie,
    'onChanged': onChanged
};

/******************************************************************************/

})(this);

