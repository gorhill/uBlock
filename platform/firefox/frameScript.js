/* globals Services, sendAsyncMessage, addMessageListener, removeMessageListener, content */

(function() {

'use strict';

var
	appName = 'ublock',
	contentBaseURI = 'chrome://' + appName + '/content/js/',
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

var observer = {
	unload: function(e) {
		Services.obs.removeObserver(observer, 'content-document-global-created');
		observer = listeners = null;
	},
	onDOMReady: function(e) {
		var win = e.target.defaultView;

		if (win.location.protocol === 'chrome:' && win.location.host === appName) {
			win.sendAsyncMessage = sendAsyncMessage;
			win.addMessageListener = _addMessageListener;
			win.removeMessageListener = _removeMessageListener;
		}
	},
	observe: function(win) {
		if (!win || win.top !== content) {
			return;
		}

		// baseURI is more reliable
		var location = Services.io.newURI(
			win.location.protocol === 'data:' ? 'data:text/plain,' : win.document.baseURI,
			null,
			null
		);

		if (!(win.document instanceof win.HTMLDocument
				&& (/^https?$/.test(location.scheme)))) {
			return;
		}

		win = Components.utils.Sandbox([win], {
			sandboxPrototype: win,
			wantComponents: false,
			wantXHRConstructor: false
		});

		win.sendAsyncMessage = sendAsyncMessage;
		win.addMessageListener = _addMessageListener;
		win.removeMessageListener = _removeMessageListener;

		var lss = Services.scriptloader.loadSubScript;

		lss(contentBaseURI + 'vapi-client.js', win);
		lss(contentBaseURI + 'contentscript-start.js', win);

		if (win.document.readyState === 'loading') {
			let docReady = function(e) {
				this.removeEventListener(e.type, docReady, true);
				lss(contentBaseURI + 'contentscript-end.js', win);
			};

			win.document.addEventListener('DOMContentLoaded', docReady, true);
		}
		else {
			lss(contentBaseURI + 'contentscript-end.js', win);
		}
	}
};

Services.obs.addObserver(observer, 'content-document-global-created', false);

addEventListener('unload', observer.unload, false);

// for the Options page
addEventListener('DOMContentLoaded', observer.onDOMReady, true);

})();