/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
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

    Home: https://github.com/gorhill/uBlock
*/

/* global chrome, µBlock */

// So there might be memory leaks related to the direct use of sendMessage(),
// as per https://code.google.com/p/chromium/issues/detail?id=320723. The issue
// is not marked as resolved, and the last message from chromium dev is:
//
// "You can construct Port objects (runtime.connect) and emulate sendMessage
// "behaviour. The bug is that sendMessage doesn't clean up its Ports."
//
// So the point here is to have an infrastructure which allows relying more on
// direct use of Port objects rather than going through sendMessage().

/******************************************************************************/
/*******************************************************************************

// Here this is the "server"-side implementation.
//
// Reference client-side implementation is found in:
//
//    messaging-client.js
//
// For instance, it needs to be cut & pasted for content scripts since
// I can not include in a simple way js file content from another js file.

*******************************************************************************/
/******************************************************************************/

µBlock.messaging = (function() {

/******************************************************************************/

var runtimeIdGenerator = 1;
var nameToPortMap = {};
var nameToListenerMap = {};
var nullFunc = function(){};

/******************************************************************************/

var listenerNameFromPortName = function(portName) {
    var pos = portName.indexOf('/');
    if ( pos === -1 ) {
        return '';
    }
    return portName.slice(0, pos);
};

var listenerFromPortName = function(portName) {
    return nameToListenerMap[listenerNameFromPortName(portName)];
};

/******************************************************************************/

var listen = function(portName, callback) {
    var listener = nameToListenerMap[portName];
    if ( listener && listener !== callback ) {
        throw 'Only one listener allowed';
    }
    nameToListenerMap[portName] = callback;
};

/******************************************************************************/

var tell = function(target, msg) {
    target += '/';
    for ( var portName in nameToPortMap ) {
        if ( nameToPortMap.hasOwnProperty(portName) === false ) {
            continue;
        }
        if ( portName.indexOf(target) === 0 ) {
            nameToPortMap[portName].postMessage({ id: -1, msg: msg });
        }
    }
};

/******************************************************************************/

var announce = function(msg) {
    // Background page handler
    defaultHandler(msg, null, nullFunc);

    // Extension pages & content scripts handlers
    for ( var portName in nameToPortMap ) {
        if ( nameToPortMap.hasOwnProperty(portName) === false ) {
            continue;
        }
        nameToPortMap[portName].postMessage({ id: -1, msg: msg });
    }
};

/******************************************************************************/

var onMessage = function(request, port) {
    var reqId = request.id;
    // Annoucement: dispatch everywhere.
    if ( reqId < 0 ) {
        announce(request.msg);
        return;
    }
    var listener = listenerFromPortName(port.name) || defaultHandler;
    // Being told
    if ( reqId === 0 ) {
        listener(request.msg, port.sender, nullFunc);
        return;
    }
    // Being asked
    listener(request.msg, port.sender, function(response) {
        port.postMessage({
            id: reqId,
            msg: response !== undefined ? response : null
        });
    });
};

/******************************************************************************/

// Default is for commonly used messages.

function defaultHandler(request, sender, callback) {
    var µb = µBlock;

    // Async
    switch ( request.what ) {
        case 'getAssetContent':
            return µb.assets.getLocal(request.url, callback);

        case 'loadUbiquitousAllowRules':
            return µb.loadUbiquitousWhitelists();

        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {
        case 'contextMenuEvent':
            µb.contextMenuClientX = request.clientX;
            µb.contextMenuClientY = request.clientY;
            break;

        case 'forceReloadTab':
            µb.forceReload(request.pageURL);
            break;

        case 'getUserSettings':
            response = µb.userSettings;
            break;

        case 'gotoExtensionURL':
            µb.utils.gotoExtensionURL(request.url);
            break;

        case 'gotoURL':
            µb.utils.gotoURL(request);
            break;

        case 'reloadAllFilters':
            µb.reloadPresetBlacklists(request.switches, request.update);
            break;

        case 'userSettings':
            response = µb.changeUserSettings(request.name, request.value);
            break;

        default:
            // console.error('µBlock> messaging.js / defaultHandler > unknown request: %o', request);
            break;
    }

    callback(response);
}

// https://www.youtube.com/watch?v=rrzRgUAHqc8

/******************************************************************************/

// Port disconnected, relay this information to apropriate listener.

var onDisconnect = function(port) {
    // Notify listener of the disconnection -- using a reserved message id.
    var listener = listenerFromPortName(port.name) || defaultHandler;
    var msg = {
        'what': 'disconnected',
        'which': listenerNameFromPortName(port.name)
    };
    listener(msg, port.sender, nullFunc);

    // Cleanup port if no longer in use.
    if ( nameToPortMap.hasOwnProperty(port.name) ) {
        delete nameToPortMap[port.name];
        port.onMessage.removeListener(onMessage);
        port.onDisconnect.removeListener(onDisconnect);
    }
};

/******************************************************************************/

var onConnect = function(port) {
    // We must have a port name.
    if ( typeof port.name !== 'string' || port.name === '' ) {
        console.error('µBlock> messaging.js / onConnectHandler(): no port name!');
        return;
    }

    // Ensure port name is unique
    port.name += '/' + runtimeIdGenerator++;

    nameToPortMap[port.name] = port;
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
};

/******************************************************************************/

chrome.runtime.onConnect.addListener(onConnect);

/******************************************************************************/

return {
    listen: listen,
    tell: tell,
    announce: announce,
    defaultHandler: defaultHandler
};

/******************************************************************************/

})();

/******************************************************************************/
