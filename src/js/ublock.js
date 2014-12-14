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

var µb = µBlock;

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/405
// Be more flexible with whitelist syntax

var matchWhitelistException = function(url, exception) {
    // Exception is a plain hostname
    if ( exception.indexOf('/') === -1 ) {
        return µb.URI.hostnameFromURI(url).slice(-exception.length) === exception;
    }
    // Match URL exactly
    if ( exception.indexOf('*') === -1 ) {
        return url === exception;
    }
    // Regex escape code inspired from:
    //   "Is there a RegExp.escape function in Javascript?"
    //   http://stackoverflow.com/a/3561711
    var reStr = exception.replace(whitelistDirectiveEscape, '\\$&')
                         .replace(whitelistDirectiveEscapeAsterisk, '.*');
    var re = new RegExp(reStr);
    return re.test(url);
};

// Any special regexp char will be escaped
var whitelistDirectiveEscape = /[-\/\\^$+?.()|[\]{}]/g;

// All `*` will be expanded into `.*`
var whitelistDirectiveEscapeAsterisk = /\*/g;

// Probably manually entered whitelist directive
var isHandcraftedWhitelistDirective = function(directive) {
    if ( directive.indexOf('/') === -1 ) {
        return false;
    }
    return directive.indexOf('*') !== -1 || directive.slice(0, 4) !== 'http';
};

/******************************************************************************/

µBlock.getNetFilteringSwitch = function(url) {
    var buckets, i;
    var hostname = this.URI.hostnameFromURI(url);
    var pos = url.indexOf('#');
    url = pos !== -1 ? url.slice(0, pos) : url;
    var netWhitelist = this.netWhitelist;
    for (;;) {
        if ( netWhitelist.hasOwnProperty(hostname) ) {
            buckets = netWhitelist[hostname];
            i = buckets.length;
            while ( i-- ) {
                if ( matchWhitelistException(url, buckets[i]) ) {
                    // console.log('"%s" matche url "%s"', buckets[i], keyURL);
                    return false;
                }
            }
        }
        pos = hostname.indexOf('.');
        if ( pos === -1 ) {
            break;
        }
        hostname = hostname.slice(pos + 1);
    }
    return true;
};

/******************************************************************************/

µBlock.toggleNetFilteringSwitch = function(url, scope, newState) {
    var currentState = this.getNetFilteringSwitch(url);
    if ( newState === undefined ) {
        newState = !currentState;
    }
    if ( newState === currentState ) {
        return currentState;
    }

    var hostname = this.URI.hostnameFromURI(url);
    var pos = url.indexOf('#');
    url = pos !== -1 ? url.slice(0, pos) : url;

    var directive = scope === 'page' ? url : hostname;
    var netWhitelist = this.netWhitelist;
    var buckets;

    // Add to exception list
    if ( newState === false ) {
        if ( netWhitelist.hasOwnProperty(hostname) === false ) {
            buckets = netWhitelist[hostname] = [];
        }
        buckets.push(directive);
        this.saveWhitelist();
        return true;
    }

    // Remove from exception list whatever causes current URL to be whitelisted
    var i;
    for (;;) {
        if ( netWhitelist.hasOwnProperty(hostname) ) {
            buckets = netWhitelist[hostname];
            i = buckets.length;
            while ( i-- ) {
                directive = buckets[i];
                if ( !matchWhitelistException(url, directive) ) {
                    continue;
                }
                buckets.splice(i, 1);
                // If it is a directive which can't be created easily through
                // the user interface, keep it around as a commented out
                // directive
                if ( isHandcraftedWhitelistDirective(directive) ) {
                    netWhitelist['#'].push('# ' + directive);
                }
            }
            if ( buckets.length === 0 ) {
                delete netWhitelist[hostname];
            }
        }
        pos = hostname.indexOf('.');
        if ( pos === -1 ) {
            break;
        }
        hostname = hostname.slice(pos + 1);
    }
    this.saveWhitelist();
    return true;
};

/******************************************************************************/

// For now we will use the net exception list

µBlock.getCosmeticFilteringSwitch = function(url, domain) {
    return this.getNetFilteringSwitch(url, domain);
};

/******************************************************************************/

µBlock.stringFromWhitelist = function(whitelist) {
    var r = {};
    var i, bucket;
    for ( var key in whitelist ) {
        if ( whitelist.hasOwnProperty(key) === false ) {
            continue;
        }
        bucket = whitelist[key];
        i = bucket.length;
        while ( i-- ) {
            r[bucket[i]] = true;
        }
    }
    return Object.keys(r).sort(function(a,b){return a.localeCompare(b);}).join('\n');
};

/******************************************************************************/

µBlock.whitelistFromString = function(s) {
    var whitelist = {
        '#': []
    };
    var reInvalidHostname = /[^a-z0-9.\-\[\]:]/;
    var reHostnameExtractor = /([a-z0-9\[][a-z0-9.\-:]*[a-z0-9\]])\/(?:[^\x00-\x20\/]|$)[^\x00-\x20]*$/;
    var lines = s.split(/[\n\r]+/);
    var line, matches, key, directive;
    for ( var i = 0; i < lines.length; i++ ) {
        line = lines[i].trim();
        // Don't throw out commented out lines: user might want to fix them
        if ( line.charAt(0) === '#' ) {
            key = '#';
            directive = line;
        }
        // Plain hostname
        else if ( line.indexOf('/') === -1 ) {
            if ( reInvalidHostname.test(line) ) {
                key = '#';
                directive = '# ' + line;
            } else {
                key = directive = line;
            }
        }
        // URL, possibly wildcarded: there MUST be at least one hostname
        // label (or else it would be just impossible to make an efficient
        // dict.
        else {
            matches = reHostnameExtractor.exec(line);
            if ( !matches || matches.length !== 2 ) {
                key = '#';
                directive = '# ' + line;
            } else {
                key = matches[1];
                directive = line;
            }
        }

        // Be sure this stays fixed:
        // https://github.com/gorhill/uBlock/issues/185

        if ( whitelist.hasOwnProperty(key) === false ) {
            whitelist[key] = [];
        }
        whitelist[key].push(directive);
    }
    return whitelist;
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