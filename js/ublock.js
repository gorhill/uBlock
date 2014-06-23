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

/* global chrome, µBlock */

/******************************************************************************/

µBlock.getNetFilteringSwitch = function(hostname) {
    var netExceptionList = this.userSettings.netExceptionList;
    if ( netExceptionList[hostname] !== undefined ) {
        return false;
    }
    var hostnames = this.URI.parentHostnamesFromHostname(hostname);
    while ( hostname = hostnames.shift() ) {
        if ( netExceptionList[hostname] !== undefined ) {
            return false;
        }
    }
    return true;
};

/******************************************************************************/

µBlock.toggleNetFilteringSwitch = function(hostname, newState) {
    var currentState = this.getNetFilteringSwitch(hostname);
    if ( newState === undefined ) {
        newState = !currentState;
    }
    if ( newState === currentState ) {
        return currentState;
    }
    var netExceptionList = this.userSettings.netExceptionList;

    // Add to exception list
    if ( !newState ) {
        netExceptionList[hostname] = true;
        this.saveExceptionList();
        return true;
    }

    // Remove from exception list
    if ( newState ) {
        var hostnames = this.URI.allHostnamesFromHostname(hostname);
        while ( hostname = hostnames.shift() ) {
            if ( netExceptionList[hostname] !== undefined ) {
                delete netExceptionList[hostname];
            }
        }
        this.saveExceptionList();
        return false;
    }
};

/******************************************************************************/

// For now we will use the net exception list

µBlock.getCosmeticFilteringSwitch = function(hostname) {
    var netExceptionList = this.userSettings.netExceptionList;
    if ( netExceptionList[hostname] !== undefined ) {
        return false;
    }
    var hostnames = this.URI.parentHostnamesFromHostname(hostname);
    while ( hostname = hostnames.shift() ) {
        if ( netExceptionList[hostname] !== undefined ) {
            return false;
        }
    }
    return true;
};

/******************************************************************************/

µBlock.saveExceptionList = function() {
    chrome.storage.local.set({
        'netExceptionList':  this.userSettings.netExceptionList
    });
};

/******************************************************************************/

µBlock.changeUserSettings = function(name, value) {
    if ( typeof name !== 'string' || name === '' ) {
        return;
    }

    var µb = µBlock;

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

