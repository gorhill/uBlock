// » header
/* global addMessageListener, removeMessageListener, sendAsyncMessage */
// for non background pages

(function() {
'use strict';

self.vAPI = self.vAPI || {};

// since this is common across vendors
var messagingConnector = function(response) {
    var channel, listener;

    if (!response) {
        return;
    }

    if (response.broadcast === true) {
        for (channel in vAPI.messaging.channels) {
            listener = vAPI.messaging.channels[channel].listener;

            if (typeof listener === 'function') {
                listener(response.msg);
            }
        }

        return;
    }

    if (response.requestId) {
        listener = vAPI.messaging.listeners[response.requestId];
        delete vAPI.messaging.listeners[response.requestId];
        delete response.requestId;
    }

    if (!listener) {
        channel = vAPI.messaging.channels[response.portName];
        listener = channel && channel.listener;
    }

    if (typeof listener === 'function') {
        listener(response.msg);
    }
};

var uniqueId = function() {
    return parseInt(Math.random() * 1e10, 10).toString(36);
};
// «

if (self.chrome) {
    // » crx
    vAPI.chrome = true;
    vAPI.messaging = {
        port: null,
        channels: {},
        listeners: {},
        requestId: 0,
        connectorId: uniqueId(),
        setup: function() {
            this.port = chrome.runtime.connect({name: this.connectorId});
            this.port.onMessage.addListener(messagingConnector);
        },
        close: function() {
            if (this.port) {
                this.port.disconnect();
                this.port.onMessage.removeListener(messagingConnector);
                this.port = this.channels = this.listeners = this.connectorId = null;
            }
        },
        channel: function(channelName, callback) {
            if (!channelName) {
                return;
            }

            this.channels[channelName] = {
                portName: channelName,
                listener: typeof callback === 'function' ? callback : null,
                send: function(message, callback) {
                    if (!vAPI.messaging.port) {
                        vAPI.messaging.setup();
                    }

                    message = {
                        portName: this.portName,
                        msg: message
                    };

                    if (callback) {
                        message.requestId = ++vAPI.messaging.requestId;
                        vAPI.messaging.listeners[message.requestId] = callback;
                    }

                    vAPI.messaging.port.postMessage(message);
                },
                close: function() {
                    delete vAPI.messaging.channels[this.portName];
                }
            };

            return this.channels[channelName];
        }
    };
    // «
} else if (self.safari) {
    // » safariextz
    vAPI.safari = true;

    // relevant?
    // https://developer.apple.com/library/safari/documentation/Tools/Conceptual/SafariExtensionGuide/MessagesandProxies/MessagesandProxies.html#//apple_ref/doc/uid/TP40009977-CH14-SW12
    vAPI.messaging = {
        channels: {},
        listeners: {},
        requestId: 0,
        connectorId: uniqueId(),
        setup: function() {
            this._connector = function(msg) {
                // messages from the background script are sent to every frame,
                // so we need to check the connectorId to accept only
                // what is meant for the current context
                if (msg.name === vAPI.messaging.connectorId
                    || msg.name === 'broadcast') {
                    messagingConnector(msg.message);
                }
            };
            safari.self.addEventListener('message', this._connector, false);

            this.channels['vAPI'] = {
                listener: function(msg) {
                    if (msg.cmd === 'runScript' && msg.details.code) {
                        Function(msg.details.code).call(self);
                    }
                }
            };
        },
        close: function() {
            if (this._connector) {
                safari.self.removeEventListener('message', this._connector, false);
                this.channels = this.listeners = null;
            }
        },
        channel: function(channelName, callback) {
            if (!channelName) {
                return;
            }

            this.channels[channelName] = {
                portName: channelName,
                listener: typeof callback === 'function' ? callback : null,
                send: function(message, callback) {
                    if (!vAPI.messaging._connector) {
                        vAPI.messaging.setup();
                    }

                    message = {
                        portName: this.portName,
                        msg: message
                    };

                    if (callback) {
                        message.requestId = ++vAPI.messaging.requestId;
                        vAPI.messaging.listeners[message.requestId] = callback;
                    }

                    if (safari.extension.globalPage) {
                        // popover content doesn't know messaging...
                        safari.extension.globalPage.contentWindow
                            .vAPI.messaging.connector({
                                name: vAPI.messaging.connectorId,
                                message: message,
                                target: {
                                    page: {
                                        dispatchMessage: function(name, msg) {
                                            messagingConnector(msg);
                                        }
                                    }
                                }
                            });
                    }
                    else {
                        safari.self.tab.dispatchMessage(vAPI.messaging.connectorId, message);
                    }
                },
                close: function() {
                    delete vAPI.messaging.channels[this.portName];
                }
            };

            return this.channels[channelName];
        }
    };

    if (location.protocol === "safari-extension:") {
        return;
    }

    var beforeLoadEvent = document.createEvent('Event');
    beforeLoadEvent.initEvent('beforeload');

    var linkHelper = document.createElement('a');
    var onBeforeLoad = function(e, details) {
        if (e.url && e.url.slice(0, 5) === 'data:') {
            return;
        }

        linkHelper.href = details ? details.url : e.url;

        if (!/^https?:/.test(linkHelper.protocol)) {
            return;
        }

        if (details) {
            details.url = linkHelper.href;
        }
        else {
            details = {
                url: linkHelper.href
            };

            switch (e.target.nodeName.toLowerCase()) {
                case 'frame':
                case 'iframe':
                    details.type = 'sub_frame';
                    break;
                case 'script':
                    details.type = 'script';
                    break;
                case 'img':
                case 'input': // type=image
                    details.type = 'image';
                    break;
                case 'object':
                case 'embed':
                    details.type = 'object';
                    break;
                case 'link':
                    var rel = e.target.rel.trim().toLowerCase();

                    if (rel.indexOf('icon') > -1) {
                        details.type = 'image';
                        break;
                    }
                    else if (rel === 'stylesheet') {
                        details.type = 'stylesheet';
                        break;
                    }
                default:
                    details.type = 'other';
            }

            // This can run even before the first DOMSubtreeModified event fired
            if (firstMutation) {
                firstMutation();
            }
        }

        // tabId is determined in the background script
        // details.tabId = null;
        details.frameId = 0;
        details.parentFrameId = window === window.top ? -1 : 0;
        details.timeStamp = Date.now();

        var response = safari.self.tab.canLoad(e, details);

        if (!response) {
            if (details.type === 'main_frame') {
                window.stop();
                throw new Error;
            }
            else {
                e.preventDefault();
            }
            return false;
        }
        // local mirroring, response is a data: URL here
        else if (typeof response === 'string' && details.type === 'script') {
            // Content Security Policy with disallowed inline scripts may break things
            e.preventDefault();
            details = document.createElement('script');
            details.textContent = atob(response.slice(response.indexOf(',', 20) + 1));
            e.target.parentNode.insertBefore(details, e.target);
            details.parentNode.removeChild(details);
        }
    };

    document.addEventListener('beforeload', onBeforeLoad, true);

    // block pop-ups, intercept xhr requests, and apply site patches
    var firstMutation = function() {
        document.removeEventListener('DOMSubtreeModified', firstMutation, true);
        firstMutation = null;
        var randEventName = parseInt(Math.random() * 1e15, 10).toString(36);

        window.addEventListener(randEventName, function(e) {
            var result = onBeforeLoad(beforeLoadEvent, e.detail);

            if (result === false) {
                e.detail.url = false;
            }
        }, true);

        // the extension context is unable to reach the page context,
        // also this only works when Content Security Policy allows inline scripts
        var tmpJS = document.createElement('script');
        var tmpScript = ["(function() {",
            "var block = function(u, t) {",
                "var e = document.createEvent('CustomEvent'),",
                    "d = {url: u, type: t};",
                "e.initCustomEvent('" + randEventName + "', !1, !1, d);",
                "dispatchEvent(e);",
                "return d.url === !1;",
            "}, wo = open, xo = XMLHttpRequest.prototype.open;",
            "open = function(u) {",
                "return block(u, 'popup') ? null : wo.apply(this, [].slice.call(arguments));",
            "};",
            "XMLHttpRequest.prototype.open = function(m, u) {",
                "return block(u, 'xmlhttprequest') ? null : xo.apply(this, [].slice.call(arguments));",
            "};"
        ];

        if (vAPI.sitePatch
            && !safari.self.tab.canLoad(beforeLoadEvent, {isWhiteListed: location.href})) {
            tmpScript.push('(' + vAPI.sitePatch + ')();');
        }

        tmpScript.push("})();");
        tmpJS.textContent = tmpScript.join('');
        document.documentElement.removeChild(document.documentElement.appendChild(tmpJS));
    };

    document.addEventListener('DOMSubtreeModified', firstMutation, true);

    var onContextMenu = function(e) {
        var details = {
            tagName: e.target.tagName.toLowerCase(),
            pageUrl: window.location.href,
            insideFrame: window.top !== window
        };

        details.editable = details.tagName === 'textarea' || details.tagName === 'input';

        if ('checked' in e.target) {
            details.checked = e.target.checked;
        }

        if (details.tagName === 'a') {
            details.linkUrl = e.target.href;
        }

        if ('src' in e.target) {
            details.srcUrl = e.target.src;

            if (details.tagName === 'img') {
                details.mediaType = 'image';
            }
            else if (details.tagName === 'video' || details.tagName === 'audio') {
                details.mediaType = details.tagName;
            }
        }

        safari.self.tab.setContextMenuEventUserInfo(e, details);
    };

    self.addEventListener('contextmenu', onContextMenu, true);

    // 'main_frame' simulation
    onBeforeLoad(beforeLoadEvent, {
        url: window.location.href,
        type: 'main_frame'
    });
    // «
}
// » footer
})();
// «