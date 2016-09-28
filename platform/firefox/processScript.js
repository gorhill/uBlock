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

/******************************************************************************/

// https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIProcessScriptLoader

// Some module tasks need to run once per-content process. This is the purpose
// of this content process script.

(function() {
    'use strict';

    let {processObserver} = Components.utils.import(
        Components.stack.filename.replace('processScript.js', 'frameModule.js'),
        null
    );

    processObserver.start();
})();

/******************************************************************************/
