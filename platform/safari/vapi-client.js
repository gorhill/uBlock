/*******************************************************************************

    uBlock - a browser extension to block requests.
    Copyright (C) 2014-2016 The uBlock authors

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

'use strict';

/******************************************************************************/

// For non background pages

(function(self) {
// https://github.com/chrisaljoudi/uBlock/issues/464
if ( document instanceof HTMLDocument === false ) {
    // https://github.com/chrisaljoudi/uBlock/issues/1528
    // A XMLDocument can be a valid HTML document.
    if (
        document instanceof XMLDocument === false ||
        document.createElement('div') instanceof HTMLDivElement === false
    ) {
        return;
    }
}

// https://github.com/gorhill/uBlock/issues/1124
// Looks like `contentType` is on track to be standardized:
//   https://dom.spec.whatwg.org/#concept-document-content-type
// https://forums.lanik.us/viewtopic.php?f=64&t=31522
//   Skip text/plain documents.
var contentType = document.contentType || '';
if ( /^image\/|^text\/plain/.test(contentType) ) {
    return;
}

var vAPI = self.vAPI = self.vAPI || {};

// https://github.com/chrisaljoudi/uBlock/issues/456
// Already injected?
if ( vAPI.sessionId ) {
    return;
}

var safari;
if ( typeof self.safari === 'undefined' ) {
    try {
        // https://github.com/el1t/uBlock-Safari/issues/23
        self.safari = self.top.safari;
    } catch(e) {}
}
safari = self.safari;

/******************************************************************************/

vAPI.randomToken = function() {
    return String.fromCharCode(Date.now() % 26 + 97) +
        Math.floor(Math.random() * 982451653 + 982451653).toString(36);
};
vAPI.sessionId = vAPI.randomToken();
vAPI.safari = true;
vAPI.setTimeout = vAPI.setTimeout || self.setTimeout.bind(self);

/******************************************************************************/

if ( navigator.userAgent.indexOf('Safari/6') === -1 ) { // If we're not on at least Safari 8
    // Polyfill performance.now()
    var startTime = Date.now();

    if ( window.performance === undefined ) {
        window.performance = {};
    }

    if ( window.performance.now === undefined ) {
        window.performance.now = function() {
            return Date.now() - startTime;
        };
    }
}

/******************************************************************************/

// Support minimally working Set() for legacy Safari.

if ( self.Set instanceof Function ) {
    self.createSet = function() {
        return new Set();
    };
} else {
    self.createSet = (function() {
        //console.log('Polyfilling for ES6-like Set().');
        var PrimitiveSet = function() {
            this.clear();
        };
        PrimitiveSet.prototype = {
            add: function(k) {
                if ( this._set[k] === undefined ) {
                    this._set[k] = true;
                    this.size += 1;
                }
                return this;
            },
            clear: function() {
                this._set = Object.create(null);
                this.size = 0;
                this._values = undefined;
                this._i = undefined;
                this.value = undefined;
                this.done = true;
            },
            delete: function(k) {
                if ( this._set[k] === undefined ) {
                    return false;
                }
                delete this._set[k];
                this.size -= 1;
                return true;
            },
            has: function(k) {
                return this._set[k] !== undefined;
            },
            next: function() {
                if ( this._i < this.size ) {
                    this.value = this._values[this._i++];
                } else {
                    this._values = undefined;
                    this.value = undefined;
                    this.done = true;
                }
                return this;
            },
            polyfill: true,
            values: function() {
                this._values = Object.keys(this._set);
                this._i = 0;
                this.value = undefined;
                this.done = false;
                return this;
            }
        };
        var ReferenceSet = function() {
            this.clear();
        };
        ReferenceSet.prototype = {
            add: function(k) {
                if ( this._set.indexOf(k) === -1 ) {
                    this._set.push(k);
                }
            },
            clear: function() {
                this._set = [];
                this._i = 0;
                this.value = undefined;
                this.done = true;
            },
            delete: function(k) {
                var pos = this._set.indexOf(k);
                if ( pos === -1 ) {
                    return false;
                }
                this._set.splice(pos, 1);
                return true;
            },
            has: function(k) {
                return this._set.indexOf(k) !== -1;
            },
            next: function() {
                if ( this._i === this._set.length ) {
                    this.value = undefined;
                    this.done = true;
                } else {
                    this.value = this._set[this._i];
                    this._i += 1;
                }
                return this;
            },
            polyfill: true,
            values: function() {
                this._i = 0;
                this.done = false;
                return this;
            }
        };
        Object.defineProperty(ReferenceSet.prototype, 'size', {
            get: function() {
                return this._set.length;
            }
        });
        return function(type) {
            return type === 'object' ? new ReferenceSet() : new PrimitiveSet();
        };
    })();
}


/******************************************************************************/

var referenceCounter = 0;

vAPI.lock = function() {
    referenceCounter += 1;
};

vAPI.unlock = function() {
    referenceCounter -= 1;
    if ( referenceCounter === 0 ) {
        // Eventually there will be code here to flush the javascript code
        // from this file out of memory when it ends up unused.

    }
};

/******************************************************************************/

vAPI.shutdown = {
    jobs: [],
    add: function(job) {
        this.jobs.push(job);
    },
    exec: function() {
        var job;
        while ( (job = this.jobs.pop()) ) {
            job();
        }
    },
    remove: function(job) {
        var pos;
        while ( (pos = this.jobs.indexOf(job)) !== -1 ) {
            this.jobs.splice(pos, 1);
        }
    }
};

/******************************************************************************/
/******************************************************************************/

vAPI.messaging = {
    channels: Object.create(null),
    channelCount: 0,
    // Waiting for response
    pending: Object.create(null),
    pendingCount: 0,
    // Waiting to send
    queued: [],
    auxProcessId: 1,
    shuttingDown: false,

    shutdown: function() {
        this.shuttingDown = true;
        this.removeListener();
    },

    disconnectListener: function() {
        vAPI.shutdown.exec();
    },
    disconnectListenerCallback: null,

    messageListener: function(details) {
        if ( !details ) {
            return;
        }

        // Sent to all channels
        if ( details.broadcast === true && !details.channelName ) {
            for ( var channelName in this.channels ) {
                this.sendToChannelListeners(channelName, details.msg);
            }
            return;
        }

        // Response to specific message previously sent
        if ( details.auxProcessId ) {
            var listener = this.pending[details.auxProcessId];
            delete this.pending[details.auxProcessId];
            delete details.auxProcessId; // TODO: why?
            if ( listener ) {
                this.pendingCount -= 1;
                listener(details.msg);
                return;
            }
        }

        // Sent to a specific channel
        var response = this.sendToChannelListeners(details.channelName, details.msg);

        // Respond back if required
        if ( details.mainProcessId === undefined ) {
            return;
        }
        this.postMessage(details.mainProcessId, {
            mainProcessId: details.mainProcessId,
            msg: response
        });
    },
    messageListenerCallback: null,

    removeListener: function() {
        if ( this.channelCount !== 0 ) {
            this.channels = Object.create(null);
            this.channelCount = 0;
        }
        // service pending callbacks
        if ( this.pendingCount !== 0 ) {
            var pending = this.pending, callback;
            this.pending = Object.create(null);
            this.pendingCount = 0;
            for ( var auxId in pending ) {
                callback = pending[auxId];
                if ( typeof callback === 'function' ) {
                    callback(null);
                }
            }
        }
        if ( this.connector ) {
            safari.self.removeEventListener('message', this.connector, false);
            this.connector = null;
            this.channels = {};
            this.listeners = {};
        }
    },

    connect: function() {
        // this.createPort();
        this.connector = function(msg) {
            // messages from the background script are sent to every frame,
            // so we need to check the vAPI.sessionId to accept only
            // what is meant for the current context
            if ( msg.name === vAPI.sessionId || msg.name === 'broadcast' ) {
                vAPI.messaging.messageListener(msg.message);
            }
        };
        safari.self.addEventListener('message', this.connector, false);
        this.addChannelListener('vAPI', function(msg) {
            if ( msg.cmd === 'injectScript' && msg.details.code ) {
                Function(msg.details.code).call(self);
            }
        });
    },

    send: function(channelName, message, callback) {
        this.sendTo(channelName, message, undefined, undefined, callback);
    },

    sendTo: function(channelName, message, toTabId, toChannel, callback) {
        // Too large a gap between the last request and the last response means
        // the main process is no longer reachable: memory leaks and bad
        // performance become a risk -- especially for long-lived, dynamic
        // pages. Guard against this.
        if ( this.pendingCount > 25 ) {
            vAPI.shutdown.exec();
        }
        var auxProcessId;
        if ( callback ) {
            auxProcessId = this.auxProcessId++;
            this.pending[auxProcessId] = callback;
            this.pendingCount += 1;
        }
        if ( !this.connector ) {
            this.connect();
        }
        message = {
            channelName: channelName,
            auxProcessId: auxProcessId,
            toTabId: toTabId,
            toChannel: toChannel,
            msg: message
        };
        if ( document.hidden === true ) {
            // Wait for visibility change
            this.queued.push(message);
        } else {
            this.postMessage(auxProcessId, message);
        }
    },

    postMessage: function(auxProcessId, message) {
        // popover content doesn't know messaging...
        if ( safari.extension.globalPage ) {
            if ( !safari.self.visible ) {
                return;
            }
            safari.extension.globalPage.contentWindow.vAPI.messaging.onMessage({
                name: vAPI.sessionId,
                message: message,
                target: {
                    page: {
                        dispatchMessage: function(name, msg) {
                            // Handle callbacks
                            vAPI.messaging.messageListener(msg);
                        }
                    }
                }
            });
        } else {
            safari.self.tab.dispatchMessage(vAPI.sessionId, message);
        }
    },

    addChannelListener: function(channelName, callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }
        var listeners = this.channels[channelName];
        if ( listeners !== undefined && listeners.indexOf(callback) !== -1 ) {
            console.error('Duplicate listener on channel "%s"', channelName);
            return;
        }
        if ( listeners === undefined ) {
            this.channels[channelName] = [callback];
            this.channelCount += 1;
        } else {
            listeners.push(callback);
        }
        if ( !this.connector )
            this.connect();
    },

    removeChannelListener: function(channelName, callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }
        var listeners = this.channels[channelName];
        if ( listeners === undefined ) {
            return;
        }
        var pos = listeners.indexOf(callback);
        if ( pos === -1 ) {
            console.error('Listener not found on channel "%s"', channelName);
            return;
        }
        listeners.splice(pos, 1);
        if ( listeners.length === 0 ) {
            delete this.channels[channelName];
            this.channelCount -= 1;
        }
    },

    removeAllChannelListeners: function(channelName) {
        var listeners = this.channels[channelName];
        if ( listeners === undefined ) {
            return;
        }
        delete this.channels[channelName];
        this.channelCount -= 1;
    },

    sendToChannelListeners: function(channelName, msg) {
        var listeners = this.channels[channelName];
        if ( listeners === undefined ) {
            return;
        }
        var response;
        for ( var i = 0, n = listeners.length; i < n; i++ ) {
            response = listeners[i](msg);
            if ( response !== undefined ) {
                break;
            }
        }
        return response;
    }
};

// Post queued messages when page becomes visible
var queueDispatchListener = function() {
    if ( document.hidden === true || this.queued.length === 0 ) {
        return;
    }
    var message;
    for ( var i = 0; i < this.queued.length; i++ ) {
        message = this.queued[i];
        this.postMessage(message.auxProcessId, message);
    }
    this.queued.length = 0;
}.bind(vAPI.messaging);
document.addEventListener('visibilitychange', queueDispatchListener);

// The following code should run only in content pages
if ( location.protocol === 'safari-extension:' || typeof safari !== 'object' ) {
    return;
}

var frameId = window === window.top ? 0 : Date.now() % 1E5;
var parentFrameId = (frameId ? 0 : -1);

// Helper event to message background,
// and helper anchor element
var beforeLoadEvent,
    legacyMode = false,
    linkHelper = document.createElement('a');

try {
    beforeLoadEvent = new Event('beforeload')
} catch ( ex ) {
    legacyMode = true;
    beforeLoadEvent = document.createEvent('Event');
    beforeLoadEvent.initEvent('beforeload');
}

// Inform that we've navigated
var shouldBlockScript = false;
if ( frameId === 0 ) {
    shouldBlockScript = safari.self.tab.canLoad(beforeLoadEvent, {
        url: location.href,
        type: 'main_frame'
    }).shouldBlock;
}
var nodeTypes = {
    'frame': 'sub_frame',
    'iframe': 'sub_frame',
    'script': 'script',
    'img': 'image',
    'input': 'image',
    'object': 'object',
    'embed': 'object',
    'link': 'stylesheet'
};
var shouldBlockDetailedRequest = function(details) {
    linkHelper.href = details.url;
    details.url = linkHelper.href;
    details.frameId = frameId;
    details.parentFrameId = parentFrameId;
    details.timeStamp = Date.now();
    return safari.self.tab.canLoad(beforeLoadEvent, details).shouldBlock;
};
var redirectSrc = function(element, url) {
    element.src = url;
};
var onBeforeLoad = function(e) {
    if ( firstMutation !== false ) {
        firstMutation();
    }
    linkHelper.href = e.url;
    if ( linkHelper.protocol.charCodeAt(0) !== 104 ) { // h = 104
        return;
    }
    var type = nodeTypes[e.target.nodeName.toLowerCase()] || 'other';
    var details = {
        url: linkHelper.href,
        type: type,
        // tabId is determined in the background script
        frameId: frameId,
        parentFrameId: parentFrameId,
        timeStamp: Date.now()
    };
    var response = safari.self.tab.canLoad(e, details);
    if ( response.shouldBlock ) {
        response = response.redirectUrl;
        if ( response ) {
            switch ( type ) {
                case 'style':
                    e.target.href = response;
                    break;
                // case 'script':
                default:
                    setTimeout(redirectSrc.bind(undefined, e.target, response), 1);
                    break;
            }
        }
        e.preventDefault();
    }
};
document.addEventListener('beforeload', onBeforeLoad, true);

// Block popups, intercept XHRs
var firstMutation = function() {
    document.removeEventListener('DOMContentLoaded', firstMutation, true);
    firstMutation = false;
    if ( shouldBlockScript ) {
        var meta = document.createElement('meta');
        meta.setAttribute('http-equiv', 'content-security-policy');
        meta.setAttribute('content', 'script-src "unsafe-eval" *');
        if ( document.documentElement.firstChild ) {
            document.documentElement.insertBefore(meta, document.documentElement.firstChild);
        }
        else {
            document.documentElement.appendChild(meta);
        }
    }
    document.addEventListener(vAPI.sessionId, function(e) {
        if ( shouldBlockDetailedRequest(e.detail) ) {
            document.documentElement.setAttribute('data-ublock-blocked', 'true');
        }
    }, true);
    var tmpJS = document.createElement('script');
    var tmpScript = '!function(){__MSG_clientInjectedScript__';
    var eventScript;
    if (legacyMode) {
        eventScript = 'var e = document.createEvent("CustomEvent");\
e.initCustomEvent("' + vAPI.sessionId + '", false, false, {url: u, type: t});'
    } else {
        eventScript = 'var e = new CustomEvent("' + vAPI.sessionId + '", {bubbles: false, detail: {url: u, type: t}});'
    }
    tmpScript = tmpScript.replace('/* __MSG_eventScript__ */', eventScript);
    if ( frameId === 0 ) {
        tmpScript += '__MSG_historyScript__';
    }
    tmpScript += '}();';
    tmpJS.textContent = tmpScript;
    document.documentElement.removeChild(document.documentElement.appendChild(tmpJS));
};
document.addEventListener('DOMContentLoaded', firstMutation, true);

var onContextMenu = function(e) {
    var target = e.target;
    var tagName = target.tagName.toLowerCase();
    var details = {
        tagName: tagName,
        pageUrl: location.href,
        insideFrame: window !== window.top
    };
    details.editable = (tagName === 'textarea' || tagName === 'input');
    if ( target.hasOwnProperty('checked') ) {
        details.checked = target.checked;
    }
    if ( tagName === 'a' ) {
        details.linkUrl = target.href;
    }
    if ( target.hasOwnProperty('src') ) {
        details.srcUrl = target.src;
        if ( tagName === 'img' ) {
            details.mediaType = 'image';
        } else if ( tagName === 'video' || tagName === 'audio' ) {
            details.mediaType = tagName;
        }
    }
    safari.self.tab.setContextMenuEventUserInfo(e, details);
};
self.addEventListener('contextmenu', onContextMenu, true);

})(this);

/******************************************************************************/
