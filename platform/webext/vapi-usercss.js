/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2017 Raymond Hill

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

// For content pages

/******************************************************************************/

(function() {
    if ( typeof vAPI !== 'object' ) { return; }

    vAPI.userCSS = {
        _userCSS: new Set(),
        _disabled: false,
        _send: function(add, css) {
            vAPI.messaging.send('vapi-background', {
                what: 'userCSS',
                add: add,
                css: css
            });
        },
        add: function(cssText) {
            if ( cssText === '' || this._userCSS.has(cssText) ) { return; }
            this._userCSS.add(cssText);
            if ( this._disabled ) { return; }
            this._send(true, cssText);
        },
        remove: function(cssText) {
            if ( cssText === '' ) { return; }
            if ( this._userCSS.delete(cssText) && !this._disabled ) {
                this._send(true, cssText);
                this._send(false, cssText);
            }
        },
        toggle: function(state) {
            if ( state === undefined ) { state = this._disabled; }
            if ( state !== this._disabled ) { return; }
            this._disabled = !state;
            if ( this._userCSS.size === 0 ) { return; }
            this._send(state, Array.from(this._userCSS));
        }
    };
    vAPI.hideNode = vAPI.unhideNode = function(){};
})();
