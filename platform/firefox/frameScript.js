/* globals Services, sendAsyncMessage, addMessageListener, removeMessageListener, content */

(function() {

'use strict';

var
	app_name = 'ublock',
	app_baseURI = 'chrome://' + app_name + '/content/js/',
	listeners = {},
	_addMessageListener = function(id, fn) {
		_removeMessageListener(id);
		listeners[id] = function(msg) {
			fn(msg.data);
		};
		addMessageListener(id, listeners[id]);
	},
	_removeMessageListener = function(id) {
		if (listeners[id]) {
			removeMessageListener(id, listeners[id]);
		}

		delete listeners[id];
	};

addMessageListener('µBlock:broadcast', function(msg) {
	for (var id in listeners) {
		listeners[id](msg.data);
	}
});

})();