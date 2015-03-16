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

var DF_ENABLED_CLASS = "dfEnabled";

var onLoaded = function() {
    var _toggle = DOMTokenList.prototype.toggle;
    DOMTokenList.prototype.toggle = function(className) {
        _toggle.apply(this, arguments);
        if(className === DF_ENABLED_CLASS) {
            setTimeout(updateSize, 0);
        }
    };
    var body = document.body, popover = safari.self;
    
    var style = document.createElement("style");
    style.textContent = "html,body,#panes{width:100%}#panes{white-space:nowrap;text-align:right}#panes > div:nth-of-type(2){display:inline-block !important}";
    body.appendChild(style);

    var panes = document.getElementById("panes"),
        powerAndStatsPane = panes.children[0],
        dfPane = panes.children[1];

    var updateSize = function() {
        var dfEnabled = panes.classList.contains(DF_ENABLED_CLASS);
        popover.width = powerAndStatsPane.clientWidth + (dfEnabled ? dfPane.clientWidth : 0);
        popover.height = body.clientHeight;
    };
    updateSize();
};
window.addEventListener("load", onLoaded);
})();
