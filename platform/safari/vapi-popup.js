/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
    Copyright (C) 2015 The µBlock authors

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

var onLoaded = function() {
    var style = document.createElement("style");
    style.textContent = "html,body,#panes{width:100%}#panes{white-space:nowrap;text-align:right}#panes > div:nth-of-type(2){display:inline-block !important}";
    var _toggle = DOMTokenList.prototype.toggle;
    DOMTokenList.prototype.toggle = function(cls, stt) {
        _toggle.apply(this, arguments);
        if(cls === "dfEnabled") {
            isThere = stt;
            setTimeout(updateSize, 0);
        }
    };
    var body = document.body, popover = safari.self;
    body.appendChild(style);
    var isThere = !!document.querySelector(".dfEnabled");
    var updateSize = function() {
        popover.width = 152 + (isThere ? 320 : 0);
        popover.height = body.clientHeight;
    };
    updateSize();
};
window.addEventListener("load", onLoaded);
})();
