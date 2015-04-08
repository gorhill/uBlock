/*******************************************************************************

    µBlock - a browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

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

    Home: https://github.com/chrisaljoudi/uBlock
*/

/* global µBlock */
'use strict';

/******************************************************************************/

µBlock.XAL = (function(){

/******************************************************************************/

var exports = {};
var noopFunc = function(){};


/******************************************************************************/

exports.keyvalSetOne = function(key, val, callback) {
    var bin = {};
    bin[key] = val;
    vAPI.storage.set(bin, callback || noopFunc);
};

/******************************************************************************/

exports.keyvalSetMany = function(dict, callback) {
    vAPI.storage.set(dict, callback || noopFunc);
};

/******************************************************************************/

exports.keyvalRemoveOne = function(key, callback) {
    vAPI.storage.remove(key, callback || noopFunc);
};

/******************************************************************************/

exports.keyvalRemoveAll = function(callback) {
    vAPI.storage.clear(callback || noopFunc);
};

/******************************************************************************/

return exports;

/******************************************************************************/

})();
