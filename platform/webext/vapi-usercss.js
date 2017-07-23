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
        _userCSS: '',
        _disabled: false,
        _send: function(toRemove, toAdd) {
            vAPI.messaging.send('vapi-background', {
                what: 'userCSS',
                toRemove: toRemove,
                toAdd: toAdd
            });
        },
        add: function(cssText) {
            if ( cssText === '' ) { return; }
            var before = this._userCSS,
                after = before;
            if ( after !== '' ) { after += '\n'; }
            after += cssText;
            this._userCSS = after;
            if ( this._disabled ) { return; }
            this._send(before, after);
        },
        remove: function(cssText) {
            if ( cssText === '' || this._userCSS === '' ) { return; }
            var before = this._userCSS,
                after = before;
            after = before.replace(cssText, '').trim();
            this._userCSS = after;
            if ( this._disabled ) { return; }
            this._send(before, after);
        },
        toggle: function(state) {
            if ( state === undefined ) {
                state = this._disabled;
            }
            if ( state !== this._disabled ) { return; }
            this._disabled = !state;
            if ( this._userCSS === '' ) { return; }
            var toAdd, toRemove; 
            if ( state ) {
                toAdd = this._userCSS;
            } else {
                toRemove = this._userCSS;
            }
            this._send(toRemove, toAdd);
        }
    };
    vAPI.hideNode = vAPI.unhideNode = function(){};
})();
