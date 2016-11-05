/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 The uBlock Origin authors

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

// For background page or non-background pages

'use strict';

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1067
// https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/String/startsWith
// Firefox 17/Chromium 41 supports `startsWith`.

if ( String.prototype.startsWith instanceof Function === false ) {
    String.prototype.startsWith = function(needle, pos) {
        if ( typeof pos !== 'number' ) {
            pos = 0;
        }
        return this.lastIndexOf(needle, pos) === pos;
    };
}

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1067
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/endsWith
// Firefox 17/Chromium 41 supports `endsWith`.

if ( String.prototype.endsWith instanceof Function === false ) {
    String.prototype.endsWith = function(needle, pos) {
        if ( typeof pos !== 'number' ) {
            pos = this.length;
        }
        pos -= needle.length;
        return this.indexOf(needle, pos) === pos;
    };
}

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1070
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set#Browser_compatibility
// This polyfill is designed to fulfill *only* what uBlock Origin needs -- this
// is not an accurate API of the real Set() type.

if ( self.Set instanceof Function === false ) {
    self.Set = function(iter) {
        this.clear();
        if ( Array.isArray(iter) ) {
            for ( var i = 0, n = iter.length; i < n; i++ ) {
                this.add(iter[i]);
            }
            return;
        }
    };

    self.Set.polyfill = true;

    self.Set.prototype.clear = function() {
        this._set = Object.create(null);
        this.size = 0;
        // Iterator stuff
        this._values = undefined;
        this._i = undefined;
        this.value = undefined;
        this.done = true;
    };

    self.Set.prototype.add = function(k) {
        if ( this._set[k] === undefined ) {
            this._set[k] = true;
            this.size += 1;
        }
        return this;
    };

    self.Set.prototype.delete = function(k) {
        if ( this._set[k] !== undefined ) {
            delete this._set[k];
            this.size -= 1;
            return true;
        }
        return false;
    };

    self.Set.prototype.has = function(k) {
        return this._set[k] !== undefined;
    };

    self.Set.prototype.next = function() {
        if ( this._i < this.size ) {
            this.value = this._values[this._i++];
        } else {
            this._values = undefined;
            this.value = undefined;
            this.done = true;
        }
        return this;
    };

    self.Set.prototype.values = function() {
        this._values = Object.keys(this._set);
        this._i = 0;
        this.value = undefined;
        this.done = false;
        return this;
    };
}

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1070
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set#Browser_compatibility
// This polyfill is designed to fulfill *only* what uBlock Origin needs -- this
// is not an accurate API of the real Map() type.

if ( self.Map instanceof Function === false ) {
    self.Map = function(iter) {
        this.clear();
        if ( Array.isArray(iter) ) {
            for ( var i = 0, n = iter.length, entry; i < n; i++ ) {
                entry = iter[i];
                this.set(entry[0], entry[1]);
            }
            return;
        }
    };

    self.Map.polyfill = true;

    self.Map.prototype.clear = function() {
        this._map = Object.create(null);
        this.size = 0;
        // Iterator stuff
        this._keys = undefined;
        this._i = undefined;
        this.value = undefined;
        this.done = true;
    };

    self.Map.prototype.delete = function(k) {
        if ( this._map[k] !== undefined ) {
            delete this._map[k];
            this.size -= 1;
            return true;
        }
        return false;
    };

    self.Map.prototype.entries = function() {
        this._keys = Object.keys(this._map);
        this._i = 0;
        this.value = [ undefined, undefined ];
        this.done = false;
        return this;
    };

    self.Map.prototype.get = function(k) {
        return this._map[k];
    };

    self.Map.prototype.has = function(k) {
        return this._map[k] !== undefined;
    };

    self.Map.prototype.next = function() {
        if ( this._i < this.size ) {
            var key = this._keys[this._i++];
            this.value[0] = key;
            this.value[1] = this._map[key];
        } else {
            this._keys = undefined;
            this.value = undefined;
            this.done = true;
        }
        return this;
    };

    self.Map.prototype.set = function(k, v) {
        if ( v !== undefined ) {
            if ( this._map[k] === undefined ) {
                this.size += 1;
            }
            this._map[k] = v;
        } else {
            if ( this._map[k] !== undefined ) {
                this.size -= 1;
            }
            delete this._map[k];
        }
        return this;
    };
}

/******************************************************************************/
