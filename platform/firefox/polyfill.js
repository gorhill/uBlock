/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2016 The uBlock Origin authors

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

// Patching for Pale Moon which does not implement ES6 Set/Map.
// Test for non-ES6 Set/Map: check if property `iterator` is present.
// The code is strictly to satisfy uBO's core, not to be an accurate
// implementation of ES6.

if ( self.Set.prototype.iterator instanceof Function ) {
    //console.log('Patching non-ES6 Set() to be more ES6-like.');
    self.Set.prototype._values = self.Set.prototype.values;
    self.Set.prototype.values = function() {
        this._valueIter = this._values();
        this.value = undefined;
        this.done = false;
        return this;
    };
    self.Set.prototype.next = function() {
        try {
            this.value = this._valueIter.next();
        } catch (ex) {
            this._valueIter = undefined;
            this.value = undefined;
            this.done = true;
        }
        return this;
    };
}

if ( self.Map.prototype.iterator instanceof Function ) {
    //console.log('Patching non-ES6 Map() to be more ES6-like.');
    self.Map.prototype._entries = self.Map.prototype.entries;
    self.Map.prototype.entries = function() {
        this._entryIter = this._entries();
        this.value = undefined;
        this.done = false;
        return this;
    };
    self.Map.prototype.next = function() {
        try {
            this.value = this._entryIter.next();
        } catch (ex) {
            this._entryIter = undefined;
            this.value = undefined;
            this.done = true;
        }
        return this;
    };
}

