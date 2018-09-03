/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2018 Raymond Hill

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

/* global punycode */
/* jshint bitwise: false */

'use strict';

/******************************************************************************/

µBlock.Firewall = (function() {

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
var reBadHostname = /[^0-9a-z_.\[\]:%-]/;
var reNotASCII = /[^\x20-\x7F]/;

/******************************************************************************/

Matrix.prototype.reset = function() {
    this.r = 0;
    this.type = '';
    this.y = '';
    this.z = '';
    this.rules = new Map();
    this.changed = false;
    this.decomposedSource = [];
    this.decomposedDestination = [];
};

/******************************************************************************/

Matrix.prototype.assign = function(other) {
    // Remove rules not in other
    for ( var k of this.rules.keys() ) {
        if ( other.rules.has(k) === false ) {
            this.rules.delete(k);
            this.changed = true;
        }
    }
    // Add/change rules in other
    for ( var entry of other.rules ) {
        if ( this.rules.get(entry[0]) !== entry[1] ) {
            this.rules.set(entry[0], entry[1]);
            this.changed = true;
        }
    }
};

/******************************************************************************/

Matrix.prototype.copyRules = function(from, srcHostname, desHostnames) {
    // Specific types
    let thisBits = this.rules.get('* *');
    let fromBits = from.rules.get('* *');
    if ( fromBits !== thisBits ) {
        if ( fromBits !== undefined ) {
            this.rules.set('* *', fromBits);
        } else {
            this.rules.delete('* *');
        }
        this.changed = true;
    }

    let key = srcHostname + ' *';
    thisBits = this.rules.get(key);
    fromBits = from.rules.get(key);
    if ( fromBits !== thisBits ) {
        if ( fromBits !== undefined ) {
            this.rules.set(key, fromBits);
        } else {
            this.rules.delete(key);
        }
        this.changed = true;
    }

    // Specific destinations
    for ( let desHostname in desHostnames ) {
        if ( desHostnames.hasOwnProperty(desHostname) === false ) { continue; }
        key = '* ' + desHostname;
        thisBits = this.rules.get(key);
        fromBits = from.rules.get(key);
        if ( fromBits !== thisBits ) {
            if ( fromBits !== undefined ) {
                this.rules.set(key, fromBits);
            } else {
                this.rules.delete(key);
            }
            this.changed = true;
        }
        key = srcHostname + ' ' + desHostname ;
        thisBits = this.rules.get(key);
        fromBits = from.rules.get(key);
        if ( fromBits !== thisBits ) {
            if ( fromBits !== undefined ) {
                this.rules.set(key, fromBits);
            } else {
                this.rules.delete(key);
            }
            this.changed = true;
        }
    }

    return this.changed;
};

/******************************************************************************/

// - *    *  type
// - from *  type
// - *    to *
// - from to *

Matrix.prototype.hasSameRules = function(other, srcHostname, desHostnames) {

    // Specific types
    var key = '* *';
    if ( this.rules.get(key) !== other.rules.get(key) ) {
        return false;
    }
    key = srcHostname + ' *';
    if ( this.rules.get(key) !== other.rules.get(key) ) {
        return false;
    }

    // Specific destinations
    for ( var desHostname in desHostnames ) {
        key = '* ' + desHostname;
        if ( this.rules.get(key) !== other.rules.get(key) ) {
            return false;
        }
        key = srcHostname + ' ' + desHostname ;
        if ( this.rules.get(key) !== other.rules.get(key) ) {
            return false;
        }
    }

    return true;
};

/******************************************************************************/

Matrix.prototype.setCell = function(srcHostname, desHostname, type, state) {
    var bitOffset = typeBitOffsets[type];
    var k = srcHostname + ' ' + desHostname;
    var oldBitmap = this.rules.get(k) || 0;
    var newBitmap = oldBitmap & ~(3 << bitOffset) | (state << bitOffset);
    if ( newBitmap === oldBitmap ) {
        return false;
    }
    if ( newBitmap === 0 ) {
        this.rules.delete(k);
    } else {
        this.rules.set(k, newBitmap);
    }
    this.changed = true;
    return true;
};

/******************************************************************************/

Matrix.prototype.unsetCell = function(srcHostname, desHostname, type) {
    this.evaluateCellZY(srcHostname, desHostname, type);
    if ( this.r === 0 ) {
        return false;
    }
    this.setCell(srcHostname, desHostname, type, 0);
    this.changed = true;
    return true;
};

// https://www.youtube.com/watch?v=Csewb_eIStY

/******************************************************************************/

Matrix.prototype.evaluateCell = function(srcHostname, desHostname, type) {
    var key = srcHostname + ' ' + desHostname;
    var bitmap = this.rules.get(key);
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
    µBlock.decomposeHostname(srcHostname, this.decomposedSource);
    this.type = type;
    let bitOffset = typeBitOffsets[type];
    for ( let shn of this.decomposedSource ) {
        this.z = shn;
        let v = this.rules.get(shn + ' ' + desHostname);
        if ( v !== undefined ) {
            v = v >>> bitOffset & 3;
            if ( v !== 0 ) {
                this.r = v;
                return v;
            }
        }
    }
    // srcHostname is '*' at this point
    this.r = 0;
    return 0;
};

/******************************************************************************/

Matrix.prototype.evaluateCellZY = function(srcHostname, desHostname, type) {
    // Pathological cases.
    if ( desHostname === '' ) {
        this.r = 0;
        return 0;
    }

    // Precedence: from most specific to least specific

    // Specific-destination, any party, any type
    µBlock.decomposeHostname(desHostname, this.decomposedDestination);
    for ( let dhn of this.decomposedDestination ) {
        if ( dhn === '*' ) { break; }
        this.y = dhn;
        if ( this.evaluateCellZ(srcHostname, dhn, '*') !== 0 ) {
            return this.r;
        }
    }

    let thirdParty = is3rdParty(srcHostname, desHostname);

    // Any destination
    this.y = '*';

    // Specific party
    if ( thirdParty ) {
        // 3rd-party, specific type
        if ( type === 'script' ) {
            if ( this.evaluateCellZ(srcHostname, '*', '3p-script') !== 0 ) {
                return this.r;
            }
        } else if ( type === 'sub_frame' ) {
            if ( this.evaluateCellZ(srcHostname, '*', '3p-frame') !== 0 ) {
                return this.r;
            }
        }
        // 3rd-party, any type
        if ( this.evaluateCellZ(srcHostname, '*', '3p') !== 0 ) {
            return this.r;
        }
    } else if ( type === 'script' ) {
        // 1st party, specific type
        if ( this.evaluateCellZ(srcHostname, '*', '1p-script') !== 0 ) {
            return this.r;
        }
    }

    // Any destination, any party, specific type
    if ( supportedDynamicTypes.hasOwnProperty(type) ) {
        if ( this.evaluateCellZ(srcHostname, '*', type) !== 0 ) {
            return this.r;
        }
    }

    // Any destination, any party, any type
    if ( this.evaluateCellZ(srcHostname, '*', '*') !== 0 ) {
        return this.r;
    }

    this.type = '';
    return 0;
};

// http://youtu.be/gSGk1bQ9rcU?t=25m6s

/******************************************************************************/

Matrix.prototype.mustAllowCellZY = function(srcHostname, desHostname, type) {
    return this.evaluateCellZY(srcHostname, desHostname, type) === 2;
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

Matrix.prototype.lookupRuleData = function(src, des, type) {
    var r = this.evaluateCellZY(src, des, type);
    if ( r === 0 ) {
        return null;
    }
    return {
        src: this.z,
        des: this.y,
        type: this.type,
        action: r === 1 ? 'block' : (r === 2 ? 'allow' : 'noop')
    };
};

/******************************************************************************/

Matrix.prototype.toLogData = function() {
    if ( this.r === 0  || this.type === '' ) {
        return;
    }
    var logData = {
        source: 'dynamicHost',
        result: this.r,
        raw: this.z + ' ' +
             this.y + ' ' +
             this.type + ' ' +
             this.intToActionMap.get(this.r)
    };
    return logData;
};

Matrix.prototype.intToActionMap = new Map([
    [ 1, ' block' ],
    [ 2, ' allow' ],
    [ 3, ' noop' ]
]);

/******************************************************************************/

Matrix.prototype.srcHostnameFromRule = function(rule) {
    return rule.slice(0, rule.indexOf(' '));
};

/******************************************************************************/

Matrix.prototype.desHostnameFromRule = function(rule) {
    return rule.slice(rule.indexOf(' ') + 1);
};

/******************************************************************************/

Matrix.prototype.toArray = function() {
    var out = [],
        toUnicode = punycode.toUnicode;
    for ( var key of this.rules.keys() ) {
        var srcHostname = this.srcHostnameFromRule(key);
        var desHostname = this.desHostnameFromRule(key);
        for ( var type in typeBitOffsets ) {
            if ( typeBitOffsets.hasOwnProperty(type) === false ) { continue; }
            var val = this.evaluateCell(srcHostname, desHostname, type);
            if ( val === 0 ) { continue; }
            if ( srcHostname.indexOf('xn--') !== -1 ) {
                srcHostname = toUnicode(srcHostname);
            }
            if ( desHostname.indexOf('xn--') !== -1 ) {
                desHostname = toUnicode(desHostname);
            }
            out.push(
                srcHostname + ' ' +
                desHostname + ' ' +
                type + ' ' +
                actionToNameMap[val]
            );
        }
    }
    return out;
};

Matrix.prototype.toString = function() {
    return this.toArray().join('\n');
};

/******************************************************************************/

Matrix.prototype.fromString = function(text, append) {
    var lineIter = new µBlock.LineIterator(text);
    if ( append !== true ) { this.reset(); }
    while ( lineIter.eot() === false ) {
        this.addFromRuleParts(lineIter.next().trim().split(/\s+/));
    }
};

/******************************************************************************/

Matrix.prototype.validateRuleParts = function(parts) {
    if ( parts.length < 4 ) { return; }

    // Ignore hostname-based switch rules
    if ( parts[0].endsWith(':') ) { return; }

    // Ignore URL-based rules
    if ( parts[1].indexOf('/') !== -1 ) { return; }

    if ( typeBitOffsets.hasOwnProperty(parts[2]) === false ) { return; }

    if ( nameToActionMap.hasOwnProperty(parts[3]) === false ) { return; }

    // https://github.com/chrisaljoudi/uBlock/issues/840
    //   Discard invalid rules
    if ( parts[1] !== '*' && parts[2] !== '*' ) { return; }

    // Performance: avoid punycoding if hostnames are made only of ASCII chars.
    if ( reNotASCII.test(parts[0]) ) { parts[0] = punycode.toASCII(parts[0]); }
    if ( reNotASCII.test(parts[1]) ) { parts[1] = punycode.toASCII(parts[1]); }

    // https://github.com/chrisaljoudi/uBlock/issues/1082
    //   Discard rules with invalid hostnames
    if (
        (parts[0] !== '*' && reBadHostname.test(parts[0])) ||
        (parts[1] !== '*' && reBadHostname.test(parts[1]))
    ) {
        return;
    }

    return parts;
};

/******************************************************************************/

Matrix.prototype.addFromRuleParts = function(parts) {
    if ( this.validateRuleParts(parts) !== undefined ) {
        this.setCell(parts[0], parts[1], parts[2], nameToActionMap[parts[3]]);
        return true;
    }
    return false;
};

Matrix.prototype.removeFromRuleParts = function(parts) {
    if ( this.validateRuleParts(parts) !== undefined ) {
        this.setCell(parts[0], parts[1], parts[2], 0);
        return true;
    }
    return false;
};

/******************************************************************************/

var magicId = 1;

Matrix.prototype.toSelfie = function() {
    return {
        magicId: magicId,
        rules: Array.from(this.rules)
    };
};

Matrix.prototype.fromSelfie = function(selfie) {
    if ( selfie.magicId !== magicId ) { return false; }
    this.rules = new Map(selfie.rules);
    this.changed = true;
    return true;
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
