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

{

// *****************************************************************************
// start of local namespace

// https://github.com/chrisaljoudi/uBlock/issues/405
// Be more flexible with whitelist syntax

// Any special regexp char will be escaped
const whitelistDirectiveEscape = /[-\/\\^$+?.()|[\]{}]/g;

// All `*` will be expanded into `.*`
const whitelistDirectiveEscapeAsterisk = /\*/g;

// Remember encountered regexps for reuse.
const directiveToRegexpMap = new Map();

// Probably manually entered whitelist directive
const isHandcraftedWhitelistDirective = function(directive) {
    return directive.startsWith('/') && directive.endsWith('/') ||
           directive.indexOf('/') !== -1 && directive.indexOf('*') !== -1;
};

const matchDirective = function(url, hostname, directive) {
    // Directive is a plain hostname.
    if ( directive.indexOf('/') === -1 ) {
        return hostname.endsWith(directive) &&
              (hostname.length === directive.length ||
               hostname.charAt(hostname.length - directive.length - 1) === '.');
    }
    // Match URL exactly.
    if (
        directive.startsWith('/') === false &&
        directive.indexOf('*') === -1
    ) {
        return url === directive;
    }
    // Transpose into a regular expression.
    let re = directiveToRegexpMap.get(directive);
    if ( re === undefined ) {
        let reStr;
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

const matchBucket = function(url, hostname, bucket, start) {
    if ( bucket ) {
        for ( let i = start || 0, n = bucket.length; i < n; i++ ) {
            if ( matchDirective(url, hostname, bucket[i]) ) {
                return i;
            }
        }
    }
    return -1;
};

/******************************************************************************/

µBlock.getNetFilteringSwitch = function(url) {
    const hostname = this.URI.hostnameFromURI(url);
    let key = hostname;
    for (;;) {
        if ( matchBucket(url, hostname, this.netWhitelist.get(key)) !== -1 ) {
            return false;
        }
        const pos = key.indexOf('.');
        if ( pos === -1 ) { break; }
        key = key.slice(pos + 1);
    }
    if ( matchBucket(url, hostname, this.netWhitelist.get('//')) !== -1 ) {
        return false;
    }
    return true;
};

/******************************************************************************/

µBlock.toggleNetFilteringSwitch = function(url, scope, newState) {
    const currentState = this.getNetFilteringSwitch(url);
    if ( newState === undefined ) {
        newState = !currentState;
    }
    if ( newState === currentState ) {
        return currentState;
    }

    const netWhitelist = this.netWhitelist;
    const pos = url.indexOf('#');
    let targetURL = pos !== -1 ? url.slice(0, pos) : url;
    const targetHostname = this.URI.hostnameFromURI(targetURL);
    let key = targetHostname;
    let directive = scope === 'page' ? targetURL : targetHostname;

    // Add to directive list
    if ( newState === false ) {
        let bucket = netWhitelist.get(key);
        if ( bucket === undefined ) {
            bucket = [];
            netWhitelist.set(key, bucket);
        }
        bucket.push(directive);
        this.saveWhitelist();
        return true;
    }

    // Remove all directives which cause current URL to be whitelisted
    for (;;) {
        const bucket = netWhitelist.get(key);
        if ( bucket !== undefined ) {
            let i;
            for (;;) {
                i = matchBucket(targetURL, targetHostname, bucket, i);
                if ( i === -1 ) { break; }
                directive = bucket.splice(i, 1)[0];
                if ( isHandcraftedWhitelistDirective(directive) ) {
                    netWhitelist.get('#').push(`# ${directive}`);
                }
            }
            if ( bucket.length === 0 ) {
                netWhitelist.delete(key);
            }
        }
        const pos = key.indexOf('.');
        if ( pos === -1 ) { break; }
        key = key.slice(pos + 1);
    }
    const bucket = netWhitelist.get('//');
    if ( bucket !== undefined ) {
        let i;
        for (;;) {
            i = matchBucket(targetURL, targetHostname, bucket, i);
            if ( i === -1 ) { break; }
            directive = bucket.splice(i, 1)[0];
            if ( isHandcraftedWhitelistDirective(directive) ) {
                netWhitelist.get('#').push(`# ${directive}`);
            }
        }
        if ( bucket.length === 0 ) {
            netWhitelist.delete('//');
        }
    }
    this.saveWhitelist();
    return true;
};

/******************************************************************************/

µBlock.arrayFromWhitelist = function(whitelist) {
    const out = new Set();
    for ( const bucket of whitelist.values() ) {
        for ( const directive of bucket ) {
            out.add(directive);
        }
    }
    return Array.from(out).sort((a, b) => a.localeCompare(b));
};

µBlock.stringFromWhitelist = function(whitelist) {
    return this.arrayFromWhitelist(whitelist).join('\n');
};

/******************************************************************************/

µBlock.whitelistFromArray = function(lines) {
    const whitelist = new Map();

    // Comment bucket must always be ready to be used.
    whitelist.set('#', []);

    // New set of directives, scrap cached data.
    directiveToRegexpMap.clear();

    for ( let line of lines ) {
        line = line.trim();

        // https://github.com/gorhill/uBlock/issues/171
        // Skip empty lines
        if ( line === '' ) { continue; }

        let key, directive;

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
        else if (
            line.length > 2 &&
            line.startsWith('/') &&
            line.endsWith('/')
        ) {
            key = '//';
            directive = line;
            try {
                const re = new RegExp(directive.slice(1, -1));
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
            const matches = this.reWhitelistHostnameExtractor.exec(line);
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
        let bucket = whitelist.get(key);
        if ( bucket === undefined ) {
            bucket = [];
            whitelist.set(key, bucket);
        }
        bucket.push(directive);
    }
    return whitelist;
};

µBlock.whitelistFromString = function(s) {
    return this.whitelistFromArray(s.split('\n'));
};

// https://github.com/gorhill/uBlock/issues/3717
µBlock.reWhitelistBadHostname = /[^a-z0-9.\-_\[\]:]/;
µBlock.reWhitelistHostnameExtractor = /([a-z0-9.\-_\[\]]+)(?::[\d*]+)?\/(?:[^\x00-\x20\/]|$)[^\x00-\x20]*$/;

// end of local namespace
// *****************************************************************************

}

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
    const mustReloadResources =
        hs.userResourcesLocation !== this.hiddenSettings.userResourcesLocation;
    this.hiddenSettings = hs;
    this.saveHiddenSettings();
    if ( mustReloadResources ) {
        this.redirectEngine.invalidateResourcesSelfie();
        this.loadRedirectResources();
    }
    this.fireDOMEvent('hiddenSettingsChanged');
};

/******************************************************************************/

µBlock.elementPickerExec = async function(tabId, targetElement, zap = false) {
    if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }

    this.epickerArgs.target = targetElement || '';
    this.epickerArgs.zap = zap;

    // https://github.com/uBlockOrigin/uBlock-issues/issues/40
    //   The element picker needs this library
    vAPI.tabs.executeScript(tabId, {
        file: '/lib/diff/swatinem_diff.js',
        runAt: 'document_end',
    });

    await vAPI.tabs.executeScript(tabId, {
        file: '/js/scriptlets/element-picker.js',
        runAt: 'document_end',
    });

    // https://github.com/uBlockOrigin/uBlock-issues/issues/168
    //   Force activate the target tab once the element picker has been
    //   injected.
    vAPI.tabs.select(tabId);
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/2033
// Always set own rules, trying to be fancy to avoid setting seemingly
// (but not really) redundant rules led to this issue.

µBlock.toggleFirewallRule = function(details) {
    let { srcHostname, desHostname, requestType, action } = details;

    if ( action !== 0 ) {
        this.sessionFirewall.setCell(
            srcHostname,
            desHostname,
            requestType,
            action
        );
    } else {
        this.sessionFirewall.unsetCell(
            srcHostname,
            desHostname,
            requestType
        );
    }

    // https://github.com/chrisaljoudi/uBlock/issues/731#issuecomment-73937469
    if ( details.persist ) {
        if ( action !== 0 ) {
            this.permanentFirewall.setCell(
                srcHostname,
                desHostname,
                requestType,
                action
            );
        } else {
            this.permanentFirewall.unsetCell(
                srcHostname,
                desHostname,
                requestType,
                action
            );
        }
        this.savePermanentFirewallRules();
    }

    // https://github.com/gorhill/uBlock/issues/1662
    // Flush all cached `net` cosmetic filters if we are dealing with a
    // collapsible type: any of the cached entries could be a resource on the
    // target page.
    if (
        (srcHostname !== '*') &&
        (
            requestType === '*' ||
            requestType === 'image' ||
            requestType === '3p' ||
            requestType === '3p-frame'
        )
    ) {
        srcHostname = '*';
    }

    // https://github.com/chrisaljoudi/uBlock/issues/420
    this.cosmeticFilteringEngine.removeFromSelectorCache(srcHostname, 'net');

    if ( requestType.startsWith('3p') ) {
        this.updateToolbarIcon(details.tabId, 0b100);
    }
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
    case 'no-scripting':
        this.updateToolbarIcon(details.tabId, 0b100);
        break;
    case 'no-cosmetic-filtering':
        this.scriptlets.injectDeep(
            details.tabId,
            details.state ? 'cosmetic-off' : 'cosmetic-on'
        );
        break;
    case 'no-large-media':
        const pageStore = this.pageStoreFromTabId(details.tabId);
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

µBlock.blockingModeFromHostname = function(hn) {
    let bits = 0;
    if ( this.sessionSwitches.evaluateZ('no-scripting', hn) ) {
        bits |= 0b00000010;
    }
    if ( this.userSettings.advancedUserEnabled ) {
        const fw = this.sessionFirewall;
        if ( fw.evaluateCellZY(hn, '*', '3p') === 1 ) {
            bits |= 0b00000100;
        }
        if ( fw.evaluateCellZY(hn, '*', '3p-script') === 1 ) {
            bits |= 0b00001000;
        }
        if ( fw.evaluateCellZY(hn, '*', '3p-frame') === 1 ) {
            bits |= 0b00010000;
        }
    }
    return bits;
};

µBlock.parseBlockingProfiles = (( ) => {
    const parse = function() {
        const s = µBlock.hiddenSettings.blockingProfiles;
        const profiles = [];
        s.split(/\s+/).forEach(s => {
            let pos = s.indexOf('/');
            if ( pos === -1 ) {
                pos = s.length;
            }
            const bits = parseInt(s.slice(0, pos), 2);
            if ( isNaN(bits) ) { return; }
            const color = s.slice(pos + 1);
            profiles.push({ bits, color: color !== '' ? color : '#666' });
        });
        µBlock.liveBlockingProfiles = profiles;
        µBlock.blockingProfileColorCache.clear();
    };

    parse();

    self.addEventListener('hiddenSettingsChanged', ( ) => { parse(); });

    return parse;
})();

/******************************************************************************/

// https://github.com/NanoMeow/QuickReports/issues/6#issuecomment-414516623
//   Inject as early as possible to make the cosmetic logger code less
//   sensitive to the removal of DOM nodes which may match injected
//   cosmetic filters.

µBlock.logCosmeticFilters = function(tabId, frameId) {
    vAPI.tabs.executeScript(tabId, {
        file: '/js/scriptlets/cosmetic-logger.js',
        frameId: frameId,
        runAt: 'document_start'
    });
};

/******************************************************************************/

µBlock.scriptlets = (function() {
    const pendingEntries = new Map();

    const Entry = class {
        constructor(tabId, scriptlet, callback) {
            this.tabId = tabId;
            this.scriptlet = scriptlet;
            this.callback = callback;
            this.timer = vAPI.setTimeout(this.service.bind(this), 1000);
        }
        service(response) {
            if ( this.timer !== null ) {
                clearTimeout(this.timer);
                this.timer = null;
            }
            pendingEntries.delete(makeKey(this.tabId, this.scriptlet));
            this.callback(response);
        }
    };

    const makeKey = function(tabId, scriptlet) {
        return tabId + ' ' + scriptlet;
    };

    const report = function(tabId, scriptlet, response) {
        const key = makeKey(tabId, scriptlet);
        const entry = pendingEntries.get(key);
        if ( entry === undefined ) { return; }
        entry.service(response);
    };

    const inject = function(tabId, scriptlet, callback) {
        if ( typeof callback === 'function' ) {
            if ( vAPI.isBehindTheSceneTabId(tabId) ) {
                callback();
                return;
            }
            const key = makeKey(tabId, scriptlet);
            const entry = pendingEntries.get(key);
            if ( entry !== undefined ) {
                if ( callback !== entry.callback ) {
                    callback();
                }
                return;
            }
            pendingEntries.set(key, new Entry(tabId, scriptlet, callback));
        }
        vAPI.tabs.executeScript(tabId, {
            file: `/js/scriptlets/${scriptlet}.js`
        });
    };

    // TODO: think about a callback mechanism.
    const injectDeep = function(tabId, scriptlet) {
        vAPI.tabs.executeScript(tabId, {
            file: `/js/scriptlets/${scriptlet}.js`,
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
