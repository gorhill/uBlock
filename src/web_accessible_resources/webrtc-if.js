/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2019-present Raymond Hill

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

(function() {
    'use strict';
    let good = '{{1}}';
    if ( good.startsWith('/') && good.endsWith('/') ) {
        good = good.slice(1, -1);
    } else {
        good = good.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    let reGood;
    try {
        reGood = new RegExp(good);
    } catch(ex) {
        return;
    }
    const rtcName = window.RTCPeerConnection
        ? 'RTCPeerConnection'
        : (window.webkitRTCPeerConnection ? 'webkitRTCPeerConnection' : '');
    if ( rtcName === '' ) { return; }
    const log = console.log.bind(console);
    const neuteredPeerConnections = new WeakSet();
    const isGoodConfig = function(instance, config) {
        if ( neuteredPeerConnections.has(instance) ) { return false; }
        if ( config instanceof Object === false ) { return true; }
        if ( Array.isArray(config.iceServers) === false ) { return true; }
        for ( const server of config.iceServers ) {
            const urls = typeof server.urls === 'string'
                ? [ server.urls ]
                : server.urls;
            if ( Array.isArray(urls) ) {
                for ( const url of urls ) {
                    if ( reGood.test(url) ) { return true; }
                }
            }
            if ( typeof server.username === 'string' ) {
                if ( reGood.test(server.username) ) { return true; }
            }
            if ( typeof server.credential === 'string' ) {
                if ( reGood.test(server.credential) ) { return true; }
            }
        }
        neuteredPeerConnections.add(instance);
        return false;
    };
    const peerConnectionCtor = window[rtcName];
    const peerConnectionProto = peerConnectionCtor.prototype;
    peerConnectionProto.createDataChannel =
        new Proxy(peerConnectionProto.createDataChannel, {
            apply: function(target, thisArg, args) {
                if ( isGoodConfig(target, args[1]) === false ) {
                    log(args[1]);
                    return target.apply(thisArg, args.slice(0, 1));
                }
                return target.apply(thisArg, args);
            },
        });
    window[rtcName] =
        new Proxy(peerConnectionCtor, {
            construct: function(target, args) {
                if ( isGoodConfig(target, args[0]) === false ) {
                    log(args[0]);
                    return new target();
                }
                return new target(...args);
            }
        });
})();
