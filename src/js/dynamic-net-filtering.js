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

{
// >>>>> start of local scope

/******************************************************************************/

const supportedDynamicTypes = {
           '3p': true,
        'image': true,
'inline-script': true,
    '1p-script': true,
    '3p-script': true,
     '3p-frame': true
};

const typeBitOffsets = {
            '*':  0,
'inline-script':  2,
    '1p-script':  4,
    '3p-script':  6,
     '3p-frame':  8,
        'image': 10,
           '3p': 12
};

const actionToNameMap = {
    '1': 'block',
    '2': 'allow',
    '3': 'noop'
};

const nameToActionMap = {
    'block': 1,
    'allow': 2,
     'noop': 3
};

/******************************************************************************/

// For performance purpose, as simple tests as possible
const reBadHostname = /[^0-9a-z_.\[\]:%-]/;
const reNotASCII = /[^\x20-\x7F]/;

const is3rdParty = function(srcHostname, desHostname) {
    // If at least one is party-less, the relation can't be labelled
    // "3rd-party"
    if ( desHostname === '*' || srcHostname === '*' || srcHostname === '' ) {
        return false;
    }

    // No domain can very well occurs, for examples:
    // - localhost
    // - file-scheme
    // etc.
    const srcDomain = domainFromHostname(srcHostname) || srcHostname;

    if ( desHostname.endsWith(srcDomain) === false ) {
        return true;
    }
    // Do not confuse 'example.com' with 'anotherexample.com'
    return desHostname.length !== srcDomain.length &&
           desHostname.charAt(desHostname.length - srcDomain.length - 1) !== '.';
};

const domainFromHostname = µBlock.URI.domainFromHostname;

/******************************************************************************/

const Matrix = class {

    constructor() {
        this.reset();
    }


    reset() {
        this.r = 0;
        this.type = '';
        this.y = '';
        this.z = '';
        this.rules = new Map();
        this.changed = false;
        this.decomposedSource = [];
        this.decomposedDestination = [];
    }


    assign(other) {
        // Remove rules not in other
        for ( const k of this.rules.keys() ) {
            if ( other.rules.has(k) === false ) {
                this.rules.delete(k);
                this.changed = true;
            }
        }
        // Add/change rules in other
        for ( const entry of other.rules ) {
            if ( this.rules.get(entry[0]) !== entry[1] ) {
                this.rules.set(entry[0], entry[1]);
                this.changed = true;
            }
        }
    }


    copyRules(from, srcHostname, desHostnames) {
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
        for ( const desHostname in desHostnames ) {
            if ( desHostnames.hasOwnProperty(desHostname) === false ) {
                continue;
            }
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
    }


    // - *    *  type
    // - from *  type
    // - *    to *
    // - from to *

    hasSameRules(other, srcHostname, desHostnames) {
        // Specific types
        let key = '* *';
        if ( this.rules.get(key) !== other.rules.get(key) ) {
            return false;
        }
        key = srcHostname + ' *';
        if ( this.rules.get(key) !== other.rules.get(key) ) {
            return false;
        }
        // Specific destinations
        for ( const desHostname in desHostnames ) {
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
    }


    setCell(srcHostname, desHostname, type, state) {
        const bitOffset = typeBitOffsets[type];
        const k = srcHostname + ' ' + desHostname;
        const oldBitmap = this.rules.get(k) || 0;
        const newBitmap = oldBitmap & ~(3 << bitOffset) | (state << bitOffset);
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
    }


    unsetCell(srcHostname, desHostname, type) {
        this.evaluateCellZY(srcHostname, desHostname, type);
        if ( this.r === 0 ) {
            return false;
        }
        this.setCell(srcHostname, desHostname, type, 0);
        this.changed = true;
        return true;
    }


    evaluateCell(srcHostname, desHostname, type) {
        const key = srcHostname + ' ' + desHostname;
        const bitmap = this.rules.get(key);
        if ( bitmap === undefined ) { return 0; }
        return bitmap >> typeBitOffsets[type] & 3;
    }


    clearRegisters() {
        this.r = 0;
        this.type = this.y = this.z = '';
        return this;
    }


    evaluateCellZ(srcHostname, desHostname, type) {
        µBlock.decomposeHostname(srcHostname, this.decomposedSource);
        this.type = type;
        const bitOffset = typeBitOffsets[type];
        for ( const shn of this.decomposedSource ) {
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
    }


    evaluateCellZY(srcHostname, desHostname, type) {
        // Pathological cases.
        if ( desHostname === '' ) {
            this.r = 0;
            return 0;
        }

        // Precedence: from most specific to least specific

        // Specific-destination, any party, any type
        µBlock.decomposeHostname(desHostname, this.decomposedDestination);
        for ( const dhn of this.decomposedDestination ) {
            if ( dhn === '*' ) { break; }
            this.y = dhn;
            if ( this.evaluateCellZ(srcHostname, dhn, '*') !== 0 ) {
                return this.r;
            }
        }

        const thirdParty = is3rdParty(srcHostname, desHostname);

        // Any destination
        this.y = '*';

        // Specific party
        // TODO: equate `object` as `sub_frame`
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
    }


    mustAllowCellZY(srcHostname, desHostname, type) {
        return this.evaluateCellZY(srcHostname, desHostname, type) === 2;
    }


    mustBlockOrAllow() {
        return this.r === 1 || this.r === 2;
    }


    mustBlock() {
        return this.r === 1;
    }


    mustAbort() {
        return this.r === 3;
    }


    lookupRuleData(src, des, type) {
        const r = this.evaluateCellZY(src, des, type);
        if ( r === 0 ) { return; }
        return `${this.z} ${this.y} ${this.type} ${r}`;
    }


    toLogData() {
        if ( this.r === 0  || this.type === '' ) { return; }
        return {
            source: 'dynamicHost',
            result: this.r,
            raw: `${this.z} ${this.y} ${this.type} ${this.intToActionMap.get(this.r)}`
        };
    }


    srcHostnameFromRule(rule) {
        return rule.slice(0, rule.indexOf(' '));
    }


    desHostnameFromRule(rule) {
        return rule.slice(rule.indexOf(' ') + 1);
    }


    toArray() {
        const out = [],
            toUnicode = punycode.toUnicode;
        for ( const key of this.rules.keys() ) {
            let srcHostname = this.srcHostnameFromRule(key);
            let desHostname = this.desHostnameFromRule(key);
            for ( const type in typeBitOffsets ) {
                if ( typeBitOffsets.hasOwnProperty(type) === false ) { continue; }
                const val = this.evaluateCell(srcHostname, desHostname, type);
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
    }


    toString() {
        return this.toArray().join('\n');
    }


    fromString(text, append) {
        const lineIter = new µBlock.LineIterator(text);
        if ( append !== true ) { this.reset(); }
        while ( lineIter.eot() === false ) {
            this.addFromRuleParts(lineIter.next().trim().split(/\s+/));
        }
    }


    validateRuleParts(parts) {
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
    }


    addFromRuleParts(parts) {
        if ( this.validateRuleParts(parts) !== undefined ) {
            this.setCell(parts[0], parts[1], parts[2], nameToActionMap[parts[3]]);
            return true;
        }
        return false;
    }


    removeFromRuleParts(parts) {
        if ( this.validateRuleParts(parts) !== undefined ) {
            this.setCell(parts[0], parts[1], parts[2], 0);
            return true;
        }
        return false;
    }


    toSelfie() {
        return {
            magicId: this.magicId,
            rules: Array.from(this.rules)
        };
    }


    fromSelfie(selfie) {
        if ( selfie.magicId !== this.magicId ) { return false; }
        this.rules = new Map(selfie.rules);
        this.changed = true;
        return true;
    }


    async benchmark() {
        const requests = await µBlock.loadBenchmarkDataset();
        if ( Array.isArray(requests) === false || requests.length === 0 ) {
            log.print('No requests found to benchmark');
            return;
        }
        log.print(`Benchmarking sessionFirewall.evaluateCellZY()...`);
        const fctxt = µBlock.filteringContext.duplicate();
        const t0 = self.performance.now();
        for ( const request of requests ) {
            fctxt.setURL(request.url);
            fctxt.setTabOriginFromURL(request.frameUrl);
            fctxt.setType(request.cpt);
            this.evaluateCellZY(
                fctxt.getTabHostname(),
                fctxt.getHostname(),
                fctxt.type
            );
        }
        const t1 = self.performance.now();
        const dur = t1 - t0;
        log.print(`Evaluated ${requests.length} requests in ${dur.toFixed(0)} ms`);
        log.print(`\tAverage: ${(dur / requests.length).toFixed(3)} ms per request`);
    }
};

Matrix.prototype.intToActionMap = new Map([
    [ 1, 'block' ],
    [ 2, 'allow' ],
    [ 3, 'noop' ]
]);

Matrix.prototype.magicId = 1;

/******************************************************************************/

µBlock.Firewall = Matrix;

// <<<<< end of local scope
}

/******************************************************************************/

µBlock.sessionFirewall = new µBlock.Firewall();
µBlock.permanentFirewall = new µBlock.Firewall();

/******************************************************************************/
