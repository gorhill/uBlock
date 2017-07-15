/*******************************************************************************

    uBlock - a browser extension to block requests.
    Copyright (C) 2014-2016 The uBlock authors

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

if ( typeof safari.self === 'undefined' || window.top !== window ) {
    return;
}

var onLoaded = function() {
    var _toggle = DOMTokenList.prototype.toggle;
    var unchainPane2Timeout = false;
    var unchainPane2 = function() {
        pane2.style.removeProperty('display');
    };
    DOMTokenList.prototype.toggle = function(className, enabled) {
        if ( className === 'dfEnabled' ) {
            if ( unchainPane2Timeout !== false ) {
                clearTimeout(unchainPane2Timeout);
                unchainPane2Timeout = false;
            }
            _toggle.apply(this, arguments);
            pane2.style.setProperty('display', 'inline-block', 'important');
            unchainPane2Timeout = setTimeout(unchainPane2, 400);
            updateSize(enabled);
        }
        else {
            _toggle.apply(this, arguments);
        }
    };
    var body = document.body,
        popover = safari.self,
        panes = document.getElementById('panes'),
        pane1 = panes.children[0],
        pane2 = panes.children[1];

    body.style.width = '100%';
    panes.style.width = '100%';

    var updateSize = function(isOpen) {
        var w = pane2.clientWidth;
        if ( typeof isOpen === 'undefined' ) {
            isOpen = (w !== 0);
        }
        popover.width = (isOpen ? w : 0) + pane1.clientWidth;
        popover.height = body.clientHeight;
    };

    setTimeout(updateSize, 0);
};

window.addEventListener('load', onLoaded);
})();
