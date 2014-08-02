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

/* global µBlock */

/******************************************************************************/

µBlock.getNetFilteringSwitch = function(url, domain) {
    var keyHostname = this.URI.hostnameFromURI(url);
    var pos = url.indexOf('#');
    var keyURL = pos !== -1 ? url.slice(0, pos) : url;

    // The caller may provide an already known domain -- convenient to reduce
    // overhead of extracting a domain from the url
    if ( domain === undefined ) {
        domain = this.URI.domainFromHostname(keyHostname);
    }
    if ( !domain ) {
        return false;
    }

    var exceptions = this.netWhitelist[domain];
    if ( !exceptions ) {
        return true;
    }

    var i = exceptions.length;
    var exception;
    while ( i-- ) {
        exception = exceptions[i];
        if ( exception.indexOf('/') !== -1 ) {
            if ( exception.slice(-1) === '*' ) {
                exception = exception.slice(0, -1);
                if ( keyURL.slice(0, exception.length) === exception ) {
                    return false;
                }
            } else if ( keyURL === exception ) {
                return false;
            }
        } else if ( keyHostname.slice(-exception.length) === exception ) {
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
    if ( !domain ) {
        return false;
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

    // Remove from exception list
    var i = exceptions.length;
    var exception;
    while ( i-- ) {
        exception = exceptions[i];
        if ( exception.indexOf('/') !== -1 ) {
            if ( exception.slice(-1) === '*' ) {
                exception = exception.slice(0, -1);
                if ( keyURL.slice(0, exception.length) === exception ) {
                    exceptions.splice(i, 1);
                }
            } else if ( keyURL === exception ) {
                exceptions.splice(i, 1);
            }
        } else if ( keyHostname.slice(-exception.length) === exception ) {
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
    var line, domain, bucket;
    for ( var i = 0; i < lines.length; i++ ) {
        line = lines[i].trim();
        domain = line.indexOf('/') !== -1 ?
            this.URI.domainFromURI(line) :
            this.URI.domainFromHostname(line);
        if ( !domain ) {
            continue;
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
    var µb = µBlock;

    if ( name === undefined ) {
        return µb.userSettings;
    }

    if ( typeof name !== 'string' || name === '' ) {
        return;
    }

    // Do not allow an unknown user setting to be created
    if ( µb.userSettings[name] === undefined ) {
        return;
    }

    if ( value === undefined ) {
        return µb.userSettings[name];
    }

    // Pre-change
    switch ( name ) {
        default:        
            break;
    }

    // Change
    µb.userSettings[name] = value;

    // Post-change
    switch ( name ) {
        default:
            break;
    }

    µb.saveUserSettings();
};

/******************************************************************************/

µBlock.transposeType = function(type, path) {
    if ( type === 'other' ) {
        var pos = path.lastIndexOf('.');
        if ( pos > 0 ) {
            var ext = path.slice(pos);
            if ( '.eot.ttf.otf.svg.woff'.indexOf(ext) >= 0 ) {
                return 'stylesheet';
            }
            if ( '.ico.png'.indexOf(ext) >= 0 ) {
                return 'image';
            }
        }
    }
    return type;
};

/******************************************************************************/

µBlock.formatCount = function(count) {
    if ( typeof count !== 'number' ) {
        return '';
    }
    var s = count.toFixed(0);
    if ( count >= 1000 ) {
        if ( count < 10000 ) {
            s = '>' + s.slice(0,1) + 'K';
        } else if ( count < 100000 ) {
            s = s.slice(0,2) + 'K';
        } else if ( count < 1000000 ) {
            s = s.slice(0,3) + 'K';
        } else if ( count < 10000000 ) {
            s = s.slice(0,1) + 'M';
        } else {
            s = s.slice(0,-6) + 'M';
        }
    }
    return s;
};
