/* globals Services, sendAsyncMessage, addMessageListener, removeMessageListener */

'use strict';

let appName = 'ublock';
let listeners = {};
let frameModule = Components.utils['import']('chrome://' + appName + '/content/frameModule.js', {});

this.ublock_addMessageListener = function(id, fn) {
    ublock_removeMessageListener(id);
    listeners[id] = function(msg) {
        fn(msg.data);
    };
    addMessageListener(id, listeners[id]);
};

this.ublock_removeMessageListener = function(id) {
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
