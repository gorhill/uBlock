/* global Services, APP_STARTUP, APP_SHUTDOWN */
/* exported startup, shutdown, install, uninstall */

'use strict';

var bgProcess;
Components.utils['import']('resource://gre/modules/Services.jsm');

function startup(data, reason) {
	bgProcess = function(ev) {
		if (ev) {
			this.removeEventListener('load', bgProcess);
		}

		bgProcess = Services.appShell.hiddenDOMWindow.document;
		bgProcess = bgProcess.documentElement.appendChild(
			bgProcess.createElementNS('http://www.w3.org/1999/xhtml', 'iframe')
		);
		bgProcess.setAttribute('src', 'chrome://ublock/content/background.html');
	};

	if (reason === APP_STARTUP) {
		Services.ww.registerNotification({
			observe: function(subject) {
				Services.ww.unregisterNotification(this);
				subject.addEventListener('load', bgProcess);
			}
		});
	}
	else {
		bgProcess();
	}
}

function shutdown(data, reason) {
	if (reason !== APP_SHUTDOWN) {
		bgProcess.parentNode.removeChild(bgProcess);
	}
}

function install() {
	// https://bugzil.la/719376
	Services.strings.flushBundles();
}

function uninstall() {}