/* globals Services, sendAsyncMessage, addMessageListener, removeMessageListener */

(function(frameScriptContext) {

'use strict';

let appName;
let listeners = {};

try { throw new Error; } catch (ex) {
    appName = ex.fileName.match(/:\/\/([^\/]+)/)[1];
}

Components.utils['import']('chrome://' + appName + '/content/frameModule.js', {});

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

addMessageListener(appName + ':broadcast', function(msg) {
    for (let id in listeners) {
        listeners[id](msg);
    }
});

})(this);