/* global addMessageListener, removeMessageListener, sendAsyncMessage */
// for non background pages

(function() {
'use strict';

window.vAPI = window.vAPI || {};

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
    }

    if (!listener) {
        channel = vAPI.messaging.channels[response.portName];
        listener = channel && channel.listener;
    }

    if (typeof listener === 'function') {
        // Safari bug
        // Deleting the response.requestId below (only in some cases, probably
        // when frames are present on the page) will remove it from all the
        // future messages too, however with the following line it won't.
        vAPI.safari && console.log;

        delete vAPI.messaging.listeners[response.requestId];
        delete response.requestId;
        listener(response.msg);
    }
};

if (window.chrome) {
    vAPI.chrome = true;
    vAPI.messaging = {
        port: null,
        requestId: 0,
        listenerId: null,
        listeners: {},
        channels: {},
        connector: messagingConnector,
        setup: function() {
            this.listenerId = 'uBlock:' + name + ':' + parseInt(Math.random() * 1e10, 10).toString(36);
            this.port = chrome.runtime.connect({name: this.listenerId});
            this.port.onMessage.addListener(this.connector);
        },
        close: function() {
            if (this.port) {
                this.port.disconnect();
                this.port.onMessage.removeListener(this.connector);
                this.channels = this.listeners = this.port = this.listenerId = null;
            }
        },
        channel: function(name, callback) {
            if (!name) {
                return;
            }

            if (!this.listenerId) {
                this.setup();
            }

            this.channels[name] = {
                portName: name,
                listener: typeof callback === 'function' ? callback : null,
                send: function(message, callback) {
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

            return this.channels[name];
        }
    };
} else if (window.safari) {
    vAPI.safari = true;

    // relevant?
    // https://developer.apple.com/library/safari/documentation/Tools/Conceptual/SafariExtensionGuide/MessagesandProxies/MessagesandProxies.html#//apple_ref/doc/uid/TP40009977-CH14-SW12
    vAPI.messaging = {
        requestId: 0,
        listeners: {},
        channels: {},
        connector: messagingConnector,
        setup: function() {
            this._connector = function(msg) {
                vAPI.messaging.connector(msg.message);
            };
            safari.self.addEventListener('message', this._connector, false);

            this.channels['vAPI'] = {
                listener: function(msg) {
                    if (msg.cmd === 'runScript' && msg.details.code) {
                        Function(msg.details.code).call(window);
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
        channel: function(name, callback) {
            if (!name) {
                return;
            }

            if (!this._connector) {
                this.setup();
            }

            this.channels[name] = {
                portName: name,
                listener: typeof callback === 'function' ? callback : null,
                send: function(message, callback) {
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
                                name: 'message',
                                message: message,
                                target: {
                                    page: {
                                        dispatchMessage: function(name, msg) {
                                            vAPI.messaging.connector(msg);
                                        }
                                    }
                                }
                            });
                    }
                    else {
                        safari.self.tab.dispatchMessage('message', message);
                    }
                },
                close: function() {
                    delete vAPI.messaging.channels[this.portName];
                }
            };

            return this.channels[name];
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
            e.preventDefault();
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

    // blocking pop-ups and intercepting xhr requests
    var firstMutation = function() {
        document.removeEventListener('DOMSubtreeModified', firstMutation, true);
        firstMutation = null;
        var randomEventName = parseInt(Math.random() * 1e15, 10).toString(36);

        window.addEventListener(randomEventName, function(e) {
            var result = onBeforeLoad(beforeLoadEvent, e.detail);

            if (result === false) {
                e.detail.url = false;
            }
        }, true);

        // the extension context is unable to reach the page context,
        // also this only works when Content Security Policy allows inline scripts
        var tmpJS = document.createElement('script');
        tmpJS.textContent = ["(function() {",
            "var block = function(u, t) {",
                "var e = document.createEvent('CustomEvent'),",
                    "d = {url: u, type: t};",
                "e.initCustomEvent(",
                    "'" + randomEventName + "', !1, !1, d",
                ");",
                "dispatchEvent(e);",
                "return d.url === !1;",
            "}, wo = open, xo = XMLHttpRequest.prototype.open;",
            "open = function(u) {",
                "return block(u, 'popup') ? null : wo.apply(this, [].slice.call(arguments));",
            "};",
            "XMLHttpRequest.prototype.open = function(m, u) {",
                "return block(u, 'xmlhttprequest') ? null : xo.apply(this, [].slice.call(arguments));",
            "};",
        "})();"].join('');
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

    window.addEventListener('contextmenu', onContextMenu, true);

    window.addEventListener('mouseup', function(e) {
        if (e.button !== 1) {
            return;
        }

        e = document.evaluate('ancestor-or-self::a[@href]', e.target, null, 9, null).singleNodeValue;

        if (e && /^https?:$/.test(e.protocol)) {
            safari.self.tab.canLoad(beforeLoadEvent, {
                middleClickURL: e.href,
                timeStamp: Date.now()
            });
        }
    }, true);
}

})();
