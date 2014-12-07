/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
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

// For non background pages

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

self.vAPI = self.vAPI || {};
vAPI.firefox = true;

/******************************************************************************/

var messagingConnector = function(response) {
    if ( !response ) {
        return;
    }

    var channels = vAPI.messaging.channels;
    var channel, listener;

    if ( response.broadcast === true ) {
        for ( channel in channels ) {
            if ( channels.hasOwnProperty(channel) === false ) {
                continue;
            }
            listener = channels[channel].listener;
            if ( typeof listener === 'function' ) {
                listener(response.msg);
            }
        }
        return;
    }

    if ( response.requestId ) {
        listener = vAPI.messaging.listeners[response.requestId];
        delete vAPI.messaging.listeners[response.requestId];
        delete response.requestId;
    }

    if ( !listener ) {
        channel = channels[response.portName];
        listener = channel && channel.listener;
    }

    if ( typeof listener === 'function' ) {
        listener(response.msg);
    }
};

/******************************************************************************/

var uniqueId = function() {
    return parseInt(Math.random() * 1e10, 10).toString(36);
};

/******************************************************************************/

vAPI.messaging = {
    channels: {},
    listeners: {},
    requestId: 1,
    connectorId: uniqueId(),

    setup: function() {
        this.connector = function(msg) {
            messagingConnector(JSON.parse(msg));
        };
        addMessageListener(this.connectorId, this.connector);
    },

    close: function() {
        if (this.connector) {
            removeMessageListener(this.connectorId, this.connector);
            this.connector = null;
            this.channels = {};
            this.listeners = {};
        }
    },

    channel: function(channelName, callback) {
        if ( !channelName ) {
            return;
        }

        this.channels[channelName] = {
            portName: channelName,
            listener: typeof callback === 'function' ? callback : null,
            send: function(message, callback) {
                if ( !vAPI.messaging.connector ) {
                    vAPI.messaging.setup();
                }

                message = {
                    portName: vAPI.messaging.connectorId + '|' + this.portName,
                    msg: message
                };

                if ( callback ) {
                    message.requestId = vAPI.messaging.requestId++;
                    vAPI.messaging.listeners[message.requestId] = callback;
                }

                sendAsyncMessage('ublock:background', message);
            },
            close: function() {
                delete vAPI.messaging.channels[this.portName];
            }
        };

        return this.channels[channelName];
    }
};

/******************************************************************************/

vAPI.canExecuteContentScript = function() {
    return true;
};

/******************************************************************************/

})();

/******************************************************************************/
