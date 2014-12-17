/*******************************************************************************

    µBlock - a browser extension to block requests.
    Copyright (C) 2014 The µBlock authors

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

/* globals Services, sendAsyncMessage, addMessageListener, removeMessageListener */

'use strict';

/******************************************************************************/

(function(frameScriptContext) {

'use strict';

/******************************************************************************/

let appName;
let listeners = {};

try { throw new Error; } catch (ex) {
    appName = ex.fileName.match(/:\/\/([^\/]+)/)[1];
}

Components.utils['import']('chrome://' + appName + '/content/frameModule.js', {});

/******************************************************************************/

frameScriptContext[appName + '_addMessageListener'] = function(id, fn) {
    frameScriptContext[appName + '_removeMessageListener'](id);
    listeners[id] = function(msg) {
        fn(msg.data);
    };
    addMessageListener(id, listeners[id]);
};

frameScriptContext[appName + '_removeMessageListener'] = function(id) {
    if (listeners[id]) {
        removeMessageListener(id, listeners[id]);
    }

    delete listeners[id];
};

/******************************************************************************/

addMessageListener(appName + ':broadcast', function(msg) {
    for (let id in listeners) {
        listeners[id](msg);
    }
});

/******************************************************************************/

})(this);

/******************************************************************************/
