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
    let arg1 = '{{1}}';
    if ( arg1 === '{{1}}' ) { arg1 = ''; }
    let arg2 = '{{2}}';
    if ( arg2 === '{{2}}' ) { arg2 = ''; }
    let arg3 = '{{3}}';
    if ( arg3 === '{{3}}' ) { arg3 = ''; }
    const log = arg3 !== ''
        ? console.log.bind(console)
        : ( ) => { };
    const newSyntax = /^[01]?$/.test(arg1) === false;
    let pattern = '';
    let targetResult = true;
    let autoRemoveAfter = -1;
    if ( newSyntax ) {
        pattern = arg1;
        if ( pattern.startsWith('!') ) {
            targetResult = false;
            pattern = pattern.slice(1);
        }
        autoRemoveAfter = parseInt(arg2);
        if ( isNaN(autoRemoveAfter) ) {
            autoRemoveAfter = -1;
        } 
    } else {
        pattern = arg2;
        if ( arg1 === '0' ) {
            targetResult = false;
        }
    }
    if ( pattern === '' ) {
        pattern = '.?';
    } else if ( /^\/.+\/$/.test(pattern) ) {
        pattern = pattern.slice(1,-1);
    } else {
        pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    const rePattern = new RegExp(pattern);
    window.open = new Proxy(window.open, {
        apply: function(target, thisArg, args) {
            log('window.open:', ...args);
            const url = args[0];
            if ( rePattern.test(url) !== targetResult ) {
                return target.apply(thisArg, args);
            }
            if ( autoRemoveAfter < 0 ) { return null; }
            const iframe = document.createElement('iframe');
            iframe.src = url;
            iframe.style.setProperty('display','none', 'important');
            iframe.style.setProperty('height','1px', 'important');
            iframe.style.setProperty('width','1px', 'important');
            document.body.appendChild(iframe);
            setTimeout(( ) => iframe.remove(), autoRemoveAfter * 1000);
            if ( arg3 === '' ) { return iframe.contentWindow; }
            return new Proxy(iframe.contentWindow, {
                get: function(target, prop) {
                    log('window.open / get', prop, '===', target[prop]);
                    return target[prop];
                },
                set: function(target, prop, value) {
                    log('window.open / set', prop, '=', value);
                    target[prop] = value;
                },
            });
        }
    });
})();
