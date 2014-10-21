// could be used for background and other extension pages

(function() {
'use strict';

window.vAPI = window.vAPI || {};

// http://www.w3.org/International/questions/qa-scripts#directions
var setScriptDirection = function(langugae) {
    document.body.setAttribute(
        'dir',
        ~['ar', 'he', 'fa', 'ps', 'ur'].indexOf(langugae) ? 'rtl' : 'ltr'
    );
};

vAPI.download = function(details) {
    if (!details.url) {
        return;
    }

    var a = document.createElement('a');

    if ('download' in a) {
        a.href = details.url;
        a.setAttribute('download', details.filename || '');
        a.dispatchEvent(new MouseEvent('click'));
    }
    else {
        var messager = vAPI.messaging.channel('_download');
        messager.send({
            what: 'gotoURL',
            details: {
                url: details.url,
                index: -1
            }
        });
        messager.close();
    }
};

if (window.chrome) {
    var chrome = window.chrome;

    vAPI.getURL = function(path) {
        return chrome.runtime.getURL(path);
    };

    vAPI.i18n = function(s) {
        return chrome.i18n.getMessage(s) || s;
    };

    setScriptDirection(vAPI.i18n('@@ui_locale'));
} else if (window.safari) {
    vAPI.getURL = function(path) {
        return safari.extension.baseURI + path;
    };

    var xhr = new XMLHttpRequest;
    xhr.overrideMimeType('application/json;charset=utf-8');
    xhr.open('GET', './locales.json', false);
    xhr.send();
    vAPI.i18nData = JSON.parse(xhr.responseText);

    if (vAPI.i18nData[vAPI.i18n = navigator.language.replace('-', '_')]
        || vAPI.i18nData[vAPI.i18n = vAPI.i18n.slice(0, 2)]) {
        vAPI.i18nLocale = vAPI.i18n;
    } else {
        vAPI.i18nLocale = vAPI.i18nData._;
    }

    xhr = new XMLHttpRequest;
    xhr.overrideMimeType('application/json;charset=utf-8');
    xhr.open('GET', './_locales/' + vAPI.i18nLocale + '/messages.json', false);
    xhr.send();
    vAPI.i18nData = JSON.parse(xhr.responseText);

    for (var i18nKey in vAPI.i18nData) {
        vAPI.i18nData[i18nKey] = vAPI.i18nData[i18nKey].message;
    }

    vAPI.i18n = function(s) {
        return this.i18nData[s] || s;
    };

    setScriptDirection(vAPI.i18nLocale);

    // update popover size to its content
    if (safari.self.identifier === 'popover' && safari.self) {
        window.addEventListener('load', function() {
            // Initial dimensions are set in Info.plist
            var pWidth = safari.self.width;
            var pHeight = safari.self.height;
            var upadteTimer = null;
            var resizePopover = function() {
                if (upadteTimer) {
                    return;
                }

                upadteTimer = setTimeout(function() {
                    safari.self.width = Math.max(pWidth, document.body.clientWidth);
                    safari.self.height = Math.max(pHeight, document.body.clientHeight);
                    upadteTimer = null;
                }, 20);
            };

            var mutObs = window.MutationObserver || window.WebkitMutationObserver;

            if (mutObs) {
                (new mutObs(resizePopover)).observe(document, {
                    childList: true,
                    attributes: true,
                    characterData: true,
                    subtree: true
                });
            }
            else {
                // Safari doesn't support DOMAttrModified
                document.addEventListener('DOMSubtreeModified', resizePopover);
            }
        });
    }
}

})();