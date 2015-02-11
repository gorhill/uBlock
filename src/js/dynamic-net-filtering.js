/*******************************************************************************

    µBlock - a Chromium browser extension to black/white list requests.
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
    return hostname.charAt(0) === '[';
};

/******************************************************************************/

var toBroaderHostname = function(hostname) {
    if ( hostname === '*' ) {
        return '';
    }
    if ( isIPAddress(hostname) ) {
        return '*';
    }
    var pos = hostname.indexOf('.');
    if ( pos === -1 ) {
        return '*';
    }
    return hostname.slice(pos + 1);
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

    // Specific types
    thisRules['* *'] = otherRules['* *'];
    var ruleKey = srcHostname + ' *';
    thisRules[ruleKey] = otherRules[ruleKey];

    // Specific destinations
    for ( var desHostname in desHostnames ) {
        if ( desHostnames.hasOwnProperty(desHostname) === false ) {
            continue;
        }
        ruleKey = '* ' + desHostname;
        thisRules[ruleKey] = otherRules[ruleKey];
        ruleKey = srcHostname + ' ' + desHostname ;
        thisRules[ruleKey] = otherRules[ruleKey];
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
    if ( thisRules[ruleKey] !== otherRules[ruleKey] ) {
        return false;
    }
    ruleKey = srcHostname + ' *';
    if ( thisRules[ruleKey] !== otherRules[ruleKey] ) {
        return false;
    }

    // Specific destinations
    for ( var desHostname in desHostnames ) {
        if ( desHostnames.hasOwnProperty(desHostname) === false ) {
            continue;
        }
        ruleKey = '* ' + desHostname;
        if ( thisRules[ruleKey] !== otherRules[ruleKey] ) {
            return false;
        }
        ruleKey = srcHostname + ' ' + desHostname ;
        if ( thisRules[ruleKey] !== otherRules[ruleKey] ) {
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
    if ( desHostname === '*' ) {
        return false;
    }
    var srcDomain = domainFromHostname(srcHostname);
    if ( srcDomain === '' ) {
        srcDomain = desHostname;
    }
    if ( desHostname.slice(0 - srcDomain.length) !== srcDomain ) {
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
            v = v >> bitOffset & 3;
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
    if ( this.type === '' ) {
        return '';
    }
    if ( this.r === 1 ) {
        return 'db:' + this.z + ' ' + this.y + ' ' + this.type + ' block';
    }
    if ( this.r === 2 ) {
        return 'da:' + this.z + ' ' + this.y + ' ' + this.type + ' allow';
    }
    if ( this.r === 3 ) {
        return 'dn:' + this.z + ' ' + this.y + ' ' + this.type + ' noop';
    }
    return '';
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

        // Valid rule syntax:

        // srcHostname desHostname type state
        //      type = a valid request type
        //      state = [`block`, `allow`, `noop`]

        // Lines with invalid syntax silently ignored

        fields = line.split(/\s+/);
        if ( fields.length !== 4 ) {
            continue;
        }

        srcHostname = punycode.toASCII(fields[0]);
        desHostname = punycode.toASCII(fields[1]);

        type = fields[2];
        if ( typeBitOffsets.hasOwnProperty(type) === false ) {
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

Matrix.prototype.fromObsoleteSelfie = function(selfie) {
    if ( selfie === '' ) {
        return '';
    }
    var bin = {};
    try {
        bin = JSON.parse(selfie);
    } catch(e) {
    }
    var filters = bin.filters;
    var bits, val;
    for ( var hostname in filters ) {
        if ( filters.hasOwnProperty(hostname) === false ) {
            continue;
        }
        bits = filters[hostname];
        val = bits & 3;
        if ( val === 1 ) {
            this.setCell(hostname, '*', 'inline-script', 1);
        } else if ( val === 2 ) {
            this.setCell(hostname, '*', 'inline-script', 3);
        }
        val = (bits >> 2) & 3;
        if ( val === 1 ) {
            this.setCell(hostname, '*', '1p-script', 1);
        } else if ( val === 2 ) {
            this.setCell(hostname, '*', '1p-script', 3);
        }
        val = (bits >> 4) & 3;
        if ( val === 1 ) {
            this.setCell(hostname, '*', '3p-script', 1);
        } else if ( val === 2 ) {
            this.setCell(hostname, '*', '3p-script', 3);
        }
        val = (bits >> 8) & 3;
        if ( val === 1 ) {
            this.setCell(hostname, '*', '3p-frame', 1);
        } else if ( val === 2 ) {
            this.setCell(hostname, '*', '3p-frame', 3);
        }
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
