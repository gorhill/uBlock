/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

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

/* global vAPI, µBlock */

/******************************************************************************/

(function(){

'use strict';

/******************************************************************************/

µBlock.getNetFilteringSwitch = function(url, domain) {
    var keyHostname = this.URI.hostnameFromURI(url);
    var pos = url.indexOf('#');
    var keyURL = pos !== -1 ? url.slice(0, pos) : url;

    // The caller may provide an already known domain -- convenient to reduce
    // overhead of extracting a domain from the url
    if ( typeof domain !== 'string' ) {
        domain = this.URI.domainFromHostname(keyHostname);
    }

    // https://github.com/gorhill/uBlock/issues/185
    // Use hostname if no domain can be extracted
    if ( domain === '' ) {
        domain = keyHostname;
    }

    var exceptions = this.netWhitelist[domain];
    if ( !exceptions ) {
        return true;
    }

    var i = exceptions.length;
    while ( i-- ) {
        if ( matchWhitelistException(keyURL, keyHostname, exceptions[i]) ) {
            // console.log('"%s" matche url "%s"', exceptions[i], keyURL);
            return false;
        }
    }
    return true;
};

/******************************************************************************/

µBlock.toggleNetFilteringSwitch = function(url, scope, newState) {
    var keyHostname = this.URI.hostnameFromURI(url);
    var pos = url.indexOf('#');
    var keyURL = pos !== -1 ? url.slice(0, pos) : url;
    var key = scope === 'page' ? keyURL : keyHostname;

    // The caller may provide an already known domain -- convenient to reduce
    // overhead of extracting a domain from `key`
    var domain = this.URI.domainFromHostname(keyHostname);

    // https://github.com/gorhill/uBlock/issues/185
    // Use hostname if no domain can be extracted
    if ( domain === '' ) {
        domain = keyHostname;
    }

    var currentState = this.getNetFilteringSwitch(url, domain);
    if ( newState === undefined ) {
        newState = !currentState;
    }
    if ( newState === currentState ) {
        return currentState;
    }

    var netWhitelist = this.netWhitelist;
    var exceptions = netWhitelist[domain];
    if ( !exceptions ) {
        exceptions = netWhitelist[domain] = [];
    }

    // Add to exception list
    if ( !newState ) {
        exceptions.push(key);
        this.saveWhitelist();
        return true;
    }

    // Remove from exception list whatever causes current URL to be whitelisted
    var i = exceptions.length;
    while ( i-- ) {
        if ( matchWhitelistException(keyURL, keyHostname, exceptions[i]) ) {
            exceptions.splice(i, 1);
        }
    }
    if ( exceptions.length === 0 ) {
        delete netWhitelist[domain];
    }
    this.saveWhitelist();
    return true;
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/405
// Be more flexible with whitelist syntax

// TODO: Need to harden it against edge cases, like when an asterisk is used in
// place of protocol.

var matchWhitelistException = function(url, hostname, exception) {
    // Exception is a plain hostname
    if ( exception.indexOf('/') === -1 ) {
        return hostname.slice(-exception.length) === exception;
    }
    // Match URL exactly
    if ( exception.indexOf('*') === -1 ) {
        return url === exception;
    }
    // Regex escape code inspired from:
    //   "Is there a RegExp.escape function in Javascript?"
    //   http://stackoverflow.com/a/3561711
    var reStr = exception.replace(whitelistExceptionEscape, '\\$&')
                         .replace(whitelistExceptionEscapeAsterisk, '.*');
    var re = new RegExp(reStr);
    return re.test(url);
};

// Any special regexp char will be escaped
var whitelistExceptionEscape = /[-\/\\^$+?.()|[\]{}]/g;

// All `*` will be expanded into `.*`
var whitelistExceptionEscapeAsterisk = /\*/g;

/******************************************************************************/

// For now we will use the net exception list

µBlock.getCosmeticFilteringSwitch = function(url, domain) {
    return this.getNetFilteringSwitch(url, domain);
};

/******************************************************************************/

µBlock.stringFromWhitelist = function(exceptions) {
    var r = {};
    var i, bucket;
    for ( var domain in exceptions ) {
        if ( exceptions.hasOwnProperty(domain) === false ) {
            continue;
        }
        bucket = exceptions[domain];
        for ( i = 0; i < bucket.length; i++ ) {
            r[bucket[i]] = true;
        }
    }
    return Object.keys(r).sort(function(a,b){return a.localeCompare(b);}).join('\n');
};

/******************************************************************************/

µBlock.whitelistFromString = function(s) {
    var exceptions = {};
    var lines = s.split(/[\n\r]+/);
    var line, hostname, domain, bucket;
    for ( var i = 0; i < lines.length; i++ ) {
        line = lines[i].trim();
        hostname = line.indexOf('/') !== -1 ? this.URI.hostnameFromURI(line) : line;
        domain = this.URI.domainFromHostname(hostname);
        // https://github.com/gorhill/uBlock/issues/185
        // Use hostname if no domain can be extracted
        if ( domain === '' ) {
            domain = hostname;
        }
        bucket = exceptions[domain];
        if ( bucket === undefined ) {
            exceptions[domain] = [line];
        } else {
            bucket.push(line);
        }
    }
    return exceptions;
};

/******************************************************************************/

// Return all settings if none specified.

µBlock.changeUserSettings = function(name, value) {
    if ( name === undefined ) {
        return this.userSettings;
    }

    if ( typeof name !== 'string' || name === '' ) {
        return;
    }

    // Do not allow an unknown user setting to be created
    if ( this.userSettings[name] === undefined ) {
        return;
    }

    if ( value === undefined ) {
        return this.userSettings[name];
    }

    // Pre-change
    switch ( name ) {
        default:
            break;
    }

    // Change
    this.userSettings[name] = value;

    // Post-change
    switch ( name ) {
        case 'contextMenuEnabled':
            this.contextMenu.toggle(value);
            break;
        case 'experimentalEnabled':
            if ( typeof this.mirrors === 'object' ) {
                this.mirrors.toggle(value);
            }
            break;
        default:
            break;
    }

    this.saveUserSettings();
};

/******************************************************************************/

µBlock.transposeType = function(type, path) {
    if ( type !== 'other' ) {
        return type;
    }
    var pos = path.lastIndexOf('.');
    if ( pos === -1 ) {
        return type;
    }
    var ext = path.slice(pos) + '.';
    if ( '.css.eot.ttf.otf.svg.woff.woff2.'.indexOf(ext) !== -1 ) {
        return 'stylesheet';
    }
    if ( '.ico.png.gif.jpg.jpeg.'.indexOf(ext) !== -1 ) {
        return 'image';
    }
    return type;
};

/******************************************************************************/

µBlock.elementPickerExec = function(tabId, targetElement) {
    this.elementPickerTarget = targetElement || '';
    vAPI.tabs.injectScript(tabId, { file: 'js/element-picker.js' });
};

/******************************************************************************/

µBlock.toggleDynamicFilter = function(details) {
    var changed = false;
    if ( details.block ) {
        changed = this.netFilteringEngine.dynamicFilterBlock(details.hostname, details.requestType, details.firstParty);
    } else {
        changed = this.netFilteringEngine.dynamicFilterUnblock(details.hostname, details.requestType, details.firstParty);
    }
    if ( changed ) {
        this.userSettings.dynamicFilteringSelfie = this.netFilteringEngine.selfieFromDynamicFilters();
        this.XAL.keyvalSetOne('dynamicFilteringSelfie', this.userSettings.dynamicFilteringSelfie);
    }
};

/******************************************************************************/

})();