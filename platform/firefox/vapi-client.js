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

/* global addMessageListener, removeMessageListener, sendAsyncMessage */

// For non background pages

/******************************************************************************/

(function(self) {

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

    if ( response.broadcast === true && !response.channelName ) {
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
        channel = channels[response.channelName];
        listener = channel && channel.listener;
    }

    if ( typeof listener === 'function' ) {
        listener(response.msg);
    }
};

/******************************************************************************/

vAPI.messaging = {
    channels: {},
    listeners: {},
    requestId: 1,

    setup: function() {
        this.connector = function(msg) {
            messagingConnector(JSON.parse(msg));
        };

        addMessageListener(this.connector);

        this.channels['vAPI'] = {};
        this.channels['vAPI'].listener = function(msg) {
            if ( msg.cmd === 'injectScript' ) {
                var details = msg.details;

                if ( !details.allFrames && window !== window.top ) {
                    return;
                }

                self.injectScript(details.file);
            }
        };
    },

    close: function() {
        if ( !this.connector ) {
            return;
        }

        removeMessageListener();
        this.connector = null;
        this.channels = {};
        this.listeners = {};
    },

    channel: function(channelName, callback) {
        if ( !channelName ) {
            return;
        }

        this.channels[channelName] = {
            channelName: channelName,
            listener: typeof callback === 'function' ? callback : null,
            send: function(message, callback) {
                if ( !vAPI.messaging.connector ) {
                    vAPI.messaging.setup();
                }

                message = {
                    channelName: self._sandboxId_ + '|' + this.channelName,
                    msg: message
                };

                if ( callback ) {
                    message.requestId = vAPI.messaging.requestId++;
                    vAPI.messaging.listeners[message.requestId] = callback;
                }

                sendAsyncMessage('ublock:background', message);
            },
            close: function() {
                delete vAPI.messaging.channels[this.channelName];
            }
        };

        return this.channels[channelName];
    },

    toggleListener: function({type, persisted}) {
        if ( !vAPI.messaging.connector ) {
            return;
        }

        if ( type === 'pagehide' ) {
            removeMessageListener();
            return;
        }

        if ( persisted ) {
            addMessageListener(vAPI.messaging.connector);
        }
    }
};

window.addEventListener('pagehide', vAPI.messaging.toggleListener, true);
window.addEventListener('pageshow', vAPI.messaging.toggleListener, true);

/******************************************************************************/

})(this);

/******************************************************************************/
