/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2019-present Raymond Hill

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

(function() {
    'use strict';
    // https://developers.google.com/analytics/devguides/collection/analyticsjs/
    const noopfn = function() {
    };
    const noopnullfn = function() {
        return null;
    };
    //
    const Tracker = function() {
    };
    const p = Tracker.prototype;
    p.get = noopfn;
    p.set = noopfn;
    p.send = noopfn;
    //
    const w = window;
    const gaName = w.GoogleAnalyticsObject || 'ga';
    const ga = function() {
        var len = arguments.length;
        if ( len === 0 ) {
            return;
        }
        var f = arguments[len-1];
        if ( typeof f !== 'object' || f === null || typeof f.hitCallback !== 'function' ) {
            return;
        }
        try {
            f.hitCallback();
        } catch (ex) {
        }
    };
    ga.create = function() {
        return new Tracker();
    };
    ga.getByName = noopnullfn;
    ga.getAll = function() {
        return [];
    };
    ga.remove = noopfn;
    // https://github.com/uBlockOrigin/uAssets/issues/2107
    ga.loaded = true;
    w[gaName] = ga;
    // https://github.com/gorhill/uBlock/issues/3075
    const dl = w.dataLayer;
    if ( dl instanceof Object && dl.hide instanceof Object && typeof dl.hide.end === 'function' ) {
        dl.hide.end();
    }
})();
