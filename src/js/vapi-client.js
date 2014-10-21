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
        // following messages too, however with the following line it won't
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
            details.type = 'xmlhttprequest';
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
        else if (typeof response === 'string') {
            if (details.type === 'script') {
                e.preventDefault();
                return response;
            }
            else if (details.type === 'script') {
                e.preventDefault();
                details = document.createElement('script');
                details.textContent = atob(response.slice(35));
                e.target.parentNode.insertBefore(details, e.target);
                details.parentNode.removeChild(details);
            }
        }
    };

    document.addEventListener('beforeload', onBeforeLoad, true);

    // intercepting xhr requests
    setTimeout(function() {
        var randomEventName = parseInt(Math.random() * 1e15, 10).toString(36);
        var beforeLoadEvent = document.createEvent('Event');
        beforeLoadEvent.initEvent('beforeload');

        window.addEventListener(randomEventName, function(e) {
            var result = onBeforeLoad(beforeLoadEvent, e.detail);

            if (onBeforeLoad(beforeLoadEvent, e.detail) === false) {
                e.detail.url = false;
            }
            else if (typeof result === 'string') {
                e.detail.url = result;
            }
        }, true);

        // since the extension context is unable to reach the page context
        var tempScript = document.createElement('script');
        tempScript.onload = function() {
            this.parentNode.removeChild(this);
        };
        document.head.appendChild(tempScript).src = "data:application/x-javascript;base64," + btoa(["(function() {",
            "var xhr_open = XMLHttpRequest.prototype.open;",

            "XMLHttpRequest.prototype.open = function(method, url, async, u, p) {",
                "var ev = document.createEvent('CustomEvent');",
                "var detail = {url: url};",
                "ev.initCustomEvent(",
                    "'" + randomEventName + "',",
                    "false, false,",
                    "detail",
                ");",
                "window.dispatchEvent(ev);",
                "if (detail.url === false) {",
                    "throw Error;",
                "}",
                "else if (typeof detail.url === 'string') {",
                    "url = detail.url;",
                "}",
                "return xhr_open.call(this, method, url, async, u, p);",
            "};",
        "})();"].join(''));
    }, 0);

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
}

})();
