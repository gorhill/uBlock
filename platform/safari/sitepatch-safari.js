/*******************************************************************************

    µBlock - a browser extension to block requests.
    Copyright (C) 2014 The µBlock authors

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

/* global ytspf */
'use strict';

/******************************************************************************/

// Adding new URL requires to whitelist it in the background script too (addContentScriptFromURL)
// Note that the sitePach function will be converted to a string, and injected
// into the web-page in order to run in that scope. Because of this, variables
// from the extension scope won't be accessible in the sitePatch function.


self.vAPI = self.vAPI || {};

if ( /^www\.youtube(-nocookie)?\.com/.test(location.host) ) {
    vAPI.sitePatch = function() {
        // disable spf
        window.ytspf = {};
        Object.defineProperty(ytspf, 'enabled', {'value': false});

        // Based on ExtendTube's ad removing solution
        var p;
        var yt = {};
        var config_ = {};
        var ytplayer = {};
        var playerConfig = { args: {} };

        Object.defineProperties(yt, {
            'playerConfig': {
                get: function() { return playerConfig; },
                set: function(data) {
                    if ( data && typeof data === 'object'
                        && data.args && typeof data.args === 'object' ) {
                        var nope = /ad\d?_|afv|watermark|adsense|xfp/;

                        for ( var prop in data.args ) {
                            if ( nope.test(prop) && !/policy/.test(prop) ) {
                                delete data.args[prop];
                            }
                        }
                    }

                    playerConfig = data;

                    var playerRoot = document.querySelector('[data-swf-config]');

                    if ( playerRoot ) {
                        playerRoot.dataset.swfConfig = JSON.stringify(yt.playerConfig);
                    }
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

        if ( window.yt ) {
            for ( p in window.yt ) { yt[p] = window.yt[p]; }
            window.yt = yt;
        }
        else {
            Object.defineProperty(window, 'yt', {
                get: function() { return yt; },
                set: function() {}
            });
        }

        if ( window.ytplayer ) {
            for ( p in window.ytplayer ) { ytplayer[p] = window.ytplayer[p]; }
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
/*else if ( check url ) {
    vAPI.sitePatch do something
}*/
