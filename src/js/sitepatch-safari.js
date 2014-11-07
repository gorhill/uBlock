// Only for Safari
// Adding new URL requires to whitelist it in the background script too (addContentScriptFromURL)
// Note that the sitePach function will be converted to a string, and injected
// into the web-page in order to run in that scope. Because of this, variables
// from the extension scope won't be accessible in the sitePatch function.
'use strict';

self.vAPI = self.vAPI || {};

if (/^www\.youtube(-nocookie)?\.com/.test(location.host)) {
    vAPI.sitePatch = function() {
        // disable spf
        window.ytspf = {};
        Object.defineProperty(ytspf, 'enabled', {'value': false});

        // based on ExtendTube's ad removing solution
        var p, yt = {}, config_ = {}, ytplayer = {}, playerConfig = { args: {} };

        Object.defineProperties(yt, {
            'playerConfig': {
                get: function() { return playerConfig; },
                set: function(data) {
                    if (data && typeof data === 'object'
                        && data.args && typeof data.args === 'object') {
                        var nope = /ad\d?_|afv|watermark|adsense|xfp/;

                        for (var prop in data.args) {
                            if (nope.test(prop) && !/policy/.test(prop)) {
                                delete data.args[prop];
                            }
                        }
                    }

                    playerConfig = data;

                    var playerRoot = document.querySelector('[data-swf-config]');
                    if (playerRoot)
                        playerRoot.dataset.swfConfig = JSON.stringify(yt.playerConfig);
                }
            },
            'config_': {
                get: function() { return config_; },
                set: function(value) { config_ = value; }
            }
        });

        Object.defineProperty(config_, 'PLAYER_CONFIG', {
            get: function() { return yt.playerConfig; },
            set: function(value) { yt.playerConfig = value; }
        });

        Object.defineProperty(ytplayer, 'config', {
            get: function() { return playerConfig; },
            set: function(value) { yt.playerConfig = value; }
        });

        if (window.yt) {
            for (p in window.yt) { yt[p] = window.yt[p]; }
            window.yt = yt;
        }
        else {
            Object.defineProperty(window, 'yt', {
                get: function() { return yt; },
                set: function() {}
            });
        }

        if (window.ytplayer) {
            for (p in window.ytplayer) { ytplayer[p] = window.ytplayer[p]; }
            window.ytplayer = ytplayer;
        }
        else {
            Object.defineProperty(window, 'ytplayer', {
                get: function() { return ytplayer; },
                set: function() {}
            });
        }
    };
}
/*else if (check url) {
    vAPI.sitePatch do something
}*/
