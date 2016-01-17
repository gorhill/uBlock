/*******************************************************************************

    uBlock - a Chromium browser extension to black/white list requests.
    Copyright (C) 2015  Raymond Hill

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

µBlock.HnSwitches = (function() {

'use strict';

/******************************************************************************/

var HnSwitches = function() {
    this.reset();
};

/******************************************************************************/

var switchBitOffsets = {
       'no-strict-blocking': 0,
                'no-popups': 2,
    'no-cosmetic-filtering': 4,
          'no-remote-fonts': 6,
           'no-large-media': 8
};

var fromLegacySwitchNames = {
           'dontBlockDoc': 'no-strict-blocking',
       'doBlockAllPopups': 'no-popups',
       'noStrictBlocking': 'no-strict-blocking',
               'noPopups': 'no-popups',
    'noCosmeticFiltering': 'no-cosmetic-filtering'
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

HnSwitches.toBroaderHostname = toBroaderHostname;

/******************************************************************************/

HnSwitches.prototype.reset = function() {
    this.switches = {};
    this.n = '';
    this.z = '';
    this.r = 0;
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
    var bits = this.switches[hostname] || 0;
    bits &= ~(3 << bitOffset);
    bits |= newVal << bitOffset;
    if ( bits === 0 ) {
        delete this.switches[hostname];
    } else {
        this.switches[hostname] = bits;
    }
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
    var bits = this.switches[hostname] || 0;
    bits &= ~(3 << bitOffset);
    if ( bits === 0 ) {
        delete this.switches[hostname];
    } else {
        this.switches[hostname] = bits;
    }
    state = this.evaluateZ(switchName, hostname);
    if ( state === newState ) {
        return true;
    }
    this.switches[hostname] = bits | ((newState ? 1 : 2) << bitOffset);
    return true;
};

/******************************************************************************/

HnSwitches.prototype.toggleBranchZ = function(switchName, targetHostname, newState) {
    var changed = this.toggleOneZ(switchName, targetHostname, newState);
    var targetLen = targetHostname.length;

    // Turn off all descendant switches, they will inherit the state of the
    // branch's origin.
    for ( var hostname in this.switches ) {
        if ( this.switches.hasOwnProperty(hostname) === false ) {
            continue;
        }
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
        changed = this.toggle(switchName, hostname, 0) || changed;
    }

    return changed;
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
    var bits = this.switches[hostname] || 0;
    if ( bits === 0 ) {
        return 0;
    }
    var bitOffset = switchBitOffsets[switchName];
    if ( bitOffset === undefined ) {
        return 0;
    }
    return (bits >> bitOffset) & 3;
};

/******************************************************************************/

HnSwitches.prototype.evaluateZ = function(switchName, hostname) {
    var bitOffset = switchBitOffsets[switchName];
    if ( bitOffset === undefined ) {
        this.r = 0;
        return false;
    }
    this.n = switchName;
    var bits;
    var s = hostname;
    for (;;) {
        bits = this.switches[s] || 0;
        if ( bits !== 0 ) {
            bits = bits >> bitOffset & 3;
            if ( bits !== 0 ) {
                this.z = s;
                this.r = bits;
                return bits === 1;
            }
        }
        s = toBroaderHostname(s);
        if ( s === '' ) {
            break;
        }
    }
    this.r = 0;
    return false;
};

/******************************************************************************/

HnSwitches.prototype.toResultString = function() {
    return this.r !== 1 ?
        '' :
        'ub:' + this.n + ': ' + this.z + ' true';
};

/******************************************************************************/

HnSwitches.prototype.toString = function() {
    var out = [];
    var switchName, val;
    var hostname;
    for ( hostname in this.switches ) {
        if ( this.switches.hasOwnProperty(hostname) === false ) {
            continue;
        }
        for ( switchName in switchBitOffsets ) {
            if ( switchBitOffsets.hasOwnProperty(switchName) === false ) {
                continue;
            }
            val = this.evaluate(switchName, hostname);
            if ( val === 0 ) {
                continue;
            }
            out.push(switchName + ': ' + hostname + ' ' + switchStateToNameMap[val]);
        }
    }
    return out.join('\n');
};

/******************************************************************************/

HnSwitches.prototype.fromString = function(text) {
    var textEnd = text.length;
    var lineBeg = 0, lineEnd;
    var line, pos;
    var fields;
    var switchName, hostname, state;

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

        pos = line.indexOf('# ');
        if ( pos !== -1 ) {
            line = line.slice(0, pos).trim();
        }
        if ( line === '' ) {
            continue;
        }

        fields = line.split(/\s+/);
        if ( fields.length !== 3 ) {
            continue;
        }

        switchName = fields[0];
        pos = switchName.indexOf(':');
        if ( pos === -1 ) {
            continue;
        }
        switchName = switchName.slice(0, pos);
        switchName = fromLegacySwitchNames[switchName] || switchName;
        if ( switchBitOffsets.hasOwnProperty(switchName) === false ) {
            continue;
        }

        hostname = punycode.toASCII(fields[1]);

        state = fields[2];
        if ( nameToSwitchStateMap.hasOwnProperty(state) === false ) {
            continue;
        }

        this.toggle(switchName, hostname, nameToSwitchStateMap[state]);
    }
};

/******************************************************************************/

return HnSwitches;

/******************************************************************************/

})();

/******************************************************************************/

µBlock.hnSwitches = new µBlock.HnSwitches();

/******************************************************************************/
