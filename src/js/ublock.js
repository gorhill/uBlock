/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 Raymond Hill

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

/******************************************************************************/

(function(){

'use strict';

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/405
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
        return hostname.endsWith(directive) &&
              (hostname.length === directive.length ||
               hostname.charAt(hostname.length - directive.length - 1) === '.');
    }
    // Match URL exactly
    if ( directive.indexOf('*') === -1 ) {
        return url === directive;
    }
    // TODO: Revisit implementation to avoid creating a regex each time.
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
    var buckets, i, pos;
    var targetHostname = this.URI.hostnameFromURI(url);
    var key = targetHostname;
    for (;;) {
        if ( netWhitelist.hasOwnProperty(key) ) {
            buckets = netWhitelist[key];
            i = buckets.length;
            while ( i-- ) {
                if ( matchWhitelistDirective(url, targetHostname, buckets[i]) ) {
                    // console.log('"%s" matche url "%s"', buckets[i], url);
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
    var reHostnameExtractor = /([a-z0-9\[][a-z0-9.\-]*[a-z0-9\]])(?::[\d*]+)?\/(?:[^\x00-\x20\/]|$)[^\x00-\x20]*$/;
    var lines = s.split(/[\n\r]+/);
    var line, matches, key, directive;
    for ( var i = 0; i < lines.length; i++ ) {
        line = lines[i].trim();
        // https://github.com/gorhill/uBlock/issues/171
        // Skip empty lines
        if ( line === '' ) {
            continue;
        }

        // Don't throw out commented out lines: user might want to fix them
        if ( line.startsWith('#') ) {
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

        // https://github.com/gorhill/uBlock/issues/171
        // Skip empty keys
        if ( key === '' ) {
            continue;
        }

        // Be sure this stays fixed:
        // https://github.com/chrisaljoudi/uBlock/issues/185
        if ( whitelist.hasOwnProperty(key) === false ) {
            whitelist[key] = [];
        }
        whitelist[key].push(directive);
    }
    return whitelist;
};

/******************************************************************************/

µBlock.changeUserSettings = function(name, value) {
    var us = this.userSettings;

    // Return all settings if none specified.
    if ( name === undefined ) {
        us = JSON.parse(JSON.stringify(us));
        us.noCosmeticFiltering = this.hnSwitches.evaluate('no-cosmetic-filtering', '*') === 1;
        us.noLargeMedia = this.hnSwitches.evaluate('no-large-media', '*') === 1;
        us.noRemoteFonts = this.hnSwitches.evaluate('no-remote-fonts', '*') === 1;
        return us;
    }

    if ( typeof name !== 'string' || name === '' ) {
        return;
    }

    if ( value === undefined ) {
        return us[name];
    }

    // Pre-change
    switch ( name ) {
    case 'largeMediaSize':
        if ( typeof value !== 'number' ) {
            value = parseInt(value, 10) || 0;
        }
        value = Math.ceil(Math.max(value, 0));
        break;
    default:
        break;
    }

    // Change -- but only if the user setting actually exists.
    var mustSave = us.hasOwnProperty(name) &&
                   value !== us[name];
    if ( mustSave ) {
        us[name] = value;
    }

    // Post-change
    switch ( name ) {
    case 'collapseBlocked':
        if ( value === false ) {
            this.cosmeticFilteringEngine.removeFromSelectorCache('*', 'net');
        }
        break;
    case 'contextMenuEnabled':
        this.contextMenu.update(null);
        break;
    case 'hyperlinkAuditingDisabled':
        if ( this.privacySettingsSupported ) {
            vAPI.browserSettings.set({ 'hyperlinkAuditing': !value });
        }
        break;
    case 'noCosmeticFiltering':
        if ( this.hnSwitches.toggle('no-cosmetic-filtering', '*', value ? 1 : 0) ) {
            this.saveHostnameSwitches();
        }
        break;
    case 'noLargeMedia':
        if ( this.hnSwitches.toggle('no-large-media', '*', value ? 1 : 0) ) {
            this.saveHostnameSwitches();
        }
        break;
    case 'noRemoteFonts':
        if ( this.hnSwitches.toggle('no-remote-fonts', '*', value ? 1 : 0) ) {
            this.saveHostnameSwitches();
        }
        break;
    case 'prefetchingDisabled':
        if ( this.privacySettingsSupported ) {
            vAPI.browserSettings.set({ 'prefetching': !value });
        }
        break;
    case 'webrtcIPAddressHidden':
        if ( this.privacySettingsSupported ) {
            vAPI.browserSettings.set({ 'webrtcIPAddress': !value });
        }
        break;
    default:
        break;
    }

    if ( mustSave ) {
        this.saveUserSettings();
    }
};

/******************************************************************************/

µBlock.elementPickerExec = function(tabId, targetElement) {
    if ( vAPI.isBehindTheSceneTabId(tabId) ) {
        return;
    }
    this.epickerTarget = targetElement || '';
    this.scriptlets.inject(tabId, 'element-picker');
    if ( typeof vAPI.tabs.select === 'function' ) {
        vAPI.tabs.select(tabId);
    }
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/2033
// Always set own rules, trying to be fancy to avoid setting seemingly
// (but not really) redundant rules led to this issue.

µBlock.toggleFirewallRule = function(details) {
    var requestType = details.requestType;

    if ( details.action !== 0 ) {
        this.sessionFirewall.setCell(details.srcHostname, details.desHostname, requestType, details.action);
    } else {
        this.sessionFirewall.unsetCell(details.srcHostname, details.desHostname, requestType);
    }

    // https://github.com/chrisaljoudi/uBlock/issues/731#issuecomment-73937469
    if ( details.persist ) {
        if ( details.action !== 0 ) {
            this.permanentFirewall.setCell(details.srcHostname, details.desHostname, requestType, details.action);
        } else {
            this.permanentFirewall.unsetCell(details.srcHostname, details.desHostname, requestType, details.action);
        }
        this.savePermanentFirewallRules();
    }

    // https://github.com/gorhill/uBlock/issues/1662
    // Flush all cached `net` cosmetic filters if we are dealing with a
    // collapsible type: any of the cached entries could be a resource on the
    // target page.
    var srcHostname = details.srcHostname;
    if (
        (srcHostname !== '*') &&
        (requestType === '*' || requestType === 'image' || requestType === '3p' || requestType === '3p-frame')
    ) {
        srcHostname = '*';
    }

    // https://github.com/chrisaljoudi/uBlock/issues/420
    this.cosmeticFilteringEngine.removeFromSelectorCache(srcHostname, 'net');
};

/******************************************************************************/

µBlock.toggleURLFilteringRule = function(details) {
    var changed = this.sessionURLFiltering.setRule(
        details.context,
        details.url,
        details.type,
        details.action
    );

    if ( !changed ) {
        return;
    }

    this.cosmeticFilteringEngine.removeFromSelectorCache(details.context, 'net');

    if ( !details.persist ) {
        return;
    }

    changed = this.permanentURLFiltering.setRule(
        details.context,
        details.url,
        details.type,
        details.action
    );

    if ( changed ) {
        this.savePermanentFirewallRules();
    }
};

/******************************************************************************/

µBlock.isBlockResult = function(result) {
    return typeof result === 'string' && result.charAt(1) === 'b';
};

/******************************************************************************/

µBlock.isAllowResult = function(result) {
    return typeof result !== 'string' || result.charAt(1) !== 'b';
};

/******************************************************************************/

µBlock.toggleHostnameSwitch = function(details) {
    if ( this.hnSwitches.toggleZ(details.name, details.hostname, !!details.deep, details.state) ) {
        this.saveHostnameSwitches();
    }

    // Take action if needed
    switch ( details.name ) {
    case 'no-cosmetic-filtering':
        this.scriptlets.injectDeep(
            details.tabId,
            details.state ? 'cosmetic-off' : 'cosmetic-on'
        );
        break;
    case 'no-large-media':
        if ( details.state === false ) {
            var pageStore = this.pageStoreFromTabId(details.tabId);
            if ( pageStore !== null ) {
                pageStore.temporarilyAllowLargeMediaElements();
            }
        }
        break;
    }
};

/******************************************************************************/

µBlock.logCosmeticFilters = (function() {
    var tabIdToTimerMap = {};

    var injectNow = function(tabId) {
        delete tabIdToTimerMap[tabId];
        µBlock.scriptlets.injectDeep(tabId, 'cosmetic-logger');
    };

    var injectAsync = function(tabId) {
        if ( tabIdToTimerMap.hasOwnProperty(tabId) ) {
            return;
        }
        tabIdToTimerMap[tabId] = vAPI.setTimeout(
            injectNow.bind(null, tabId),
            100
        );
    };

    return injectAsync;
})();

/******************************************************************************/

µBlock.scriptlets = (function() {
    var pendingEntries = Object.create(null);

    var Entry = function(tabId, scriptlet, callback) {
        this.tabId = tabId;
        this.scriptlet = scriptlet;
        this.callback = callback;
        this.timer = vAPI.setTimeout(this.service.bind(this), 1000);
    };

    Entry.prototype.service = function(response) {
        if ( this.timer !== null ) {
            clearTimeout(this.timer);
        }
        delete pendingEntries[makeKey(this.tabId, this.scriptlet)];
        this.callback(response);
    };

    var makeKey = function(tabId, scriptlet) {
        return tabId + ' ' + scriptlet;
    };

    var report = function(tabId, scriptlet, response) {
        var key = makeKey(tabId, scriptlet);
        var entry = pendingEntries[key];
        if ( entry === undefined ) {
            return;
        }
        entry.service(response);
    };

    var inject = function(tabId, scriptlet, callback) {
        if ( typeof callback === 'function' ) {
            if ( vAPI.isBehindTheSceneTabId(tabId) ) {
                callback();
                return;
            }
            var key = makeKey(tabId, scriptlet);
            if ( pendingEntries[key] !== undefined ) {
                callback();
                return;
            }
            pendingEntries[key] = new Entry(tabId, scriptlet, callback);
        }
        vAPI.tabs.injectScript(tabId, { file: 'js/scriptlets/' + scriptlet + '.js' });
    };

    // TODO: think about a callback mechanism.
    var injectDeep = function(tabId, scriptlet) {
        vAPI.tabs.injectScript(tabId, {
            file: 'js/scriptlets/' + scriptlet + '.js',
            allFrames: true
        });
    };

    return {
        inject: inject,
        injectDeep: injectDeep,
        report: report
    };
})();

/******************************************************************************/

})();
