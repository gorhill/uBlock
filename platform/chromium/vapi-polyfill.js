/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015 Raymond Hill

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

/******************************************************************************/

(function() {

'use strict';

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

if ( typeof self.Set !== 'function' ) {
    self.Set = function() {
        this.clear();
    };

    self.Set.polyfill = true;

    self.Set.prototype.clear = function() {
        this._set = Object.create(null);
        this.size = 0;
    };

    self.Set.prototype.add = function(k) {
        if ( this._set[k] === undefined ) {
            this._set[k] = true;
            this.size += 1;
        }
    };

    self.Set.prototype.delete = function(k) {
        if ( this._set[k] !== undefined ) {
            delete this._set[k];
            this.size -= 1;
        }
    };

    self.Set.prototype.has = function(k) {
        return this._set[k] !== undefined;
    };
}

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1070
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set#Browser_compatibility
// This polyfill is designed to fulfill *only* what uBlock Origin needs -- this
// is not an accurate API of the real Map() type.

if ( typeof self.Map !== 'function' ) {
    self.Map = function() {
        this.clear();
    };

    self.Map.polyfill = true;

    self.Map.prototype.clear = function() {
        this._map = Object.create(null);
        this.size = 0;
    };

    self.Map.prototype.delete = function(k) {
        if ( this._map[k] !== undefined ) {
            delete this._map[k];
            this.size -= 1;
        }
    };

    self.Map.prototype.get = function(k) {
        return this._map[k];
    };

    self.Map.prototype.has = function(k) {
        return this._map[k] !== undefined;
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
    };
}

/******************************************************************************/

})();
