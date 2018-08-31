/*******************************************************************************

    uBlock Origin - a Chromium browser extension to black/white list requests.
    Copyright (C) 2015-2018 Raymond Hill

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

µBlock.HnSwitches = (function() {

/******************************************************************************/

var HnSwitches = function() {
    this.reset();
};

/******************************************************************************/

var switchBitOffsets = {
       'no-strict-blocking':  0,
                'no-popups':  2,
    'no-cosmetic-filtering':  4,
          'no-remote-fonts':  6,
           'no-large-media':  8,
           'no-csp-reports': 10
};

var switchStateToNameMap = {
    '1': 'true',
    '2': 'false'
};

var nameToSwitchStateMap = {
     'true': 1,
    'false': 2,
       'on': 1,
      'off': 2
};

/******************************************************************************/

// For performance purpose, as simple tests as possible
var reHostnameVeryCoarse = /[g-z_-]/;
var reIPv4VeryCoarse = /\.\d+$/;
var reNotASCII = /[^\x20-\x7F]/;

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

var toBroaderHostname = function(hostname) {
    var pos = hostname.indexOf('.');
    if ( pos !== -1 ) {
        return hostname.slice(pos + 1);
    }
    return hostname !== '*' && hostname !== '' ? '*' : '';
};

var toBroaderIPAddress = function(ipaddress) {
    return ipaddress !== '*' && ipaddress !== '' ? '*' : '';
};

var selectHostnameBroadener = function(hostname) {
    return isIPAddress(hostname) ? toBroaderIPAddress : toBroaderHostname;
};

/******************************************************************************/

HnSwitches.prototype.reset = function() {
    this.switches = new Map();
    this.n = '';
    this.z = '';
    this.r = 0;
    this.changed = true;
};

/******************************************************************************/

// If value is undefined, the switch is removed

HnSwitches.prototype.toggle = function(switchName, hostname, newVal) {
    var bitOffset = switchBitOffsets[switchName];
    if ( bitOffset === undefined ) {
        return false;
    }
    if ( newVal === this.evaluate(switchName, hostname) ) {
        return false;
    }
    var bits = this.switches.get(hostname) || 0;
    bits &= ~(3 << bitOffset);
    bits |= newVal << bitOffset;
    if ( bits === 0 ) {
        this.switches.delete(hostname);
    } else {
        this.switches.set(hostname, bits);
    }
    this.changed = true;
    return true;
};

/******************************************************************************/

HnSwitches.prototype.toggleOneZ = function(switchName, hostname, newState) {
    var bitOffset = switchBitOffsets[switchName];
    if ( bitOffset === undefined ) {
        return false;
    }
    var state = this.evaluateZ(switchName, hostname);
    if ( newState === state ) {
        return false;
    }
    if ( newState === undefined ) {
        newState = !state;
    }
    var bits = this.switches.get(hostname) || 0;
    bits &= ~(3 << bitOffset);
    if ( bits === 0 ) {
        this.switches.delete(hostname);
    } else {
        this.switches.set(hostname, bits);
    }
    state = this.evaluateZ(switchName, hostname);
    if ( state !== newState ) {
        this.switches.set(hostname, bits | ((newState ? 1 : 2) << bitOffset));
    }
    this.changed = true;
    return true;
};

/******************************************************************************/

HnSwitches.prototype.toggleBranchZ = function(switchName, targetHostname, newState) {
    this.toggleOneZ(switchName, targetHostname, newState);

    // Turn off all descendant switches, they will inherit the state of the
    // branch's origin.
    var targetLen = targetHostname.length;
    for ( var hostname of this.switches.keys() ) {
        if ( hostname === targetHostname ) {
            continue;
        }
        if ( hostname.length <= targetLen ) {
            continue;
        }
        if ( hostname.endsWith(targetHostname) === false ) {
            continue;
        }
        if ( hostname.charAt(hostname.length - targetLen - 1) !== '.' ) {
            continue;
        }
        this.toggle(switchName, hostname, 0);
    }

    return this.changed;
};

/******************************************************************************/

HnSwitches.prototype.toggleZ = function(switchName, hostname, deep, newState) {
    if ( deep === true ) {
        return this.toggleBranchZ(switchName, hostname, newState);
    }
    return this.toggleOneZ(switchName, hostname, newState);
};

/******************************************************************************/

// 0 = inherit from broader scope, up to default state
// 1 = non-default state
// 2 = forced default state (to override a broader non-default state)

HnSwitches.prototype.evaluate = function(switchName, hostname) {
    var bits = this.switches.get(hostname);
    if ( bits === undefined ) {
        return 0;
    }
    var bitOffset = switchBitOffsets[switchName];
    if ( bitOffset === undefined ) {
        return 0;
    }
    return (bits >>> bitOffset) & 3;
};

/******************************************************************************/

HnSwitches.prototype.evaluateZ = function(switchName, hostname) {
    var bitOffset = switchBitOffsets[switchName];
    if ( bitOffset === undefined ) {
        this.r = 0;
        return false;
    }
    this.n = switchName;
    var bits,
        hn = hostname,
        broadenSource = selectHostnameBroadener(hn);
    for (;;) {
        bits = this.switches.get(hn);
        if ( bits !== undefined ) {
            bits = bits >>> bitOffset & 3;
            if ( bits !== 0 ) {
                this.z = hn;
                this.r = bits;
                return bits === 1;
            }
        }
        hn = broadenSource(hn);
        if ( hn === '' ) { break; }
    }
    this.r = 0;
    return false;
};

/******************************************************************************/

HnSwitches.prototype.toLogData = function() {
    return {
        source: 'switch',
        result: this.r,
        raw: this.n + ': ' + this.z + ' true'
    };
};

/******************************************************************************/

HnSwitches.prototype.toArray = function() {
    var out = [],
        toUnicode = punycode.toUnicode;
    for ( var hostname of this.switches.keys() ) {
        for ( var switchName in switchBitOffsets ) {
            if ( switchBitOffsets.hasOwnProperty(switchName) === false ) {
                continue;
            }
            var val = this.evaluate(switchName, hostname);
            if ( val === 0 ) { continue; }
            if ( hostname.indexOf('xn--') !== -1 ) {
                hostname = toUnicode(hostname);
            }
            out.push(switchName + ': ' + hostname + ' ' + switchStateToNameMap[val]);
        }
    }
    return out;
};

HnSwitches.prototype.toString = function() {
    return this.toArray().join('\n');
};

/******************************************************************************/

HnSwitches.prototype.fromString = function(text, append) {
    var lineIter = new µBlock.LineIterator(text);
    if ( append !== true ) { this.reset(); }
    while ( lineIter.eot() === false ) {
        this.addFromRuleParts(lineIter.next().trim().split(/\s+/));
    }
};

/******************************************************************************/

HnSwitches.prototype.validateRuleParts = function(parts) {
    if ( parts.length < 3 ) { return; }
    if ( parts[0].endsWith(':') === false ) { return; }
    if ( nameToSwitchStateMap.hasOwnProperty(parts[2]) === false ) { return; }
    // Performance: avoid punycoding if hostname is made only of ASCII chars.
    if ( reNotASCII.test(parts[1]) ) { parts[1] = punycode.toASCII(parts[1]); }
    return parts;
};

/******************************************************************************/

HnSwitches.prototype.addFromRuleParts = function(parts) {
    if ( this.validateRuleParts(parts) !== undefined ) {
        var switchName = parts[0].slice(0, -1);
        if ( switchBitOffsets.hasOwnProperty(switchName) ) {
            this.toggle(switchName, parts[1], nameToSwitchStateMap[parts[2]]);
            return true;
        }
    }
    return false;
};

HnSwitches.prototype.removeFromRuleParts = function(parts) {
    if ( this.validateRuleParts(parts) !== undefined ) {
        this.toggle(parts[0].slice(0, -1), parts[1], 0);
        return true;
    }
    return false;
};

/******************************************************************************/

return HnSwitches;

/******************************************************************************/

})();

/******************************************************************************/

µBlock.hnSwitches = new µBlock.HnSwitches();

/******************************************************************************/
