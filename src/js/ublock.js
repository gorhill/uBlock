/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-present Raymond Hill

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

'use strict';

/******************************************************************************/
/******************************************************************************/

(function(){

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/405
// Be more flexible with whitelist syntax

// Any special regexp char will be escaped
var whitelistDirectiveEscape = /[-\/\\^$+?.()|[\]{}]/g;

// All `*` will be expanded into `.*`
var whitelistDirectiveEscapeAsterisk = /\*/g;

// Remember encountered regexps for reuse.
var directiveToRegexpMap = new Map();

// Probably manually entered whitelist directive
var isHandcraftedWhitelistDirective = function(directive) {
    return directive.startsWith('/') && directive.endsWith('/') ||
           directive.indexOf('/') !== -1 && directive.indexOf('*') !== -1;
};

var matchDirective = function(url, hostname, directive) {
    // Directive is a plain hostname.
    if ( directive.indexOf('/') === -1 ) {
        return hostname.endsWith(directive) &&
              (hostname.length === directive.length ||
               hostname.charAt(hostname.length - directive.length - 1) === '.');
    }
    // Match URL exactly.
    if ( directive.startsWith('/') === false && directive.indexOf('*') === -1 ) {
        return url === directive;
    }
    // Transpose into a regular expression.
    var re = directiveToRegexpMap.get(directive);
    if ( re === undefined ) {
        var reStr;
        if ( directive.startsWith('/') && directive.endsWith('/') ) {
            reStr = directive.slice(1, -1);
        } else {
            reStr = directive.replace(whitelistDirectiveEscape, '\\$&')
                             .replace(whitelistDirectiveEscapeAsterisk, '.*');
        }
        re = new RegExp(reStr);
        directiveToRegexpMap.set(directive, re);
    }
    return re.test(url);
};

var matchBucket = function(url, hostname, bucket, start) {
    if ( bucket ) {
        for ( var i = start || 0, n = bucket.length; i < n; i++ ) {
            if ( matchDirective(url, hostname, bucket[i]) ) {
                return i;
            }
        }
    }
    return -1;
};

// https://www.youtube.com/watch?v=RL2W_XK-UJ4&list=PLhPp-QAUKF_hRMjWsYvvdazGw0qIjtSXJ

/******************************************************************************/

µBlock.getNetFilteringSwitch = function(url) {
    var targetHostname = this.URI.hostnameFromURI(url),
        key = targetHostname,
        pos;
    for (;;) {
        if ( matchBucket(url, targetHostname, this.netWhitelist[key]) !== -1 ) {
            return false;
        }
        pos = key.indexOf('.');
        if ( pos === -1 ) { break; }
        key = key.slice(pos + 1);
    }
    if ( matchBucket(url, targetHostname, this.netWhitelist['//']) !== -1 ) {
        return false;
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

    var netWhitelist = this.netWhitelist,
        pos = url.indexOf('#'),
        targetURL = pos !== -1 ? url.slice(0, pos) : url,
        targetHostname = this.URI.hostnameFromURI(targetURL),
        key = targetHostname,
        directive = scope === 'page' ? targetURL : targetHostname;

    // Add to directive list
    if ( newState === false ) {
        if ( netWhitelist[key] === undefined ) {
            netWhitelist[key] = [];
        }
        netWhitelist[key].push(directive);
        this.saveWhitelist();
        return true;
    }

    // Remove from directive list whatever causes current URL to be whitelisted
    var bucket, i;
    for (;;) {
        bucket = netWhitelist[key];
        if ( bucket !== undefined ) {
            i = undefined;
            for (;;) {
                i = matchBucket(targetURL, targetHostname, bucket, i);
                if ( i === -1 ) { break; }
                directive = bucket.splice(i, 1)[0];
                if ( isHandcraftedWhitelistDirective(directive) ) {
                    netWhitelist['#'].push('# ' + directive);
                }
            }
            if ( bucket.length === 0 ) {
                delete netWhitelist[key];
            }
        }
        pos = key.indexOf('.');
        if ( pos === -1 ) { break; }
        key = key.slice(pos + 1);
    }
    bucket = netWhitelist['//'];
    if ( bucket !== undefined ) {
        i = undefined;
        for (;;) {
            i = matchBucket(targetURL, targetHostname, bucket, i);
            if ( i === -1 ) { break; }
            directive = bucket.splice(i, 1)[0];
            if ( isHandcraftedWhitelistDirective(directive) ) {
                netWhitelist['#'].push('# ' + directive);
            }
        }
        if ( bucket.length === 0 ) {
            delete netWhitelist['//'];
        }
    }
    this.saveWhitelist();
    return true;
};

/******************************************************************************/

µBlock.stringFromWhitelist = function(whitelist) {
    var r = {};
    var i, bucket;
    for ( var key in whitelist ) {
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
    var whitelist = Object.create(null),
        lineIter = new this.LineIterator(s),
        line, matches, key, directive, re;

    // Comment bucket must always be ready to be used.
    whitelist['#'] = [];

    // New set of directives, scrap cached data.
    directiveToRegexpMap.clear();

    while ( !lineIter.eot() ) {
        line = lineIter.next().trim();

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
            if ( this.reWhitelistBadHostname.test(line) ) {
                key = '#';
                directive = '# ' + line;
            } else {
                key = directive = line;
            }
        }
        // Regex-based (ensure it is valid)
        else if ( line.length > 2 && line.startsWith('/') && line.endsWith('/') ) {
            key = '//';
            directive = line;
            try {
                re = new RegExp(directive.slice(1, -1));
                directiveToRegexpMap.set(directive, re);
            } catch(ex) {
                key = '#';
                directive = '# ' + line;
            }
        }
        // URL, possibly wildcarded: there MUST be at least one hostname
        // label (or else it would be just impossible to make an efficient
        // dict.
        else {
            matches = this.reWhitelistHostnameExtractor.exec(line);
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
        if ( key === '' ) { continue; }

        // Be sure this stays fixed:
        // https://github.com/chrisaljoudi/uBlock/issues/185
        if ( whitelist[key] === undefined ) {
            whitelist[key] = [];
        }
        whitelist[key].push(directive);
    }
    return whitelist;
};

// https://github.com/gorhill/uBlock/issues/3717
µBlock.reWhitelistBadHostname = /[^a-z0-9.\-_\[\]:]/;
µBlock.reWhitelistHostnameExtractor = /([a-z0-9.\-_\[\]]+)(?::[\d*]+)?\/(?:[^\x00-\x20\/]|$)[^\x00-\x20]*$/;

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

µBlock.changeUserSettings = function(name, value) {
    let us = this.userSettings;

    // Return all settings if none specified.
    if ( name === undefined ) {
        us = JSON.parse(JSON.stringify(us));
        us.noCosmeticFiltering = this.sessionSwitches.evaluate('no-cosmetic-filtering', '*') === 1;
        us.noLargeMedia = this.sessionSwitches.evaluate('no-large-media', '*') === 1;
        us.noRemoteFonts = this.sessionSwitches.evaluate('no-remote-fonts', '*') === 1;
        us.noScripting = this.sessionSwitches.evaluate('no-scripting', '*') === 1;
        us.noCSPReports = this.sessionSwitches.evaluate('no-csp-reports', '*') === 1;
        return us;
    }

    if ( typeof name !== 'string' || name === '' ) { return; }

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
    let mustSave = us.hasOwnProperty(name) && value !== us[name];
    if ( mustSave ) {
        us[name] = value;
    }

    // Post-change
    switch ( name ) {
    case 'advancedUserEnabled':
        if ( value === true ) {
            us.dynamicFilteringEnabled = true;
        }
        break;
    case 'autoUpdate':
        this.scheduleAssetUpdater(value ? 7 * 60 * 1000 : 0);
        break;
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
    case 'noLargeMedia':
    case 'noRemoteFonts':
    case 'noScripting':
    case 'noCSPReports':
        let switchName;
        switch ( name ) {
        case 'noCosmeticFiltering':
            switchName = 'no-cosmetic-filtering'; break;
        case 'noLargeMedia':
            switchName = 'no-large-media'; break;
        case 'noRemoteFonts':
            switchName = 'no-remote-fonts'; break;
        case 'noScripting':
            switchName = 'no-scripting'; break;
        case 'noCSPReports':
            switchName = 'no-csp-reports'; break;
        default:
            break;
        }
        if ( switchName === undefined ) { break; }
        let switchState = value ? 1 : 0;
        this.sessionSwitches.toggle(switchName, '*', switchState);
        if ( this.permanentSwitches.toggle(switchName, '*', switchState) ) {
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

// https://www.reddit.com/r/uBlockOrigin/comments/8524cf/my_custom_scriptlets_doesnt_work_what_am_i_doing/

µBlock.changeHiddenSettings = function(hs) {
    var mustReloadResources =
        hs.userResourcesLocation !== this.hiddenSettings.userResourcesLocation;
    this.hiddenSettings = hs;
    this.saveHiddenSettings();
    if ( mustReloadResources ) {
        this.redirectEngine.invalidateResourcesSelfie();
        this.loadRedirectResources();
    }
};

/******************************************************************************/

µBlock.elementPickerExec = function(tabId, targetElement, zap) {
    if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }

    this.epickerTarget = targetElement || '';
    this.epickerZap = zap || false;

    // https://github.com/uBlockOrigin/uBlock-issues/issues/168
    //   Force activate the target tab once the element picker has been
    //   injected.
    vAPI.tabs.injectScript(
        tabId,
        {
            file: '/js/scriptlets/element-picker.js',
            runAt: 'document_end'
        },
        ( ) => {
            vAPI.tabs.select(tabId);
        }
    );
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/2033
// Always set own rules, trying to be fancy to avoid setting seemingly
// (but not really) redundant rules led to this issue.

µBlock.toggleFirewallRule = function(details) {
    let requestType = details.requestType;

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
    let srcHostname = details.srcHostname;
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
    let changed = this.sessionURLFiltering.setRule(
        details.context,
        details.url,
        details.type,
        details.action
    );
    if ( changed === false ) { return; }

    this.cosmeticFilteringEngine.removeFromSelectorCache(details.context, 'net');

    if ( details.persist !== true ) { return; }

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

µBlock.toggleHostnameSwitch = function(details) {
    let changed = this.sessionSwitches.toggleZ(
        details.name,
        details.hostname,
        !!details.deep,
        details.state
    );
    if ( changed === false ) { return; }

    // Take action if needed
    switch ( details.name ) {
    case 'no-cosmetic-filtering':
        this.scriptlets.injectDeep(
            details.tabId,
            details.state ? 'cosmetic-off' : 'cosmetic-on'
        );
        break;
    case 'no-large-media':
        var pageStore = this.pageStoreFromTabId(details.tabId);
        if ( pageStore !== null ) {
            pageStore.temporarilyAllowLargeMediaElements(!details.state);
        }
        break;
    }

    if ( details.persist !== true ) { return; }

    changed = this.permanentSwitches.toggleZ(
        details.name,
        details.hostname,
        !!details.deep,
        details.state
    );
    if ( changed ) {
        this.saveHostnameSwitches();
    }
};

/******************************************************************************/

// https://github.com/NanoMeow/QuickReports/issues/6#issuecomment-414516623
//   Inject as early as possible to make the cosmetic logger code less
//   sensitive to the removal of DOM nodes which may match injected
//   cosmetic filters.

µBlock.logCosmeticFilters = function(tabId, frameId) {
    if ( this.logger.isEnabled() ) {
        vAPI.tabs.injectScript(tabId, {
            file: '/js/scriptlets/cosmetic-logger.js',
            frameId: frameId,
            runAt: 'document_start'
        });
    }
};

/******************************************************************************/

µBlock.scriptlets = (function() {
    var pendingEntries = new Map();

    var Entry = function(tabId, scriptlet, callback) {
        this.tabId = tabId;
        this.scriptlet = scriptlet;
        this.callback = callback;
        this.timer = vAPI.setTimeout(this.service.bind(this), 1000);
    };

    Entry.prototype.service = function(response) {
        if ( this.timer !== null ) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        pendingEntries.delete(makeKey(this.tabId, this.scriptlet));
        this.callback(response);
    };

    var makeKey = function(tabId, scriptlet) {
        return tabId + ' ' + scriptlet;
    };

    var report = function(tabId, scriptlet, response) {
        var key = makeKey(tabId, scriptlet);
        var entry = pendingEntries.get(key);
        if ( entry === undefined ) { return; }
        entry.service(response);
    };

    var inject = function(tabId, scriptlet, callback) {
        if ( typeof callback === 'function' ) {
            if ( vAPI.isBehindTheSceneTabId(tabId) ) {
                callback();
                return;
            }
            var key = makeKey(tabId, scriptlet),
                entry = pendingEntries.get(key);
            if ( entry !== undefined ) {
                if ( callback !== entry.callback ) {
                    callback();
                }
                return;
            }
            pendingEntries.set(key, new Entry(tabId, scriptlet, callback));
        }
        vAPI.tabs.injectScript(tabId, {
            file: '/js/scriptlets/' + scriptlet + '.js'
        });
    };

    // TODO: think about a callback mechanism.
    var injectDeep = function(tabId, scriptlet) {
        vAPI.tabs.injectScript(tabId, {
            file: '/js/scriptlets/' + scriptlet + '.js',
            allFrames: true
        });
    };

    return {
        inject: inject,
        injectDeep: injectDeep,
        report: report
    };
})();
