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

// https://github.com/gorhill/uBlock/issues/405
// Be more flexible with whitelist syntax

// Any special regexp char will be escaped
var whitelistDirectiveEscape = /[-\/\\^$+?.()|[\]{}]/g;

// All `*` will be expanded into `.*`
var whitelistDirectiveEscapeAsterisk = /\*/g;

// Probably manually entered whitelist directive
var isHandcraftedWhitelistDirective = function(directive) {
    return directive.indexOf('/') !== -1 &&
           directive.indexOf('*') !== -1;
};

var matchWhitelistDirective = function(url, hostname, directive) {
    // Directive is a plain hostname
    if ( directive.indexOf('/') === -1 ) {
        return hostname.slice(-directive.length) === directive;
    }
    // Match URL exactly
    if ( directive.indexOf('*') === -1 ) {
        return url === directive;
    }
    // Regex escape code inspired from:
    //   "Is there a RegExp.escape function in Javascript?"
    //   http://stackoverflow.com/a/3561711
    var reStr = directive.replace(whitelistDirectiveEscape, '\\$&')
                         .replace(whitelistDirectiveEscapeAsterisk, '.*');
    var re = new RegExp(reStr);
    return re.test(url);
};

/******************************************************************************/

µBlock.getNetFilteringSwitch = function(url) {
    var netWhitelist = this.netWhitelist;
    var buckets, i;
    var pos = url.indexOf('#');
    var targetURL = pos !== -1 ? url.slice(0, pos) : url;
    var targetHostname = this.URI.hostnameFromURI(targetURL);
    var key = targetHostname;
    for (;;) {
        if ( netWhitelist.hasOwnProperty(key) ) {
            buckets = netWhitelist[key];
            i = buckets.length;
            while ( i-- ) {
                if ( matchWhitelistDirective(targetURL, targetHostname, buckets[i]) ) {
                    // console.log('"%s" matche url "%s"', buckets[i], targetURL);
                    return false;
                }
            }
        }
        pos = key.indexOf('.');
        if ( pos === -1 ) {
            break;
        }
        key = key.slice(pos + 1);
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

    var netWhitelist = this.netWhitelist;
    var pos = url.indexOf('#');
    var targetURL = pos !== -1 ? url.slice(0, pos) : url;
    var targetHostname = this.URI.hostnameFromURI(targetURL);
    var key = targetHostname;
    var directive = scope === 'page' ? targetURL : targetHostname;

    // Add to directive list
    if ( newState === false ) {
        if ( netWhitelist.hasOwnProperty(key) === false ) {
            netWhitelist[key] = [];
        }
        netWhitelist[key].push(directive);
        this.saveWhitelist();
        return true;
    }

    // Remove from directive list whatever causes current URL to be whitelisted
    var buckets, i;
    for (;;) {
        if ( netWhitelist.hasOwnProperty(key) ) {
            buckets = netWhitelist[key];
            i = buckets.length;
            while ( i-- ) {
                directive = buckets[i];
                if ( !matchWhitelistDirective(targetURL, targetHostname, directive) ) {
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
                delete netWhitelist[key];
            }
        }
        pos = key.indexOf('.');
        if ( pos === -1 ) {
            break;
        }
        key = key.slice(pos + 1);
    }
    this.saveWhitelist();
    return true;
};

/******************************************************************************/

// For now we will use the net whitelist

µBlock.getCosmeticFilteringSwitch = function(url) {
    return this.getNetFilteringSwitch(url);
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
    if ( details.action !== 0 ) {
        changed = this.dynamicNetFilteringEngine.setCellZ(details.srcHostname, details.desHostname, details.requestType, details.action);
    } else {
        changed = this.dynamicNetFilteringEngine.unsetCell(details.srcHostname, details.desHostname, details.requestType);
    }
    if ( !changed ) {
        return;
    }

    this.userSettings.dynamicFilteringString = this.dynamicNetFilteringEngine.toString();
    this.XAL.keyvalSetOne('dynamicFilteringString', this.userSettings.dynamicFilteringString);

    // https://github.com/gorhill/uBlock/issues/420
    if ( details.requestType === '3p-frame' && !details.block ) {
        this.cosmeticFilteringEngine.removeFromSelectorCache(details.hostname, 'net');
    }
};

/******************************************************************************/

µBlock.isFirstParty = function(firstPartyDomain, hostname) {
    if ( hostname.slice(0 - firstPartyDomain.length) !== firstPartyDomain ) {
        return false;
    }
    // Be sure to not confuse 'example.com' with 'anotherexample.com'
    var c = hostname.charAt(hostname.length - firstPartyDomain.length - 1);
    return c === '.' || c === '';
};

/******************************************************************************/

// The core logic to evaluate requests through dynamic/static filtering
// is here.

µBlock.filterRequest = function(context) {
    // Given that:
    // - Dynamic filtering override static filtering
    // - Evaluating dynamic filtering is much faster than static filtering
    // We evaluate dynamic filtering first, and hopefully we can skip
    // evaluation of static filtering.
    // Dynamic filtering evaluation is ordered from most-specific to least-
    // specific.
    var df = this.dynamicNetFilteringEngine.clearRegisters();

    var rootHostname = context.rootHostname;
    var requestHostname = context.requestHostname;
    var requestType = context.requestType;

    // Dynamic filters:
    // 1. specific source, specific destination, any type, allow/block
    // 2. any source, specific destination, any type, allow/block
    df.evaluateCellZY(rootHostname, requestHostname, '*');
    if ( df.mustBlockOrAllow() ) {
        return df.toFilterString();
    }

    // Dynamic filters:
    // 3. specific source, any destination, specific type, allow/block
    // 4. any source, any destination, specific type, allow/block
    if ( df.mustAbort() === false ) {
        if ( requestType === 'script' ) {
            df.evaluateCellZY(rootHostname, requestHostname, this.isFirstParty(rootHostname, requestHostname) ? '1p-script' : '3p-script');
            if ( df.mustBlockOrAllow() ) {
                return df.toFilterString();
            }
        } else if ( requestType === 'sub_frame' ) {
            if ( this.isFirstParty(rootHostname, requestHostname) === false ) {
                df.evaluateCellZY(rootHostname, requestHostname, '3p-frame');
                if ( df.mustBlockOrAllow() ) {
                    return df.toFilterString();
                }
            }
        } else {
            df.evaluateCellZY(rootHostname, requestHostname, requestType);
            if ( df.mustBlockOrAllow() ) {
                return df.toFilterString();
            }
        }
    }

    // 5. Static filtering never override dynamic filtering
    return this.staticNetFilteringEngine.matchString(context);
};

/******************************************************************************/

})();