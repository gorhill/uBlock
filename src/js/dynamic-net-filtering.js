/*******************************************************************************

    uBlock - a browser extension to block requests.
    Copyright (C) 2014  Raymond Hill

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

/* global punycode, µBlock */
/* jshint bitwise: false */

/******************************************************************************/

µBlock.Firewall = (function() {

'use strict';

/******************************************************************************/

var magicId = 'chmdgxwtetgu';

/******************************************************************************/

var Matrix = function() {
    this.reset();
};

/******************************************************************************/

var supportedDynamicTypes = {
           '3p': true,
        'image': true,
'inline-script': true,
    '1p-script': true,
    '3p-script': true,
     '3p-frame': true
};

var typeBitOffsets = {
            '*':  0,
'inline-script':  2,
    '1p-script':  4,
    '3p-script':  6,
     '3p-frame':  8,
        'image': 10,
           '3p': 12
};

var actionToNameMap = {
    '1': 'block',
    '2': 'allow',
    '3': 'noop'
};

var nameToActionMap = {
    'block': 1,
    'allow': 2,
     'noop': 3
};

/******************************************************************************/

// For performance purpose, as simple tests as possible
var reHostnameVeryCoarse = /[g-z_-]/;
var reIPv4VeryCoarse = /\.\d+$/;
var reBadHostname = /[^0-9a-z_.\[\]:-]/;

// http://tools.ietf.org/html/rfc5952
// 4.3: "MUST be represented in lowercase"
// Also: http://en.wikipedia.org/wiki/IPv6_address#Literal_IPv6_addresses_in_network_resource_identifiers

var isIPAddress = function(hostname) {
    if ( reHostnameVeryCoarse.test(hostname) ) {
        return false;
    }
    if ( reIPv4VeryCoarse.test(hostname) ) {
        return true;
    }
    return hostname.startsWith('[');
};

/******************************************************************************/

var toBroaderHostname = function(hostname) {
    if ( isIPAddress(hostname) ) {
        return '*';
    }
    var pos = hostname.indexOf('.');
    if ( pos !== -1 ) {
        return hostname.slice(pos + 1);
    }
    return hostname !== '*' && hostname !== '' ? '*' : '';
};

Matrix.toBroaderHostname = toBroaderHostname;

/******************************************************************************/

Matrix.prototype.reset = function() {
    this.r = 0;
    this.type = '';
    this.y = '';
    this.z = '';
    this.rules = {};
};

/******************************************************************************/

Matrix.prototype.assign = function(other) {
    var thisRules = this.rules;
    var otherRules = other.rules;
    var k;

    // Remove rules not in other
    for ( k in thisRules ) {
        if ( thisRules.hasOwnProperty(k) === false ) {
            continue;
        }
        if ( otherRules.hasOwnProperty(k) === false ) {
            delete thisRules[k];
        }
    }

    // Add/change rules in other
    for ( k in otherRules ) {
        if ( otherRules.hasOwnProperty(k) === false ) {
            continue;
        }
        thisRules[k] = otherRules[k];
    }
};

/******************************************************************************/

Matrix.prototype.copyRules = function(other, srcHostname, desHostnames) {
    var thisRules = this.rules;
    var otherRules = other.rules;
    var ruleKey, ruleValue;

    // Specific types
    ruleValue = otherRules['* *'] || 0;
    if ( ruleValue !== 0 ) {
        thisRules['* *'] = ruleValue;
    } else {
        delete thisRules['* *'];
    }
    ruleKey = srcHostname + ' *';
    ruleValue = otherRules[ruleKey] || 0;
    if ( ruleValue !== 0 ) {
        thisRules[ruleKey] = ruleValue;
    } else {
        delete thisRules[ruleKey];
    }

    // Specific destinations
    for ( var desHostname in desHostnames ) {
        if ( desHostnames.hasOwnProperty(desHostname) === false ) {
            continue;
        }
        ruleKey = '* ' + desHostname;
        ruleValue = otherRules[ruleKey] || 0;
        if ( ruleValue !== 0 ) {
            thisRules[ruleKey] = ruleValue;
        } else {
            delete thisRules[ruleKey];
        }
        ruleKey = srcHostname + ' ' + desHostname ;
        ruleValue = otherRules[ruleKey] || 0;
        if ( ruleValue !== 0 ) {
            thisRules[ruleKey] = ruleValue;
        } else {
            delete thisRules[ruleKey];
        }
    }

    return true;
};

/******************************************************************************/

// - *    *  type
// - from *  type
// - *    to *
// - from to *

Matrix.prototype.hasSameRules = function(other, srcHostname, desHostnames) {
    var thisRules = this.rules;
    var otherRules = other.rules;
    var ruleKey;

    // Specific types
    ruleKey = '* *';
    if ( (thisRules[ruleKey] || 0) !== (otherRules[ruleKey] || 0) ) {
        return false;
    }
    ruleKey = srcHostname + ' *';
    if ( (thisRules[ruleKey] || 0) !== (otherRules[ruleKey] || 0) ) {
        return false;
    }

    // Specific destinations
    for ( var desHostname in desHostnames ) {
        if ( desHostnames.hasOwnProperty(desHostname) === false ) {
            continue;
        }
        ruleKey = '* ' + desHostname;
        if ( (thisRules[ruleKey] || 0) !== (otherRules[ruleKey] || 0) ) {
            return false;
        }
        ruleKey = srcHostname + ' ' + desHostname ;
        if ( (thisRules[ruleKey] || 0) !== (otherRules[ruleKey] || 0) ) {
            return false;
        }
    }

    return true;
};

/******************************************************************************/

Matrix.prototype.setCell = function(srcHostname, desHostname, type, state) {
    var bitOffset = typeBitOffsets[type];
    var k = srcHostname + ' ' + desHostname;
    var oldBitmap = this.rules[k];
    if ( oldBitmap === undefined ) {
        oldBitmap = 0;
    }
    var newBitmap = oldBitmap & ~(3 << bitOffset) | (state << bitOffset);
    if ( newBitmap === oldBitmap ) {
        return false;
    }
    if ( newBitmap === 0 ) {
        delete this.rules[k];
    } else {
        this.rules[k] = newBitmap;
    }
    return true;
};

/******************************************************************************/

Matrix.prototype.unsetCell = function(srcHostname, desHostname, type) {
    this.evaluateCellZY(srcHostname, desHostname, type);
    if ( this.r === 0 ) {
        return false;
    }
    this.setCell(srcHostname, desHostname, type, 0);
    return true;
};

/******************************************************************************/

Matrix.prototype.setCellZ = function(srcHostname, desHostname, type, action) {
    this.evaluateCellZY(srcHostname, desHostname, type);
    if ( this.r === action ) {
        return false;
    }
    this.setCell(srcHostname, desHostname, type, 0);
    this.evaluateCellZY(srcHostname, desHostname, type);
    if ( this.r === action ) {
        return true;
    }
    this.setCell(srcHostname, desHostname, type, action);
    return true;
};

/******************************************************************************/

Matrix.prototype.blockCell = function(srcHostname, desHostname, type) {
    return this.setCellZ(srcHostname, desHostname, type, 1);
};

// https://www.youtube.com/watch?v=Csewb_eIStY

/******************************************************************************/

Matrix.prototype.allowCell = function(srcHostname, desHostname, type) {
    return this.setCellZ(srcHostname, desHostname, type, 2);
};

/******************************************************************************/

Matrix.prototype.evaluateCell = function(srcHostname, desHostname, type) {
    var key = srcHostname + ' ' + desHostname;
    var bitmap = this.rules[key];
    if ( bitmap === undefined ) {
        return 0;
    }
    return bitmap >> typeBitOffsets[type] & 3;
};

/******************************************************************************/

Matrix.prototype.clearRegisters = function() {
    this.r = 0;
    this.type = this.y = this.z = '';
    return this;
};

/******************************************************************************/

var is3rdParty = function(srcHostname, desHostname) {
    // If at least one is party-less, the relation can't be labelled
    // "3rd-party"
    if ( desHostname === '*' || srcHostname === '*' || srcHostname === '' ) {
        return false;
    }

    // No domain can very well occurs, for examples:
    // - localhost
    // - file-scheme
    // etc.
    var srcDomain = domainFromHostname(srcHostname) || srcHostname;

    if ( desHostname.endsWith(srcDomain) === false ) {
        return true;
    }
    // Do not confuse 'example.com' with 'anotherexample.com'
    return desHostname.length !== srcDomain.length &&
           desHostname.charAt(desHostname.length - srcDomain.length - 1) !== '.';
};

var domainFromHostname = µBlock.URI.domainFromHostname;

/******************************************************************************/

Matrix.prototype.evaluateCellZ = function(srcHostname, desHostname, type) {
    this.type = type;
    var bitOffset = typeBitOffsets[type];
    var s = srcHostname;
    var v;
    for (;;) {
        this.z = s;
        v = this.rules[s + ' ' + desHostname];
        if ( v !== undefined ) {
            v = v >>> bitOffset & 3;
            if ( v !== 0 ) {
                this.r = v;
                return v;
            }
        }
        s = toBroaderHostname(s);
        if ( s === '' ) {
            break;
        }
    }
    // srcHostname is '*' at this point
    this.r = 0;
    return 0;
};

/******************************************************************************/

Matrix.prototype.evaluateCellZY = function(srcHostname, desHostname, type) {
    // Precedence: from most specific to least specific

    // Specific-destination, any party, any type
    var d = desHostname;
    if ( d === '' ) {
        this.r = 0;
        return this;
    }
    while ( d !== '*' ) {
        this.y = d;
        if ( this.evaluateCellZ(srcHostname, d, '*') !== 0 ) { return this; }
        d = toBroaderHostname(d);
    }

    var thirdParty = is3rdParty(srcHostname, desHostname);

    // Any destination
    this.y = '*';

    // Specific party
    if ( thirdParty ) {
        // 3rd-party, specific type
        if ( type === 'script' ) {
            if ( this.evaluateCellZ(srcHostname, '*', '3p-script') !== 0 ) { return this; }
        } else if ( type === 'sub_frame' ) {
            if ( this.evaluateCellZ(srcHostname, '*', '3p-frame') !== 0 ) { return this; }
        }
        // 3rd-party, any type
        if ( this.evaluateCellZ(srcHostname, '*', '3p') !== 0 ) { return this; }
    } else if ( type === 'script' ) {
        // 1st party, specific type
        if ( this.evaluateCellZ(srcHostname, '*', '1p-script') !== 0 ) { return this; }
    }

    // Any destination, any party, specific type
    if ( supportedDynamicTypes.hasOwnProperty(type) ) {
        if ( this.evaluateCellZ(srcHostname, '*', type) !== 0 ) { return this; }
    }

    // Any destination, any party, any type
    if ( this.evaluateCellZ(srcHostname, '*', '*') !== 0 ) { return this; }

    this.type = '';
    return this;
};

// http://youtu.be/gSGk1bQ9rcU?t=25m6s

/******************************************************************************/

Matrix.prototype.mustAllowCellZY = function(srcHostname, desHostname, type) {
    return this.evaluateCellZY(srcHostname, desHostname, type).r === 2;
};

/******************************************************************************/

Matrix.prototype.mustBlockOrAllow = function() {
    return this.r === 1 || this.r === 2;
};

/******************************************************************************/

Matrix.prototype.mustBlock = function() {
    return this.r === 1;
};

/******************************************************************************/

Matrix.prototype.mustAbort = function() {
    return this.r === 3;
};

/******************************************************************************/

Matrix.prototype.toFilterString = function() {
    if ( this.r === 0  || this.type === '' ) {
        return '';
    }
    var body = this.z + ' ' + this.y + ' ' + this.type;
    if ( this.r === 1 ) {
        return 'db:' + body + ' block';
    }
    if ( this.r === 2 ) {
        return 'da:' + body + ' allow';
    }
    /* this.r === 3 */
    return 'dn:' + body + ' noop';
};

/******************************************************************************/

Matrix.prototype.srcHostnameFromRule = function(rule) {
    return rule.slice(0, rule.indexOf(' '));
};

/******************************************************************************/

Matrix.prototype.desHostnameFromRule = function(rule) {
    return rule.slice(rule.indexOf(' ') + 1);
};

/******************************************************************************/

Matrix.prototype.toString = function() {
    var out = [];
    var rule, type, val;
    var srcHostname, desHostname;
    for ( rule in this.rules ) {
        if ( this.rules.hasOwnProperty(rule) === false ) {
            continue;
        }
        srcHostname = this.srcHostnameFromRule(rule);
        desHostname = this.desHostnameFromRule(rule);
        for ( type in typeBitOffsets ) {
            if ( typeBitOffsets.hasOwnProperty(type) === false ) {
                continue;
            }
            val = this.evaluateCell(srcHostname, desHostname, type);
            if ( val === 0 ) {
                continue;
            }
            out.push(
                punycode.toUnicode(srcHostname) + ' ' +
                punycode.toUnicode(desHostname) + ' ' +
                type + ' ' +
                actionToNameMap[val]
            );
        }
    }
    return out.join('\n');
};

/******************************************************************************/

Matrix.prototype.fromString = function(text, append) {
    var textEnd = text.length;
    var lineBeg = 0, lineEnd;
    var line, pos, fields;
    var srcHostname, desHostname, type, action;

    if ( append !== true ) {
        this.reset();
    }

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

        pos = line.indexOf('# ');
        if ( pos !== -1 ) {
            line = line.slice(0, pos).trim();
        }
        if ( line === '' ) {
            continue;
        }

        // URL net filtering rules
        if ( line.indexOf('://') !== -1 ) {
            continue;
        }

        // Valid rule syntax:

        // srcHostname desHostname type state
        //      type = a valid request type
        //      state = [`block`, `allow`, `noop`]

        // Lines with invalid syntax silently ignored

        fields = line.split(/\s+/);
        if ( fields.length !== 4 ) {
            continue;
        }

        // Ignore special rules:
        //   hostname-based switch rules
        if ( fields[0].endsWith(':') ) {
            continue;
        }

        srcHostname = punycode.toASCII(fields[0]);
        desHostname = punycode.toASCII(fields[1]);

        // https://github.com/chrisaljoudi/uBlock/issues/1082
        // Discard rules with invalid hostnames
        if ( (srcHostname !== '*' && reBadHostname.test(srcHostname)) ||
             (desHostname !== '*' && reBadHostname.test(desHostname))
        ) {
            continue;
        }

        type = fields[2];
        if ( typeBitOffsets.hasOwnProperty(type) === false ) {
            continue;
        }

        // https://github.com/chrisaljoudi/uBlock/issues/840
        // Discard invalid rules
        if ( desHostname !== '*' && type !== '*' ) {
            continue;
        }

        action = nameToActionMap[fields[3]];
        if ( typeof action !== 'number' || action < 0 || action > 3 ) {
            continue;
        }

        this.setCell(srcHostname, desHostname, type, action);
    }
};

/******************************************************************************/

Matrix.prototype.toSelfie = function() {
    return {
        magicId: magicId,
        rules: this.rules
    };
};

/******************************************************************************/

Matrix.prototype.fromSelfie = function(selfie) {
    this.rules = selfie.rules;
};

/******************************************************************************/

return Matrix;

/******************************************************************************/

// http://youtu.be/5-K8R1hDG9E?t=31m1s

})();

/******************************************************************************/

µBlock.sessionFirewall = new µBlock.Firewall();
µBlock.permanentFirewall = new µBlock.Firewall();

/******************************************************************************/
