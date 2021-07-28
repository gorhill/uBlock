/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2017-present Raymond Hill

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

const StaticExtFilteringHostnameDB = class {
    constructor(nBits, selfie = undefined) {
        this.nBits = nBits;
        this.timer = undefined;
        this.strToIdMap = new Map();
        this.hostnameToSlotIdMap = new Map();
        // Array of integer pairs
        this.hostnameSlots = [];
        // Array of strings (selectors and pseudo-selectors)
        this.strSlots = [];
        this.size = 0;
        if ( selfie !== undefined ) {
            this.fromSelfie(selfie);
        }
    }

    store(hn, bits, s) {
        this.size += 1;
        let iStr = this.strToIdMap.get(s);
        if ( iStr === undefined ) {
            iStr = this.strSlots.length;
            this.strSlots.push(s);
            this.strToIdMap.set(s, iStr);
            if ( this.timer === undefined ) {
                this.collectGarbage(true);
            }
        }
        const strId = iStr << this.nBits | bits;
        let iHn = this.hostnameToSlotIdMap.get(hn);
        if ( iHn === undefined ) {
            this.hostnameToSlotIdMap.set(hn, this.hostnameSlots.length);
            this.hostnameSlots.push(strId, 0);
            return;
        }
        // Add as last item.
        while ( this.hostnameSlots[iHn+1] !== 0 ) {
            iHn = this.hostnameSlots[iHn+1];
        }
        this.hostnameSlots[iHn+1] = this.hostnameSlots.length;
        this.hostnameSlots.push(strId, 0);
    }

    clear() {
        this.hostnameToSlotIdMap.clear();
        this.hostnameSlots.length = 0;
        this.strSlots.length = 0;
        this.strToIdMap.clear();
        this.size = 0;
    }

    collectGarbage(later = false) {
        if ( later === false ) {
            if ( this.timer !== undefined ) {
                self.cancelIdleCallback(this.timer);
                this.timer = undefined;
            }
            this.strToIdMap.clear();
            return;
        }
        if ( this.timer !== undefined ) { return; }
        this.timer = self.requestIdleCallback(
            ( ) => {
                this.timer = undefined;
                this.strToIdMap.clear();
            },
            { timeout: 5000 }
        );
    }

    // modifiers = 1: return only specific items
    // modifiers = 2: return only generic items
    //
    retrieve(hostname, out, modifiers = 0) {
        if ( modifiers === 2 ) {
            hostname = '';
        }
        const mask = out.length - 1; // out.length must be power of two
        for (;;) {
            let iHn = this.hostnameToSlotIdMap.get(hostname);
            if ( iHn !== undefined ) {
                do {
                    const strId = this.hostnameSlots[iHn+0];
                    out[strId & mask].add(
                        this.strSlots[strId >>> this.nBits]
                    );
                    iHn = this.hostnameSlots[iHn+1];
                } while ( iHn !== 0 );
            }
            if ( hostname === '' ) { break; }
            const pos = hostname.indexOf('.');
            if ( pos === -1 ) {
                if ( modifiers === 1 ) { break; }
                hostname = '';
            } else {
                hostname = hostname.slice(pos + 1);
            }
        }
    }

    hasStr(hostname, exceptionBit, value) {
        let found = false;
        for (;;) {
            let iHn = this.hostnameToSlotIdMap.get(hostname);
            if ( iHn !== undefined ) {
                do {
                    const strId = this.hostnameSlots[iHn+0];
                    const str = this.strSlots[strId >>> this.nBits];
                    if ( (strId & exceptionBit) !== 0 ) {
                        if ( str === value || str === '' ) { return false; }
                    }
                    if ( str === value ) { found = true; }
                    iHn = this.hostnameSlots[iHn+1];
                } while ( iHn !== 0 );
            }
            if ( hostname === '' ) { break; }
            const pos = hostname.indexOf('.');
            if ( pos !== -1 ) {
                hostname = hostname.slice(pos + 1);
            } else if ( hostname !== '*' ) {
                hostname = '*';
            } else {
                hostname = '';
            }
        }
        return found;
    }

    toSelfie() {
        return {
            hostnameToSlotIdMap: Array.from(this.hostnameToSlotIdMap),
            hostnameSlots: this.hostnameSlots,
            strSlots: this.strSlots,
            size: this.size
        };
    }

    fromSelfie(selfie) {
        if ( selfie === undefined ) { return; }
        this.hostnameToSlotIdMap = new Map(selfie.hostnameToSlotIdMap);
        this.hostnameSlots = selfie.hostnameSlots;
        this.strSlots = selfie.strSlots;
        this.size = selfie.size;
    }
};

/******************************************************************************/

const StaticExtFilteringSessionDB = class {
    constructor() {
        this.db = new Map();
    }
    compile(s) {
        return s;
    }
    add(bits, s) {
        const bucket = this.db.get(bits);
        if ( bucket === undefined ) {
            this.db.set(bits, new Set([ s ]));
        } else {
            bucket.add(s);
        }
    }
    remove(bits, s) {
        const bucket = this.db.get(bits);
        if ( bucket === undefined ) { return; }
        bucket.delete(s);
        if ( bucket.size !== 0 ) { return; }
        this.db.delete(bits);
    }
    retrieve(out) {
        const mask = out.length - 1;
        for ( const [ bits, bucket ] of this.db ) {
            const i = bits & mask;
            if ( out[i] instanceof Object === false ) { continue; }
            for ( const s of bucket ) {
                out[i].add(s);
            }
        }
    }
    has(bits, s) {
        const selectors = this.db.get(bits);
        return selectors !== undefined && selectors.has(s);
    }
    clear() {
        this.db.clear();
    }
    get isNotEmpty() {
        return this.db.size !== 0;
    }
};

/******************************************************************************/

export {
    StaticExtFilteringHostnameDB,
    StaticExtFilteringSessionDB,
};

/******************************************************************************/
