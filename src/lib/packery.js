(function(window) {
    "use strict";
    var prefixes = "Webkit Moz ms Ms O".split(" ");
    var docElemStyle = document.documentElement.style;

    function getStyleProperty(propName) {
        if (!propName) {
            return
        }
        if (typeof docElemStyle[propName] === "string") {
            return propName
        }
        propName = propName.charAt(0).toUpperCase() + propName.slice(1);
        var prefixed;
        for (var i = 0, len = prefixes.length; i < len; i++) {
            prefixed = prefixes[i] + propName;
            if (typeof docElemStyle[prefixed] === "string") {
                return prefixed
            }
        }
    }
    if (typeof define === "function" && define.amd) {
        define(function() {
            return getStyleProperty
        })
    } else if (typeof exports === "object") {
        module.exports = getStyleProperty
    } else {
        window.getStyleProperty = getStyleProperty
    }
})(window);
(function(window, undefined) {
    "use strict";
    var getComputedStyle = window.getComputedStyle;
    var getStyle = getComputedStyle ? function(elem) {
        return getComputedStyle(elem, null)
    } : function(elem) {
        return elem.currentStyle
    };

    function getStyleSize(value) {
        var num = parseFloat(value);
        var isValid = value.indexOf("%") === -1 && !isNaN(num);
        return isValid && num
    }
    var measurements = ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "marginLeft", "marginRight", "marginTop", "marginBottom", "borderLeftWidth", "borderRightWidth", "borderTopWidth", "borderBottomWidth"];

    function getZeroSize() {
        var size = {
            width: 0,
            height: 0,
            innerWidth: 0,
            innerHeight: 0,
            outerWidth: 0,
            outerHeight: 0
        };
        for (var i = 0, len = measurements.length; i < len; i++) {
            var measurement = measurements[i];
            size[measurement] = 0
        }
        return size
    }

    function defineGetSize(getStyleProperty) {
        var boxSizingProp = getStyleProperty("boxSizing");
        var isBoxSizeOuter;
        (function() {
            if (!boxSizingProp) {
                return
            }
            var div = document.createElement("div");
            div.style.width = "200px";
            div.style.padding = "1px 2px 3px 4px";
            div.style.borderStyle = "solid";
            div.style.borderWidth = "1px 2px 3px 4px";
            div.style[boxSizingProp] = "border-box";
            var body = document.body || document.documentElement;
            body.appendChild(div);
            var style = getStyle(div);
            isBoxSizeOuter = getStyleSize(style.width) === 200;
            body.removeChild(div)
        })();

        function getSize(elem) {
            if (typeof elem === "string") {
                elem = document.querySelector(elem)
            }
            if (!elem || typeof elem !== "object" || !elem.nodeType) {
                return
            }
            var style = getStyle(elem);
            if (style.display === "none") {
                return getZeroSize()
            }
            var size = {};
            size.width = elem.offsetWidth;
            size.height = elem.offsetHeight;
            var isBorderBox = size.isBorderBox = !!(boxSizingProp && style[boxSizingProp] && style[boxSizingProp] === "border-box");
            for (var i = 0, len = measurements.length; i < len; i++) {
                var measurement = measurements[i];
                var value = style[measurement];
                value = mungeNonPixel(elem, value);
                var num = parseFloat(value);
                size[measurement] = !isNaN(num) ? num : 0
            }
            var paddingWidth = size.paddingLeft + size.paddingRight;
            var paddingHeight = size.paddingTop + size.paddingBottom;
            var marginWidth = size.marginLeft + size.marginRight;
            var marginHeight = size.marginTop + size.marginBottom;
            var borderWidth = size.borderLeftWidth + size.borderRightWidth;
            var borderHeight = size.borderTopWidth + size.borderBottomWidth;
            var isBorderBoxSizeOuter = isBorderBox && isBoxSizeOuter;
            var styleWidth = getStyleSize(style.width);
            if (styleWidth !== false) {
                size.width = styleWidth + (isBorderBoxSizeOuter ? 0 : paddingWidth + borderWidth)
            }
            var styleHeight = getStyleSize(style.height);
            if (styleHeight !== false) {
                size.height = styleHeight + (isBorderBoxSizeOuter ? 0 : paddingHeight + borderHeight)
            }
            size.innerWidth = size.width - (paddingWidth + borderWidth);
            size.innerHeight = size.height - (paddingHeight + borderHeight);
            size.outerWidth = size.width + marginWidth;
            size.outerHeight = size.height + marginHeight;
            return size
        }

        function mungeNonPixel(elem, value) {
            if (getComputedStyle || value.indexOf("%") === -1) {
                return value
            }
            var style = elem.style;
            var left = style.left;
            var rs = elem.runtimeStyle;
            var rsLeft = rs && rs.left;
            if (rsLeft) {
                rs.left = elem.currentStyle.left
            }
            style.left = value;
            value = style.pixelLeft;
            style.left = left;
            if (rsLeft) {
                rs.left = rsLeft
            }
            return value
        }
        return getSize
    }
    if (typeof define === "function" && define.amd) {
        define(["get-style-property/get-style-property"], defineGetSize)
    } else if (typeof exports === "object") {
        module.exports = defineGetSize(require("get-style-property"))
    } else {
        window.getSize = defineGetSize(window.getStyleProperty)
    }
})(window);
(function(global, ElemProto) {
    "use strict";
    var matchesMethod = function() {
        if (ElemProto.matchesSelector) {
            return "matchesSelector"
        }
        var prefixes = ["webkit", "moz", "ms", "o"];
        for (var i = 0, len = prefixes.length; i < len; i++) {
            var prefix = prefixes[i];
            var method = prefix + "MatchesSelector";
            if (ElemProto[method]) {
                return method
            }
        }
    }();

    function match(elem, selector) {
        return elem[matchesMethod](selector)
    }

    function checkParent(elem) {
        if (elem.parentNode) {
            return
        }
        var fragment = document.createDocumentFragment();
        fragment.appendChild(elem)
    }

    function query(elem, selector) {
        checkParent(elem);
        var elems = elem.parentNode.querySelectorAll(selector);
        for (var i = 0, len = elems.length; i < len; i++) {
            if (elems[i] === elem) {
                return true
            }
        }
        return false
    }

    function matchChild(elem, selector) {
        checkParent(elem);
        return match(elem, selector)
    }
    var matchesSelector;
    if (matchesMethod) {
        var div = document.createElement("div");
        var supportsOrphans = match(div, "div");
        matchesSelector = supportsOrphans ? match : matchChild
    } else {
        matchesSelector = query
    }
    if (typeof define === "function" && define.amd) {
        define(function() {
            return matchesSelector
        })
    } else {
        window.matchesSelector = matchesSelector
    }
})(this, Element.prototype);
(function() {
    "use strict";

    function EventEmitter() {}
    var proto = EventEmitter.prototype;
    var exports = this;
    var originalGlobalValue = exports.EventEmitter;

    function indexOfListener(listeners, listener) {
        var i = listeners.length;
        while (i--) {
            if (listeners[i].listener === listener) {
                return i
            }
        }
        return -1
    }

    function alias(name) {
        return function aliasClosure() {
            return this[name].apply(this, arguments)
        }
    }
    proto.getListeners = function getListeners(evt) {
        var events = this._getEvents();
        var response;
        var key;
        if (evt instanceof RegExp) {
            response = {};
            for (key in events) {
                if (events.hasOwnProperty(key) && evt.test(key)) {
                    response[key] = events[key]
                }
            }
        } else {
            response = events[evt] || (events[evt] = [])
        }
        return response
    };
    proto.flattenListeners = function flattenListeners(listeners) {
        var flatListeners = [];
        var i;
        for (i = 0; i < listeners.length; i += 1) {
            flatListeners.push(listeners[i].listener)
        }
        return flatListeners
    };
    proto.getListenersAsObject = function getListenersAsObject(evt) {
        var listeners = this.getListeners(evt);
        var response;
        if (listeners instanceof Array) {
            response = {};
            response[evt] = listeners
        }
        return response || listeners
    };
    proto.addListener = function addListener(evt, listener) {
        var listeners = this.getListenersAsObject(evt);
        var listenerIsWrapped = typeof listener === "object";
        var key;
        for (key in listeners) {
            if (listeners.hasOwnProperty(key) && indexOfListener(listeners[key], listener) === -1) {
                listeners[key].push(listenerIsWrapped ? listener : {
                    listener: listener,
                    once: false
                })
            }
        }
        return this
    };
    proto.on = alias("addListener");
    proto.addOnceListener = function addOnceListener(evt, listener) {
        return this.addListener(evt, {
            listener: listener,
            once: true
        })
    };
    proto.once = alias("addOnceListener");
    proto.defineEvent = function defineEvent(evt) {
        this.getListeners(evt);
        return this
    };
    proto.defineEvents = function defineEvents(evts) {
        for (var i = 0; i < evts.length; i += 1) {
            this.defineEvent(evts[i])
        }
        return this
    };
    proto.removeListener = function removeListener(evt, listener) {
        var listeners = this.getListenersAsObject(evt);
        var index;
        var key;
        for (key in listeners) {
            if (listeners.hasOwnProperty(key)) {
                index = indexOfListener(listeners[key], listener);
                if (index !== -1) {
                    listeners[key].splice(index, 1)
                }
            }
        }
        return this
    };
    proto.off = alias("removeListener");
    proto.addListeners = function addListeners(evt, listeners) {
        return this.manipulateListeners(false, evt, listeners)
    };
    proto.removeListeners = function removeListeners(evt, listeners) {
        return this.manipulateListeners(true, evt, listeners)
    };
    proto.manipulateListeners = function manipulateListeners(remove, evt, listeners) {
        var i;
        var value;
        var single = remove ? this.removeListener : this.addListener;
        var multiple = remove ? this.removeListeners : this.addListeners;
        if (typeof evt === "object" && !(evt instanceof RegExp)) {
            for (i in evt) {
                if (evt.hasOwnProperty(i) && (value = evt[i])) {
                    if (typeof value === "function") {
                        single.call(this, i, value)
                    } else {
                        multiple.call(this, i, value)
                    }
                }
            }
        } else {
            i = listeners.length;
            while (i--) {
                single.call(this, evt, listeners[i])
            }
        }
        return this
    };
    proto.removeEvent = function removeEvent(evt) {
        var type = typeof evt;
        var events = this._getEvents();
        var key;
        if (type === "string") {
            delete events[evt]
        } else if (evt instanceof RegExp) {
            for (key in events) {
                if (events.hasOwnProperty(key) && evt.test(key)) {
                    delete events[key]
                }
            }
        } else {
            delete this._events
        }
        return this
    };
    proto.removeAllListeners = alias("removeEvent");
    proto.emitEvent = function emitEvent(evt, args) {
        var listeners = this.getListenersAsObject(evt);
        var listener;
        var i;
        var key;
        var response;
        for (key in listeners) {
            if (listeners.hasOwnProperty(key)) {
                i = listeners[key].length;
                while (i--) {
                    listener = listeners[key][i];
                    if (listener.once === true) {
                        this.removeListener(evt, listener.listener)
                    }
                    response = listener.listener.apply(this, args || []);
                    if (response === this._getOnceReturnValue()) {
                        this.removeListener(evt, listener.listener)
                    }
                }
            }
        }
        return this
    };
    proto.trigger = alias("emitEvent");
    proto.emit = function emit(evt) {
        var args = Array.prototype.slice.call(arguments, 1);
        return this.emitEvent(evt, args)
    };
    proto.setOnceReturnValue = function setOnceReturnValue(value) {
        this._onceReturnValue = value;
        return this
    };
    proto._getOnceReturnValue = function _getOnceReturnValue() {
        if (this.hasOwnProperty("_onceReturnValue")) {
            return this._onceReturnValue
        } else {
            return true
        }
    };
    proto._getEvents = function _getEvents() {
        return this._events || (this._events = {})
    };
    EventEmitter.noConflict = function noConflict() {
        exports.EventEmitter = originalGlobalValue;
        return EventEmitter
    };
    if (typeof define === "function" && define.amd) {
        define(function() {
            return EventEmitter
        })
    } else if (typeof module === "object" && module.exports) {
        module.exports = EventEmitter
    } else {
        this.EventEmitter = EventEmitter
    }
}).call(this);
(function(window) {
    "use strict";
    var docElem = document.documentElement;
    var bind = function() {};

    function getIEEvent(obj) {
        var event = window.event;
        event.target = event.target || event.srcElement || obj;
        return event
    }
    if (docElem.addEventListener) {
        bind = function(obj, type, fn) {
            obj.addEventListener(type, fn, false)
        }
    } else if (docElem.attachEvent) {
        bind = function(obj, type, fn) {
            obj[type + fn] = fn.handleEvent ? function() {
                var event = getIEEvent(obj);
                fn.handleEvent.call(fn, event)
            } : function() {
                var event = getIEEvent(obj);
                fn.call(obj, event)
            };
            obj.attachEvent("on" + type, obj[type + fn])
        }
    }
    var unbind = function() {};
    if (docElem.removeEventListener) {
        unbind = function(obj, type, fn) {
            obj.removeEventListener(type, fn, false)
        }
    } else if (docElem.detachEvent) {
        unbind = function(obj, type, fn) {
            obj.detachEvent("on" + type, obj[type + fn]);
            try {
                delete obj[type + fn]
            } catch (err) {
                obj[type + fn] = undefined
            }
        }
    }
    var eventie = {
        bind: bind,
        unbind: unbind
    };
    if (typeof define === "function" && define.amd) {
        define(eventie)
    } else if (typeof exports === "object") {
        module.exports = eventie
    } else {
        window.eventie = eventie
    }
})(this);
(function(window) {
    "use strict";
    var document = window.document;
    var queue = [];

    function docReady(fn) {
        if (typeof fn !== "function") {
            return
        }
        if (docReady.isReady) {
            fn()
        } else {
            queue.push(fn)
        }
    }
    docReady.isReady = false;

    function init(event) {
        var isIE8NotReady = event.type === "readystatechange" && document.readyState !== "complete";
        if (docReady.isReady || isIE8NotReady) {
            return
        }
        docReady.isReady = true;
        for (var i = 0, len = queue.length; i < len; i++) {
            var fn = queue[i];
            fn()
        }
    }

    function defineDocReady(eventie) {
        eventie.bind(document, "DOMContentLoaded", init);
        eventie.bind(document, "readystatechange", init);
        eventie.bind(window, "load", init);
        return docReady
    }
    if (typeof define === "function" && define.amd) {
        docReady.isReady = typeof requirejs === "function";
        define(["eventie/eventie"], defineDocReady)
    } else {
        window.docReady = defineDocReady(window.eventie)
    }
})(this);
(function(window) {
    "use strict";

    function classReg(className) {
        return new RegExp("(^|\\s+)" + className + "(\\s+|$)")
    }
    var hasClass, addClass, removeClass;
    if ("classList" in document.documentElement) {
        hasClass = function(elem, c) {
            return elem.classList.contains(c)
        };
        addClass = function(elem, c) {
            elem.classList.add(c)
        };
        removeClass = function(elem, c) {
            elem.classList.remove(c)
        }
    } else {
        hasClass = function(elem, c) {
            return classReg(c).test(elem.className)
        };
        addClass = function(elem, c) {
            if (!hasClass(elem, c)) {
                elem.className = elem.className + " " + c
            }
        };
        removeClass = function(elem, c) {
            elem.className = elem.className.replace(classReg(c), " ")
        }
    }

    function toggleClass(elem, c) {
        var fn = hasClass(elem, c) ? removeClass : addClass;
        fn(elem, c)
    }
    var classie = {
        hasClass: hasClass,
        addClass: addClass,
        removeClass: removeClass,
        toggleClass: toggleClass,
        has: hasClass,
        add: addClass,
        remove: removeClass,
        toggle: toggleClass
    };
    if (typeof define === "function" && define.amd) {
        define(classie)
    } else {
        window.classie = classie
    }
})(window);
(function(window) {
    "use strict";
    var defView = document.defaultView;
    var getStyle = defView && defView.getComputedStyle ? function(elem) {
        return defView.getComputedStyle(elem, null)
    } : function(elem) {
        return elem.currentStyle
    };

    function extend(a, b) {
        for (var prop in b) {
            a[prop] = b[prop]
        }
        return a
    }

    function isEmptyObj(obj) {
        for (var prop in obj) {
            return false
        }
        prop = null;
        return true
    }

    function toDash(str) {
        return str.replace(/([A-Z])/g, function($1) {
            return "-" + $1.toLowerCase()
        })
    }

    function outlayerItemDefinition(EventEmitter, getSize, getStyleProperty) {
        var transitionProperty = getStyleProperty("transition");
        var transformProperty = getStyleProperty("transform");
        var supportsCSS3 = transitionProperty && transformProperty;
        var is3d = !!getStyleProperty("perspective");
        var transitionEndEvent = {
            WebkitTransition: "webkitTransitionEnd",
            MozTransition: "transitionend",
            OTransition: "otransitionend",
            transition: "transitionend"
        }[transitionProperty];
        var prefixableProperties = ["transform", "transition", "transitionDuration", "transitionProperty"];
        var vendorProperties = function() {
            var cache = {};
            for (var i = 0, len = prefixableProperties.length; i < len; i++) {
                var prop = prefixableProperties[i];
                var supportedProp = getStyleProperty(prop);
                if (supportedProp && supportedProp !== prop) {
                    cache[prop] = supportedProp
                }
            }
            return cache
        }();

        function Item(element, layout) {
            if (!element) {
                return
            }
            this.element = element;
            this.layout = layout;
            this.position = {
                x: 0,
                y: 0
            };
            this._create()
        }
        extend(Item.prototype, EventEmitter.prototype);
        Item.prototype._create = function() {
            this._transn = {
                ingProperties: {},
                clean: {},
                onEnd: {}
            };
            this.css({
                position: "absolute"
            })
        };
        Item.prototype.handleEvent = function(event) {
            var method = "on" + event.type;
            if (this[method]) {
                this[method](event)
            }
        };
        Item.prototype.getSize = function() {
            this.size = getSize(this.element)
        };
        Item.prototype.css = function(style) {
            var elemStyle = this.element.style;
            for (var prop in style) {
                var supportedProp = vendorProperties[prop] || prop;
                elemStyle[supportedProp] = style[prop]
            }
        };
        Item.prototype.getPosition = function() {
            var style = getStyle(this.element);
            var layoutOptions = this.layout.options;
            var isOriginLeft = layoutOptions.isOriginLeft;
            var isOriginTop = layoutOptions.isOriginTop;
            var x = parseInt(style[isOriginLeft ? "left" : "right"], 10);
            var y = parseInt(style[isOriginTop ? "top" : "bottom"], 10);
            x = isNaN(x) ? 0 : x;
            y = isNaN(y) ? 0 : y;
            var layoutSize = this.layout.size;
            x -= isOriginLeft ? layoutSize.paddingLeft : layoutSize.paddingRight;
            y -= isOriginTop ? layoutSize.paddingTop : layoutSize.paddingBottom;
            this.position.x = x;
            this.position.y = y
        };
        Item.prototype.layoutPosition = function() {
            var layoutSize = this.layout.size;
            var layoutOptions = this.layout.options;
            var style = {};
            if (layoutOptions.isOriginLeft) {
                style.left = this.position.x + layoutSize.paddingLeft + "px";
                style.right = ""
            } else {
                style.right = this.position.x + layoutSize.paddingRight + "px";
                style.left = ""
            }
            if (layoutOptions.isOriginTop) {
                style.top = this.position.y + layoutSize.paddingTop + "px";
                style.bottom = ""
            } else {
                style.bottom = this.position.y + layoutSize.paddingBottom + "px";
                style.top = ""
            }
            this.css(style);
            this.emitEvent("layout", [this])
        };
        var translate = is3d ? function(x, y) {
            return "translate3d(" + x + "px, " + y + "px, 0)"
        } : function(x, y) {
            return "translate(" + x + "px, " + y + "px)"
        };
        Item.prototype._transitionTo = function(x, y) {
            this.getPosition();
            var curX = this.position.x;
            var curY = this.position.y;
            var compareX = parseInt(x, 10);
            var compareY = parseInt(y, 10);
            var didNotMove = compareX === this.position.x && compareY === this.position.y;
            this.setPosition(x, y);
            if (didNotMove && !this.isTransitioning) {
                this.layoutPosition();
                return
            }
            var transX = x - curX;
            var transY = y - curY;
            var transitionStyle = {};
            var layoutOptions = this.layout.options;
            transX = layoutOptions.isOriginLeft ? transX : -transX;
            transY = layoutOptions.isOriginTop ? transY : -transY;
            transitionStyle.transform = translate(transX, transY);
            this.transition({
                to: transitionStyle,
                onTransitionEnd: {
                    transform: this.layoutPosition
                },
                isCleaning: true
            })
        };
        Item.prototype.goTo = function(x, y) {
            this.setPosition(x, y);
            this.layoutPosition()
        };
        Item.prototype.moveTo = supportsCSS3 ? Item.prototype._transitionTo : Item.prototype.goTo;
        Item.prototype.setPosition = function(x, y) {
            this.position.x = parseInt(x, 10);
            this.position.y = parseInt(y, 10)
        };
        Item.prototype._nonTransition = function(args) {
            this.css(args.to);
            if (args.isCleaning) {
                this._removeStyles(args.to)
            }
            for (var prop in args.onTransitionEnd) {
                args.onTransitionEnd[prop].call(this)
            }
        };
        Item.prototype._transition = function(args) {
            if (!parseFloat(this.layout.options.transitionDuration)) {
                this._nonTransition(args);
                return
            }
            var _transition = this._transn;
            for (var prop in args.onTransitionEnd) {
                _transition.onEnd[prop] = args.onTransitionEnd[prop]
            }
            for (prop in args.to) {
                _transition.ingProperties[prop] = true;
                if (args.isCleaning) {
                    _transition.clean[prop] = true
                }
            }
            if (args.from) {
                this.css(args.from);
                var h = this.element.offsetHeight;
                h = null
            }
            this.enableTransition(args.to);
            this.css(args.to);
            this.isTransitioning = true
        };
        var itemTransitionProperties = transformProperty && toDash(transformProperty) + ",opacity";
        Item.prototype.enableTransition = function() {
            if (this.isTransitioning) {
                return
            }
            this.css({
                transitionProperty: itemTransitionProperties,
                transitionDuration: this.layout.options.transitionDuration
            });
            this.element.addEventListener(transitionEndEvent, this, false)
        };
        Item.prototype.transition = Item.prototype[transitionProperty ? "_transition" : "_nonTransition"];
        Item.prototype.onwebkitTransitionEnd = function(event) {
            this.ontransitionend(event)
        };
        Item.prototype.onotransitionend = function(event) {
            this.ontransitionend(event)
        };
        var dashedVendorProperties = {
            "-webkit-transform": "transform",
            "-moz-transform": "transform",
            "-o-transform": "transform"
        };
        Item.prototype.ontransitionend = function(event) {
            if (event.target !== this.element) {
                return
            }
            var _transition = this._transn;
            var propertyName = dashedVendorProperties[event.propertyName] || event.propertyName;
            delete _transition.ingProperties[propertyName];
            if (isEmptyObj(_transition.ingProperties)) {
                this.disableTransition()
            }
            if (propertyName in _transition.clean) {
                this.element.style[event.propertyName] = "";
                delete _transition.clean[propertyName]
            }
            if (propertyName in _transition.onEnd) {
                var onTransitionEnd = _transition.onEnd[propertyName];
                onTransitionEnd.call(this);
                delete _transition.onEnd[propertyName]
            }
            this.emitEvent("transitionEnd", [this])
        };
        Item.prototype.disableTransition = function() {
            this.removeTransitionStyles();
            this.element.removeEventListener(transitionEndEvent, this, false);
            this.isTransitioning = false
        };
        Item.prototype._removeStyles = function(style) {
            var cleanStyle = {};
            for (var prop in style) {
                cleanStyle[prop] = ""
            }
            this.css(cleanStyle)
        };
        var cleanTransitionStyle = {
            transitionProperty: "",
            transitionDuration: ""
        };
        Item.prototype.removeTransitionStyles = function() {
            this.css(cleanTransitionStyle)
        };
        Item.prototype.removeElem = function() {
            this.element.parentNode.removeChild(this.element);
            this.emitEvent("remove", [this])
        };
        Item.prototype.remove = function() {
            if (!transitionProperty || !parseFloat(this.layout.options.transitionDuration)) {
                this.removeElem();
                return
            }
            var _this = this;
            this.on("transitionEnd", function() {
                _this.removeElem();
                return true
            });
            this.hide()
        };
        Item.prototype.reveal = function() {
            delete this.isHidden;
            this.css({
                display: ""
            });
            var options = this.layout.options;
            this.transition({
                from: options.hiddenStyle,
                to: options.visibleStyle,
                isCleaning: true
            })
        };
        Item.prototype.hide = function() {
            this.isHidden = true;
            this.css({
                display: ""
            });
            var options = this.layout.options;
            this.transition({
                from: options.visibleStyle,
                to: options.hiddenStyle,
                isCleaning: true,
                onTransitionEnd: {
                    opacity: function() {
                        if (this.isHidden) {
                            this.css({
                                display: "none"
                            })
                        }
                    }
                }
            })
        };
        Item.prototype.destroy = function() {
            this.css({
                position: "",
                left: "",
                right: "",
                top: "",
                bottom: "",
                transition: "",
                transform: ""
            })
        };
        return Item
    }
    if (typeof define === "function" && define.amd) {
        define(["eventEmitter/EventEmitter", "get-size/get-size", "get-style-property/get-style-property"], outlayerItemDefinition)
    } else {
        window.Outlayer = {};
        window.Outlayer.Item = outlayerItemDefinition(window.EventEmitter, window.getSize, window.getStyleProperty)
    }
})(window);
(function(window) {
    "use strict";
    var document = window.document;
    var console = window.console;
    var jQuery = window.jQuery;
    var noop = function() {};

    function extend(a, b) {
        for (var prop in b) {
            a[prop] = b[prop]
        }
        return a
    }
    var objToString = Object.prototype.toString;

    function isArray(obj) {
        return objToString.call(obj) === "[object Array]"
    }

    function makeArray(obj) {
        var ary = [];
        if (isArray(obj)) {
            ary = obj
        } else if (obj && typeof obj.length === "number") {
            for (var i = 0, len = obj.length; i < len; i++) {
                ary.push(obj[i])
            }
        } else {
            ary.push(obj)
        }
        return ary
    }
    var isElement = typeof HTMLElement === "object" ? function isElementDOM2(obj) {
        return obj instanceof HTMLElement
    } : function isElementQuirky(obj) {
        return obj && typeof obj === "object" && obj.nodeType === 1 && typeof obj.nodeName === "string"
    };
    var indexOf = Array.prototype.indexOf ? function(ary, obj) {
        return ary.indexOf(obj)
    } : function(ary, obj) {
        for (var i = 0, len = ary.length; i < len; i++) {
            if (ary[i] === obj) {
                return i
            }
        }
        return -1
    };

    function removeFrom(obj, ary) {
        var index = indexOf(ary, obj);
        if (index !== -1) {
            ary.splice(index, 1)
        }
    }

    function toDashed(str) {
        return str.replace(/(.)([A-Z])/g, function(match, $1, $2) {
            return $1 + "-" + $2
        }).toLowerCase()
    }

    function outlayerDefinition(eventie, docReady, EventEmitter, getSize, matchesSelector, Item) {
        var GUID = 0;
        var instances = {};

        function Outlayer(element, options) {
            if (typeof element === "string") {
                element = document.querySelector(element)
            }
            if (!element || !isElement(element)) {
                if (console) {
                    console.error("Bad " + this.constructor.namespace + " element: " + element)
                }
                return
            }
            this.element = element;
            this.options = extend({}, this.options);
            this.option(options);
            var id = ++GUID;
            this.element.outlayerGUID = id;
            instances[id] = this;
            this._create();
            if (this.options.isInitLayout) {
                this.layout()
            }
        }
        Outlayer.namespace = "outlayer";
        Outlayer.Item = Item;
        Outlayer.prototype.options = {
            containerStyle: {
                position: "relative"
            },
            isInitLayout: true,
            isOriginLeft: true,
            isOriginTop: true,
            isResizeBound: true,
            transitionDuration: "0.4s",
            hiddenStyle: {
                opacity: 0,
                transform: "scale(0.001)"
            },
            visibleStyle: {
                opacity: 1,
                transform: "scale(1)"
            }
        };
        extend(Outlayer.prototype, EventEmitter.prototype);
        Outlayer.prototype.option = function(opts) {
            extend(this.options, opts)
        };
        Outlayer.prototype._create = function() {
            this.reloadItems();
            this.stamps = [];
            this.stamp(this.options.stamp);
            extend(this.element.style, this.options.containerStyle);
            if (this.options.isResizeBound) {
                this.bindResize()
            }
        };
        Outlayer.prototype.reloadItems = function() {
            this.items = this._itemize(this.element.children)
        };
        Outlayer.prototype._itemize = function(elems) {
            var itemElems = this._filterFindItemElements(elems);
            var Item = this.constructor.Item;
            var items = [];
            for (var i = 0, len = itemElems.length; i < len; i++) {
                var elem = itemElems[i];
                var item = new Item(elem, this);
                items.push(item)
            }
            return items
        };
        Outlayer.prototype._filterFindItemElements = function(elems) {
            elems = makeArray(elems);
            var itemSelector = this.options.itemSelector;
            var itemElems = [];
            for (var i = 0, len = elems.length; i < len; i++) {
                var elem = elems[i];
                if (!isElement(elem)) {
                    continue
                }
                if (itemSelector) {
                    if (matchesSelector(elem, itemSelector)) {
                        itemElems.push(elem)
                    }
                    var childElems = elem.querySelectorAll(itemSelector);
                    for (var j = 0, jLen = childElems.length; j < jLen; j++) {
                        itemElems.push(childElems[j])
                    }
                } else {
                    itemElems.push(elem)
                }
            }
            return itemElems
        };
        Outlayer.prototype.getItemElements = function() {
            var elems = [];
            for (var i = 0, len = this.items.length; i < len; i++) {
                elems.push(this.items[i].element)
            }
            return elems
        };
        Outlayer.prototype.layout = function() {
            this._resetLayout();
            this._manageStamps();
            var isInstant = this.options.isLayoutInstant !== undefined ? this.options.isLayoutInstant : !this._isLayoutInited;
            this.layoutItems(this.items, isInstant);
            this._isLayoutInited = true
        };
        Outlayer.prototype._init = Outlayer.prototype.layout;
        Outlayer.prototype._resetLayout = function() {
            this.getSize()
        };
        Outlayer.prototype.getSize = function() {
            this.size = getSize(this.element)
        };
        Outlayer.prototype._getMeasurement = function(measurement, size) {
            var option = this.options[measurement];
            var elem;
            if (!option) {
                this[measurement] = 0
            } else {
                if (typeof option === "string") {
                    elem = this.element.querySelector(option)
                } else if (isElement(option)) {
                    elem = option
                }
                this[measurement] = elem ? getSize(elem)[size] : option
            }
        };
        Outlayer.prototype.layoutItems = function(items, isInstant) {
            items = this._getItemsForLayout(items);
            this._layoutItems(items, isInstant);
            this._postLayout()
        };
        Outlayer.prototype._getItemsForLayout = function(items) {
            var layoutItems = [];
            for (var i = 0, len = items.length; i < len; i++) {
                var item = items[i];
                if (!item.isIgnored) {
                    layoutItems.push(item)
                }
            }
            return layoutItems
        };
        Outlayer.prototype._layoutItems = function(items, isInstant) {
            var _this = this;

            function onItemsLayout() {
                _this.emitEvent("layoutComplete", [_this, items])
            }
            if (!items || !items.length) {
                onItemsLayout();
                return
            }
            this._itemsOn(items, "layout", onItemsLayout);
            var queue = [];
            for (var i = 0, len = items.length; i < len; i++) {
                var item = items[i];
                var position = this._getItemLayoutPosition(item);
                position.item = item;
                position.isInstant = isInstant || item.isLayoutInstant;
                queue.push(position)
            }
            this._processLayoutQueue(queue)
        };
        Outlayer.prototype._getItemLayoutPosition = function() {
            return {
                x: 0,
                y: 0
            }
        };
        Outlayer.prototype._processLayoutQueue = function(queue) {
            for (var i = 0, len = queue.length; i < len; i++) {
                var obj = queue[i];
                this._positionItem(obj.item, obj.x, obj.y, obj.isInstant)
            }
        };
        Outlayer.prototype._positionItem = function(item, x, y, isInstant) {
            if (isInstant) {
                item.goTo(x, y)
            } else {
                item.moveTo(x, y)
            }
        };
        Outlayer.prototype._postLayout = function() {
            var size = this._getContainerSize();
            if (size) {
                this._setContainerMeasure(size.width, true);
                this._setContainerMeasure(size.height, false)
            }
        };
        Outlayer.prototype._getContainerSize = noop;
        Outlayer.prototype._setContainerMeasure = function(measure, isWidth) {
            if (measure === undefined) {
                return
            }
            var elemSize = this.size;
            if (elemSize.isBorderBox) {
                measure += isWidth ? elemSize.paddingLeft + elemSize.paddingRight + elemSize.borderLeftWidth + elemSize.borderRightWidth : elemSize.paddingBottom + elemSize.paddingTop + elemSize.borderTopWidth + elemSize.borderBottomWidth
            }
            measure = Math.max(measure, 0);
            this.element.style[isWidth ? "width" : "height"] = measure + "px"
        };
        Outlayer.prototype._itemsOn = function(items, eventName, callback) {
            var doneCount = 0;
            var count = items.length;
            var _this = this;

            function tick() {
                doneCount++;
                if (doneCount === count) {
                    callback.call(_this)
                }
                return true
            }
            for (var i = 0, len = items.length; i < len; i++) {
                var item = items[i];
                item.on(eventName, tick)
            }
        };
        Outlayer.prototype.ignore = function(elem) {
            var item = this.getItem(elem);
            if (item) {
                item.isIgnored = true
            }
        };
        Outlayer.prototype.unignore = function(elem) {
            var item = this.getItem(elem);
            if (item) {
                delete item.isIgnored
            }
        };
        Outlayer.prototype.stamp = function(elems) {
            elems = this._find(elems);
            if (!elems) {
                return
            }
            this.stamps = this.stamps.concat(elems);
            for (var i = 0, len = elems.length; i < len; i++) {
                var elem = elems[i];
                this.ignore(elem)
            }
        };
        Outlayer.prototype.unstamp = function(elems) {
            elems = this._find(elems);
            if (!elems) {
                return
            }
            for (var i = 0, len = elems.length; i < len; i++) {
                var elem = elems[i];
                removeFrom(elem, this.stamps);
                this.unignore(elem)
            }
        };
        Outlayer.prototype._find = function(elems) {
            if (!elems) {
                return
            }
            if (typeof elems === "string") {
                elems = this.element.querySelectorAll(elems)
            }
            elems = makeArray(elems);
            return elems
        };
        Outlayer.prototype._manageStamps = function() {
            if (!this.stamps || !this.stamps.length) {
                return
            }
            this._getBoundingRect();
            for (var i = 0, len = this.stamps.length; i < len; i++) {
                var stamp = this.stamps[i];
                this._manageStamp(stamp)
            }
        };
        Outlayer.prototype._getBoundingRect = function() {
            var boundingRect = this.element.getBoundingClientRect();
            var size = this.size;
            this._boundingRect = {
                left: boundingRect.left + size.paddingLeft + size.borderLeftWidth,
                top: boundingRect.top + size.paddingTop + size.borderTopWidth,
                right: boundingRect.right - (size.paddingRight + size.borderRightWidth),
                bottom: boundingRect.bottom - (size.paddingBottom + size.borderBottomWidth)
            }
        };
        Outlayer.prototype._manageStamp = noop;
        Outlayer.prototype._getElementOffset = function(elem) {
            var boundingRect = elem.getBoundingClientRect();
            var thisRect = this._boundingRect;
            var size = getSize(elem);
            var offset = {
                left: boundingRect.left - thisRect.left - size.marginLeft,
                top: boundingRect.top - thisRect.top - size.marginTop,
                right: thisRect.right - boundingRect.right - size.marginRight,
                bottom: thisRect.bottom - boundingRect.bottom - size.marginBottom
            };
            return offset
        };
        Outlayer.prototype.handleEvent = function(event) {
            var method = "on" + event.type;
            if (this[method]) {
                this[method](event)
            }
        };
        Outlayer.prototype.bindResize = function() {
            if (this.isResizeBound) {
                return
            }
            eventie.bind(window, "resize", this);
            this.isResizeBound = true
        };
        Outlayer.prototype.unbindResize = function() {
            eventie.unbind(window, "resize", this);
            this.isResizeBound = false
        };
        Outlayer.prototype.onresize = function() {
            if (this.resizeTimeout) {
                clearTimeout(this.resizeTimeout)
            }
            var _this = this;

            function delayed() {
                _this.resize();
                delete _this.resizeTimeout
            }
            this.resizeTimeout = setTimeout(delayed, 100)
        };
        Outlayer.prototype.resize = function() {
            var size = getSize(this.element);
            var hasSizes = this.size && size;
            if (hasSizes && size.innerWidth === this.size.innerWidth) {
                return
            }
            this.layout()
        };
        Outlayer.prototype.addItems = function(elems) {
            var items = this._itemize(elems);
            if (items.length) {
                this.items = this.items.concat(items)
            }
            return items
        };
        Outlayer.prototype.appended = function(elems) {
            var items = this.addItems(elems);
            if (!items.length) {
                return
            }
            this.layoutItems(items, true);
            this.reveal(items)
        };
        Outlayer.prototype.prepended = function(elems) {
            var items = this._itemize(elems);
            if (!items.length) {
                return
            }
            var previousItems = this.items.slice(0);
            this.items = items.concat(previousItems);
            this._resetLayout();
            this._manageStamps();
            this.layoutItems(items, true);
            this.reveal(items);
            this.layoutItems(previousItems)
        };
        Outlayer.prototype.reveal = function(items) {
            var len = items && items.length;
            if (!len) {
                return
            }
            for (var i = 0; i < len; i++) {
                var item = items[i];
                item.reveal()
            }
        };
        Outlayer.prototype.hide = function(items) {
            var len = items && items.length;
            if (!len) {
                return
            }
            for (var i = 0; i < len; i++) {
                var item = items[i];
                item.hide()
            }
        };
        Outlayer.prototype.getItem = function(elem) {
            for (var i = 0, len = this.items.length; i < len; i++) {
                var item = this.items[i];
                if (item.element === elem) {
                    return item
                }
            }
        };
        Outlayer.prototype.getItems = function(elems) {
            if (!elems || !elems.length) {
                return
            }
            var items = [];
            for (var i = 0, len = elems.length; i < len; i++) {
                var elem = elems[i];
                var item = this.getItem(elem);
                if (item) {
                    items.push(item)
                }
            }
            return items
        };
        Outlayer.prototype.remove = function(elems) {
            elems = makeArray(elems);
            var removeItems = this.getItems(elems);
            if (!removeItems || !removeItems.length) {
                return
            }
            this._itemsOn(removeItems, "remove", function() {
                this.emitEvent("removeComplete", [this, removeItems])
            });
            for (var i = 0, len = removeItems.length; i < len; i++) {
                var item = removeItems[i];
                item.remove();
                removeFrom(item, this.items)
            }
        };
        Outlayer.prototype.destroy = function() {
            var style = this.element.style;
            style.height = "";
            style.position = "";
            style.width = "";
            for (var i = 0, len = this.items.length; i < len; i++) {
                var item = this.items[i];
                item.destroy()
            }
            this.unbindResize();
            delete this.element.outlayerGUID;
            if (jQuery) {
                jQuery.removeData(this.element, this.constructor.namespace)
            }
        };
        Outlayer.data = function(elem) {
            var id = elem && elem.outlayerGUID;
            return id && instances[id]
        };

        function copyOutlayerProto(obj, property) {
            obj.prototype[property] = extend({}, Outlayer.prototype[property])
        }
        Outlayer.create = function(namespace, options) {
            function Layout() {
                Outlayer.apply(this, arguments)
            }
            if (Object.create) {
                Layout.prototype = Object.create(Outlayer.prototype)
            } else {
                extend(Layout.prototype, Outlayer.prototype)
            }
            Layout.prototype.constructor = Layout;
            copyOutlayerProto(Layout, "options");
            extend(Layout.prototype.options, options);
            Layout.namespace = namespace;
            Layout.data = Outlayer.data;
            Layout.Item = function LayoutItem() {
                Item.apply(this, arguments)
            };
            Layout.Item.prototype = new Item;
            docReady(function() {
                var dashedNamespace = toDashed(namespace);
                var elems = document.querySelectorAll(".js-" + dashedNamespace);
                var dataAttr = "data-" + dashedNamespace + "-options";
                for (var i = 0, len = elems.length; i < len; i++) {
                    var elem = elems[i];
                    var attr = elem.getAttribute(dataAttr);
                    var options;
                    try {
                        options = attr && JSON.parse(attr)
                    } catch (error) {
                        if (console) {
                            console.error("Error parsing " + dataAttr + " on " + elem.nodeName.toLowerCase() + (elem.id ? "#" + elem.id : "") + ": " + error)
                        }
                        continue
                    }
                    var instance = new Layout(elem, options);
                    if (jQuery) {
                        jQuery.data(elem, namespace, instance)
                    }
                }
            });
            if (jQuery && jQuery.bridget) {
                jQuery.bridget(namespace, Layout)
            }
            return Layout
        };
        Outlayer.Item = Item;
        return Outlayer
    }
    if (typeof define === "function" && define.amd) {
        define(["eventie/eventie", "doc-ready/doc-ready", "eventEmitter/EventEmitter", "get-size/get-size", "matches-selector/matches-selector", "./item"], outlayerDefinition);

    } else {
        window.Outlayer = outlayerDefinition(window.eventie, window.docReady, window.EventEmitter, window.getSize, window.matchesSelector, window.Outlayer.Item)
    }
})(window);
(function(window) {
    "use strict";
    var Packery = window.Packery = function() {};

    function rectDefinition() {
        function Rect(props) {
            for (var prop in Rect.defaults) {
                this[prop] = Rect.defaults[prop]
            }
            for (prop in props) {
                this[prop] = props[prop]
            }
        }
        Packery.Rect = Rect;
        Rect.defaults = {
            x: 0,
            y: 0,
            width: 0,
            height: 0
        };
        Rect.prototype.contains = function(rect) {
            var otherWidth = rect.width || 0;
            var otherHeight = rect.height || 0;
            return this.x <= rect.x && this.y <= rect.y && this.x + this.width >= rect.x + otherWidth && this.y + this.height >= rect.y + otherHeight
        };
        Rect.prototype.overlaps = function(rect) {
            var thisRight = this.x + this.width;
            var thisBottom = this.y + this.height;
            var rectRight = rect.x + rect.width;
            var rectBottom = rect.y + rect.height;
            return this.x < rectRight && thisRight > rect.x && this.y < rectBottom && thisBottom > rect.y
        };
        Rect.prototype.getMaximalFreeRects = function(rect) {
            if (!this.overlaps(rect)) {
                return false
            }
            var freeRects = [];
            var freeRect;
            var thisRight = this.x + this.width;
            var thisBottom = this.y + this.height;
            var rectRight = rect.x + rect.width;
            var rectBottom = rect.y + rect.height;
            if (this.y < rect.y) {
                freeRect = new Rect({
                    x: this.x,
                    y: this.y,
                    width: this.width,
                    height: rect.y - this.y
                });
                freeRects.push(freeRect)
            }
            if (thisRight > rectRight) {
                freeRect = new Rect({
                    x: rectRight,
                    y: this.y,
                    width: thisRight - rectRight,
                    height: this.height
                });
                freeRects.push(freeRect)
            }
            if (thisBottom > rectBottom) {
                freeRect = new Rect({
                    x: this.x,
                    y: rectBottom,
                    width: this.width,
                    height: thisBottom - rectBottom
                });
                freeRects.push(freeRect)
            }
            if (this.x < rect.x) {
                freeRect = new Rect({
                    x: this.x,
                    y: this.y,
                    width: rect.x - this.x,
                    height: this.height
                });
                freeRects.push(freeRect)
            }
            return freeRects
        };
        Rect.prototype.canFit = function(rect) {
            return this.width >= rect.width && this.height >= rect.height
        };
        return Rect
    }
    if (typeof define === "function" && define.amd) {
        define(rectDefinition)
    } else {
        window.Packery = window.Packery || {};
        window.Packery.Rect = rectDefinition()
    }
})(window);
(function(window) {
    "use strict";

    function packerDefinition(Rect) {
        function Packer(width, height, sortDirection) {
            this.width = width || 0;
            this.height = height || 0;
            this.sortDirection = sortDirection || "downwardLeftToRight";
            this.reset()
        }
        Packer.prototype.reset = function() {
            this.spaces = [];
            this.newSpaces = [];
            if (this.center) {
                var initialSpaces = [new Rect({
                    x: 0,
                    y: 0,
                    width: this.center.x,
                    height: this.center.y,
                    nearestCornerDistance: 0
                }), new Rect({
                    x: this.center.x,
                    y: 0,
                    width: this.width - this.center.x,
                    height: this.center.y,
                    nearestCornerDistance: 0
                }), new Rect({
                    x: 0,
                    y: this.center.y,
                    width: this.center.x,
                    height: this.height - this.center.y,
                    nearestCornerDistance: 0
                }), new Rect({
                    x: this.center.x,
                    y: this.center.y,
                    width: this.width - this.center.x,
                    height: this.height - this.center.y,
                    nearestCornerDistance: 0
                })];
                this.spaces = this.spaces.concat(initialSpaces)
            } else {
                var initialSpace = new Rect({
                    x: 0,
                    y: 0,
                    width: this.width,
                    height: this.height
                });
                this.spaces.push(initialSpace)
            }
            this.sorter = sorters[this.sortDirection] || sorters.downwardLeftToRight
        };
        Packer.prototype.pack = function(rect) {
            for (var i = 0, len = this.spaces.length; i < len; i++) {
                var space = this.spaces[i];
                if (space.canFit(rect)) {
                    this.placeInSpace(rect, space);
                    break
                }
            }
        };
        Packer.prototype.placeInSpace = function(rect, space) {
            if (this.center) {
                rect.x = space.x >= this.center.x ? space.x : space.x + space.width - rect.width;
                rect.y = space.y >= this.center.y ? space.y : space.y + space.height - rect.height
            } else {
                rect.x = space.x;
                rect.y = space.y
            }
            this.placed(rect)
        };
        Packer.prototype.placed = function(rect) {
            var revisedSpaces = [];
            for (var i = 0, len = this.spaces.length; i < len; i++) {
                var space = this.spaces[i];
                var newSpaces = space.getMaximalFreeRects(rect);
                if (newSpaces) {
                    revisedSpaces.push.apply(revisedSpaces, newSpaces);
                    this.measureNearestCornerDistance(newSpaces)
                } else {
                    revisedSpaces.push(space)
                }
            }
            this.spaces = revisedSpaces;
            Packer.mergeRects(this.spaces);
            this.spaces.sort(this.sorter)
        };
        Packer.prototype.measureNearestCornerDistance = function(spaces) {
            if (!this.center) {
                return
            }
            for (var i = 0, len = spaces.length; i < len; i++) {
                var space = spaces[i];
                var corner = {
                    x: space.x >= this.center.x ? space.x : space.x + space.width,
                    y: space.y >= this.center.y ? space.y : space.y + space.height
                };
                space.nearestCornerDistance = getDistance(corner, this.center)
            }
        };

        function getDistance(pointA, pointB) {
            var dx = pointB.x - pointA.x;
            var dy = pointB.y - pointA.y;
            return Math.sqrt(dx * dx + dy * dy)
        }
        Packer.mergeRects = function(rects) {
            for (var i = 0, len = rects.length; i < len; i++) {
                var rect = rects[i];
                if (!rect) {
                    continue
                }
                var compareRects = rects.slice(0);
                compareRects.splice(i, 1);
                var removedCount = 0;
                for (var j = 0, jLen = compareRects.length; j < jLen; j++) {
                    var compareRect = compareRects[j];
                    var indexAdjust = i > j ? 0 : 1;
                    if (rect.contains(compareRect)) {
                        rects.splice(j + indexAdjust - removedCount, 1);
                        removedCount++
                    }
                }
            }
            return rects
        };
        var sorters = {
            downwardLeftToRight: function(a, b) {
                return a.y - b.y || a.x - b.x
            },
            rightwardTopToBottom: function(a, b) {
                return a.x - b.x || a.y - b.y
            },
            centeredOutCorners: function(a, b) {
                return a.nearestCornerDistance - b.nearestCornerDistance
            }
        };
        return Packer
    }
    if (typeof define === "function" && define.amd) {
        define(["./rect"], packerDefinition)
    } else {
        var Packery = window.Packery = window.Packery || {};
        Packery.Packer = packerDefinition(Packery.Rect)
    }
})(window);
(function(window) {
    "use strict";

    function itemDefinition(getStyleProperty, Outlayer, Rect) {
        var transformProperty = getStyleProperty("transform");
        var Item = function PackeryItem() {
            Outlayer.Item.apply(this, arguments)
        };
        Item.prototype = new Outlayer.Item;
        var protoCreate = Item.prototype._create;
        Item.prototype._create = function() {
            protoCreate.call(this);
            this.rect = new Rect;
            this.placeRect = new Rect
        };
        Item.prototype.dragStart = function() {
            this.getPosition();
            this.removeTransitionStyles();
            if (this.isTransitioning && transformProperty) {
                this.element.style[transformProperty] = "none"
            }
            this.getSize();
            this.isPlacing = true;
            this.needsPositioning = false;
            this.positionPlaceRect(this.position.x, this.position.y);
            this.isTransitioning = false;
            this.didDrag = false
        };
        Item.prototype.dragMove = function(x, y) {
            this.didDrag = true;
            var packerySize = this.layout.size;
            x -= packerySize.paddingLeft;
            y -= packerySize.paddingTop;
            this.positionPlaceRect(x, y)
        };
        Item.prototype.dragStop = function() {
            this.getPosition();
            var isDiffX = this.position.x !== this.placeRect.x;
            var isDiffY = this.position.y !== this.placeRect.y;
            this.needsPositioning = isDiffX || isDiffY;
            this.didDrag = false
        };
        Item.prototype.positionPlaceRect = function(x, y, isMaxYOpen) {
            this.placeRect.x = this.getPlaceRectCoord(x, true);
            this.placeRect.y = this.getPlaceRectCoord(y, false, isMaxYOpen)
        };
        Item.prototype.getPlaceRectCoord = function(coord, isX, isMaxOpen) {
            var measure = isX ? "Width" : "Height";
            var size = this.size["outer" + measure];
            var segment = this.layout[isX ? "columnWidth" : "rowHeight"];
            var parentSize = this.layout.size["inner" + measure];
            if (!isX) {
                parentSize = Math.max(parentSize, this.layout.maxY);
                if (!this.layout.rowHeight) {
                    parentSize -= this.layout.gutter
                }
            }
            var max;
            if (segment) {
                segment += this.layout.gutter;
                parentSize += isX ? this.layout.gutter : 0;
                coord = Math.round(coord / segment);
                var mathMethod;
                if (this.layout.options.isHorizontal) {
                    mathMethod = !isX ? "floor" : "ceil"
                } else {
                    mathMethod = isX ? "floor" : "ceil"
                }
                var maxSegments = Math[mathMethod](parentSize / segment);
                maxSegments -= Math.ceil(size / segment);
                max = maxSegments
            } else {
                max = parentSize - size
            }
            coord = isMaxOpen ? coord : Math.min(coord, max);
            coord *= segment || 1;
            return Math.max(0, coord)
        };
        Item.prototype.copyPlaceRectPosition = function() {
            this.rect.x = this.placeRect.x;
            this.rect.y = this.placeRect.y
        };
        return Item
    }
    if (typeof define === "function" && define.amd) {
        define(["get-style-property/get-style-property", "outlayer/outlayer", "./rect"], itemDefinition)
    } else {
        window.Packery.Item = itemDefinition(window.getStyleProperty, window.Outlayer, window.Packery.Rect)
    }
})(window);
(function(window) {
    "use strict";

    function packeryDefinition(classie, getSize, Outlayer, Rect, Packer, Item) {
        var Packery = Outlayer.create("packery");
        Packery.Item = Item;
        Packery.prototype._create = function() {
            Outlayer.prototype._create.call(this);
            this.packer = new Packer;
            this.stamp(this.options.stamped);
            var _this = this;
            this.handleDraggabilly = {
                dragStart: function(draggie) {
                    _this.itemDragStart(draggie.element)
                },
                dragMove: function(draggie) {
                    _this.itemDragMove(draggie.element, draggie.position.x, draggie.position.y)
                },
                dragEnd: function(draggie) {
                    _this.itemDragEnd(draggie.element)
                }
            };
            this.handleUIDraggable = {
                start: function handleUIDraggableStart(event) {
                    _this.itemDragStart(event.currentTarget)
                },
                drag: function handleUIDraggableDrag(event, ui) {
                    _this.itemDragMove(event.currentTarget, ui.position.left, ui.position.top)
                },
                stop: function handleUIDraggableStop(event) {
                    _this.itemDragEnd(event.currentTarget)
                }
            }
        };
        Packery.prototype._resetLayout = function() {
            this.getSize();
            this._getMeasurements();
            var packer = this.packer;
            if (this.options.isHorizontal) {
                packer.width = Number.POSITIVE_INFINITY;
                packer.height = this.size.innerHeight + this.gutter;
                packer.sortDirection = "rightwardTopToBottom"
            } else {
                packer.width = Number.POSITIVE_INFINITY;
                packer.height = Number.POSITIVE_INFINITY;
                packer.sortDirection = "downwardLeftToRight"
            }
            var centered = this.options.centered;
            if (centered) {
                packer.center = {};
                packer.center.x = centered.x || !this.options.isHorizontal && this.size.innerWidth / 2 || 0;
                packer.center.y = centered.y || this.options.isHorizontal && this.size.innerHeight / 2 || 0;
                packer.sortDirection = "centeredOutCorners"
            }
            packer.reset();
            this.maxY = 0;
            this.maxX = 0
        };
        Packery.prototype._getMeasurements = function() {
            this._getMeasurement("columnWidth", "width");
            this._getMeasurement("rowHeight", "height");
            this._getMeasurement("gutter", "width")
        };
        Packery.prototype._getItemLayoutPosition = function(item) {
            this._packItem(item);
            return item.rect
        };
        Packery.prototype._packItem = function(item) {
            this._setRectSize(item.element, item.rect);
            this.packer.pack(item.rect);
            this._setMaxXY(item.rect)
        };
        Packery.prototype._setMaxXY = function(rect) {
            this.maxX = Math.max(rect.x + rect.width, this.maxX);
            this.maxY = Math.max(rect.y + rect.height, this.maxY)
        };
        Packery.prototype._setRectSize = function(elem, rect) {
            var size = getSize(elem);
            var w = size.outerWidth;
            var h = size.outerHeight;
            var colW = this.columnWidth + this.gutter;
            var rowH = this.rowHeight + this.gutter;
            w = this.columnWidth ? Math.ceil(w / colW) * colW : w + this.gutter;
            h = this.rowHeight ? Math.ceil(h / rowH) * rowH : h + this.gutter;
            rect.width = Math.min(w, this.packer.width);
            rect.height = h
        };
        Packery.prototype._getContainerSize = function() {
            if (this.options.isHorizontal) {
                return {
                    width: this.maxX - this.gutter
                }
            } else {
                return {
                    height: this.maxY - this.gutter
                }
            }
        };
        Packery.prototype._manageStamp = function(elem) {
            var item = this.getItem(elem);
            var rect;
            if (item && item.isPlacing) {
                rect = item.placeRect
            } else {
                var offset = this._getElementOffset(elem);
                rect = new Rect({
                    x: this.options.isOriginLeft ? offset.left : offset.right,
                    y: this.options.isOriginTop ? offset.top : offset.bottom
                })
            }
            this._setRectSize(elem, rect);
            this.packer.placed(rect);
            this._setMaxXY(rect)
        };
        Packery.prototype.sortItemsByPosition = function() {
            this.items.sort(function(a, b) {
                return a.position.y - b.position.y || a.position.x - b.position.x
            })
        };
        Packery.prototype.fit = function(elem, x, y) {
            var item = this.getItem(elem);
            if (!item) {
                return
            }
            this._getMeasurements();
            this.stamp(item.element);
            item.getSize();
            item.isPlacing = true;
            x = x === undefined ? item.rect.x : x;
            y = y === undefined ? item.rect.y : y;
            item.positionPlaceRect(x, y, true);
            this._bindFitEvents(item);
            item.moveTo(item.placeRect.x, item.placeRect.y);
            this.layout();
            this.unstamp(item.element);
            this.sortItemsByPosition();
            item.isPlacing = false;
            item.copyPlaceRectPosition()
        };
        Packery.prototype._bindFitEvents = function(item) {
            var _this = this;
            var ticks = 0;

            function tick() {
                ticks++;
                if (ticks !== 2) {
                    return
                }
                _this.emitEvent("fitComplete", [_this, item])
            }
            item.on("layout", function() {
                tick();
                return true
            });
            this.on("layoutComplete", function() {
                tick();
                return true
            })
        };
        Packery.prototype.resize = function() {
            var size = getSize(this.element);
            var hasSizes = this.size && size;
            var innerSize = this.options.isHorizontal ? "innerHeight" : "innerWidth";
            if (hasSizes && size[innerSize] === this.size[innerSize]) {
                return
            }
            this.layout()
        };
        Packery.prototype.itemDragStart = function(elem) {
            this.stamp(elem);
            var item = this.getItem(elem);
            if (item) {
                item.dragStart()
            }
        };
        Packery.prototype.itemDragMove = function(elem, x, y) {
            var item = this.getItem(elem);
            if (item) {
                item.dragMove(x, y)
            }
            var _this = this;

            function delayed() {
                _this.layout();
                delete _this.dragTimeout
            }
            this.clearDragTimeout();
            this.dragTimeout = setTimeout(delayed, 40)
        };
        Packery.prototype.clearDragTimeout = function() {
            if (this.dragTimeout) {
                clearTimeout(this.dragTimeout)
            }
        };
        Packery.prototype.itemDragEnd = function(elem) {
            var item = this.getItem(elem);
            var itemDidDrag;
            if (item) {
                itemDidDrag = item.didDrag;
                item.dragStop()
            }
            if (!item || !itemDidDrag && !item.needsPositioning) {
                this.unstamp(elem);
                return
            }
            classie.add(item.element, "is-positioning-post-drag");
            var onLayoutComplete = this._getDragEndLayoutComplete(elem, item);
            if (item.needsPositioning) {
                item.on("layout", onLayoutComplete);
                item.moveTo(item.placeRect.x, item.placeRect.y)
            } else if (item) {
                item.copyPlaceRectPosition()
            }
            this.clearDragTimeout();
            this.on("layoutComplete", onLayoutComplete);
            this.layout()
        };
        Packery.prototype._getDragEndLayoutComplete = function(elem, item) {
            var itemNeedsPositioning = item && item.needsPositioning;
            var completeCount = 0;
            var asyncCount = itemNeedsPositioning ? 2 : 1;
            var _this = this;
            return function onLayoutComplete() {
                completeCount++;
                if (completeCount !== asyncCount) {
                    return true
                }
                if (item) {
                    classie.remove(item.element, "is-positioning-post-drag");
                    item.isPlacing = false;
                    item.copyPlaceRectPosition()
                }
                _this.unstamp(elem);
                _this.sortItemsByPosition();
                if (itemNeedsPositioning) {
                    _this.emitEvent("dragItemPositioned", [_this, item])
                }
                return true
            }
        };
        Packery.prototype.bindDraggabillyEvents = function(draggie) {
            draggie.on("dragStart", this.handleDraggabilly.dragStart);
            draggie.on("dragMove", this.handleDraggabilly.dragMove);
            draggie.on("dragEnd", this.handleDraggabilly.dragEnd)
        };
        Packery.prototype.bindUIDraggableEvents = function($elems) {
            $elems.on("dragstart", this.handleUIDraggable.start).on("drag", this.handleUIDraggable.drag).on("dragstop", this.handleUIDraggable.stop)
        };
        Packery.Rect = Rect;
        Packery.Packer = Packer;
        return Packery
    }
    if (typeof define === "function" && define.amd) {
        define(["classie/classie", "get-size/get-size", "outlayer/outlayer", "./rect", "./packer", "./item"], packeryDefinition)
    } else {
        window.Packery = packeryDefinition(window.classie, window.getSize, window.Outlayer, window.Packery.Rect, window.Packery.Packer, window.Packery.Item)
    }
})(window);
