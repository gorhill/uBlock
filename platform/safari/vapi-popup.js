/*******************************************************************************

    uBlock - a browser extension to block requests.
    Copyright (C) 2015 The uBlock authors

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
(function() {
"use strict";

if(typeof safari.self === "undefined") {
    return;
}

var onLoaded = function() {
    var _toggle = DOMTokenList.prototype.toggle;
    DOMTokenList.prototype.toggle = function(className, enabled) {
        if(className === "dfEnabled") {
            updateSize(enabled);
        }
        _toggle.apply(this, arguments);
        if(className === "dfEnabled") {
            setTimeout(updateSize, 0);
        }
    };
    var body = document.body,
        popover = safari.self,
        panes = document.getElementById("panes"),
        pane1 = panes.children[0],
        pane2 = panes.children[1];
    
    body.style.width = "100%";
    panes.style.width = "100%";
    
    var updateSize = function(isOpen) {
        var w = pane2.clientWidth;
        if(typeof isOpen === "undefined") {
            isOpen = (w !== 0);
        }
        popover.width = (isOpen ? w : 0) + pane1.clientWidth;
        popover.height = body.clientHeight;
    };

    setTimeout(updateSize, 0);
};

window.addEventListener("load", onLoaded);
})();
