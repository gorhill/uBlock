/*******************************************************************************

    uBlock - a browser extension to block requests.
    Copyright (C) 2014-2015 Raymond Hill

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
/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

// https://github.com/gorhill/httpswitchboard/issues/303
// Some kind of trick going on here:
//   Any scheme other than 'http' and 'https' is remapped into a fake
//   URL which trick the rest of µBlock into being able to process an
//   otherwise unmanageable scheme. µBlock needs web page to have a proper
//   hostname to work properly, so just like the 'chromium-behind-the-scene'
//   fake domain name, we map unknown schemes into a fake '{scheme}-scheme'
//   hostname. This way, for a specific scheme you can create scope with
//   rules which will apply only to that scheme.

/******************************************************************************/
/******************************************************************************/

µb.normalizePageURL = function(tabId, pageURL) {
    if ( vAPI.isBehindTheSceneTabId(tabId) ) {
        return 'http://behind-the-scene/';
    }
    var uri = this.URI.set(pageURL);
    var scheme = uri.scheme;
    if ( scheme === 'https' || scheme === 'http' ) {
        return uri.normalizedURI();
    }

    var fakeHostname = scheme + '-scheme';

    if ( uri.hostname !== '' ) {
        fakeHostname = uri.hostname + '.' + fakeHostname;
    } else if ( scheme === 'about' && uri.path !== '' ) {
        fakeHostname = uri.path + '.' + fakeHostname;
    }

    return 'http://' + fakeHostname + '/';
};

/******************************************************************************/
/******************************************************************************

To keep track from which context *exactly* network requests are made. This is
often tricky for various reasons, and the challenge is not specific to one
browser.

The time at which a URL is assigned to a tab and the time when a network
request for a root document is made must be assumed to be unrelated: it's all
asynchronous. There is no guaranteed order in which the two events are fired.

Also, other "anomalies" can occur:

- a network request for a root document is fired without the corresponding
tab being really assigned a new URL
<https://github.com/chrisaljoudi/uBlock/issues/516>

- a network request for a secondary resource is labeled with a tab id for
which no root document was pulled for that tab.
<https://github.com/chrisaljoudi/uBlock/issues/1001>

- a network request for a secondary resource is made without the root
document to which it belongs being formally bound yet to the proper tab id,
causing a bad scope to be used for filtering purpose.
<https://github.com/chrisaljoudi/uBlock/issues/1205>
<https://github.com/chrisaljoudi/uBlock/issues/1140>

So the solution here is to keep a lightweight data structure which only
purpose is to keep track as accurately as possible of which root document
belongs to which tab. That's the only purpose, and because of this, there are
no restrictions for when the URL of a root document can be associated to a tab.

Before, the PageStore object was trying to deal with this, but it had to
enforce some restrictions so as to not descend into one of the above issues, or
other issues. The PageStore object can only be associated with a tab for which
a definitive navigation event occurred, because it collects information about
what occurred in the tab (for example, the number of requests blocked for a
page).

The TabContext objects do not suffer this restriction, and as a result they
offer the most reliable picture of which root document URL is really associated
to which tab. Moreover, the TabObject can undo an association from a root
document, and automatically re-associate with the next most recent. This takes
care of <https://github.com/chrisaljoudi/uBlock/issues/516>.

The PageStore object no longer cache the various information about which
root document it is currently bound. When it needs to find out, it will always
defer to the TabContext object, which will provide the real answer. This takes
case of <https://github.com/chrisaljoudi/uBlock/issues/1205>. In effect, the
master switch and dynamic filtering rules can be evaluated now properly even
in the absence of a PageStore object, this was not the case before.

Also, the TabContext object will try its best to find a good candidate root
document URL for when none exists. This takes care of 
<https://github.com/chrisaljoudi/uBlock/issues/1001>.

The TabContext manager is self-contained, and it takes care to properly
housekeep itself.

*/

µb.tabContextManager = (function() {
    var tabContexts = Object.create(null);

    // https://github.com/chrisaljoudi/uBlock/issues/1001
    // This is to be used as last-resort fallback in case a tab is found to not
    // be bound while network requests are fired for the tab.
    var mostRecentRootDocURL = '';
    var mostRecentRootDocURLTimestamp = 0;

    var gcPeriod = 10 * 60 * 1000;

    // A pushed entry is removed from the stack unless it is committed with
    // a set time.
    var StackEntry = function(url, commit) {
        this.url = url;
        this.committed = commit;
        this.tstamp = Date.now();
    };

    var TabContext = function(tabId) {
        this.tabId = tabId.toString();
        this.stack = [];
        this.rawURL =
        this.normalURL =
        this.rootHostname =
        this.rootDomain = '';
        this.commitTimer = null;
        this.gcTimer = null;
        this.netFiltering = true;
        this.netFilteringReadTime = 0;

        tabContexts[tabId] = this;
    };

    TabContext.prototype.destroy = function() {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) {
            return;
        }
        if ( this.gcTimer !== null ) {
            clearTimeout(this.gcTimer);
            this.gcTimer = null;
        }
        delete tabContexts[this.tabId];
    };

    TabContext.prototype.onTab = function(tab) {
        if ( tab ) {
            this.gcTimer = vAPI.setTimeout(this.onGC.bind(this), gcPeriod);
        } else {
            this.destroy();
        }
    };

    TabContext.prototype.onGC = function() {
        this.gcTimer = null;
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) {
            return;
        }
        vAPI.tabs.get(this.tabId, this.onTab.bind(this));
    };

    // https://github.com/gorhill/uBlock/issues/248
    // Stack entries have to be committed to stick. Non-committed stack
    // entries are removed after a set delay.
    TabContext.prototype.onCommit = function() {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) {
            return;
        }
        this.commitTimer = null;
        // Remove uncommitted entries at the top of the stack.
        var i = this.stack.length;
        while ( i-- ) {
            if ( this.stack[i].committed ) {
                break;
            }
        }
        // https://github.com/gorhill/uBlock/issues/300
        // If no committed entry was found, fall back on the bottom-most one
        // as being the committed one by default.
        if ( i === -1 && this.stack.length !== 0 ) {
            this.stack[0].committed = true;
            i = 0;
        }
        i += 1;
        if ( i < this.stack.length ) {
            this.stack.length = i;
            this.update();
        }
    };

    // This takes care of orphanized tab contexts. Can't be started for all
    // contexts, as the behind-the-scene context is permanent -- so we do not
    // want to flush it.
    TabContext.prototype.autodestroy = function() {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) {
            return;
        }
        this.gcTimer = vAPI.setTimeout(this.onGC.bind(this), gcPeriod);
    };

    // Update just force all properties to be updated to match the most recent
    // root URL.
    TabContext.prototype.update = function() {
        this.netFilteringReadTime = 0;
        if ( this.stack.length === 0 ) {
            this.rawURL = this.normalURL = this.rootHostname = this.rootDomain = '';
            return;
        }
        var stackEntry = this.stack[this.stack.length - 1];
        this.rawURL = stackEntry.url;
        this.normalURL = µb.normalizePageURL(this.tabId, this.rawURL);
        this.rootHostname = µb.URI.hostnameFromURI(this.normalURL);
        this.rootDomain = µb.URI.domainFromHostname(this.rootHostname);
    };

    // Called whenever a candidate root URL is spotted for the tab.
    TabContext.prototype.push = function(url) {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) {
            return;
        }
        var count = this.stack.length;
        if ( count !== 0 && this.stack[count - 1].url === url ) {
            return;
        }
        this.stack.push(new StackEntry(url));
        this.update();
        if ( this.commitTimer === null ) {
            clearTimeout(this.commitTimer);
        }
        this.commitTimer = vAPI.setTimeout(this.onCommit.bind(this), 1000);
    };

    // Called when a former push is a false positive:
    //   https://github.com/chrisaljoudi/uBlock/issues/516
    TabContext.prototype.unpush = function(url) {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) {
            return;
        }
        // We are not going to unpush if there is no other candidate, the
        // point of unpush is to make space for a better candidate.
        var i = this.stack.length;
        if ( i === 1 ) {
            return;
        }
        while ( i-- ) {
            if ( this.stack[i].url !== url ) {
                continue;
            }
            this.stack.splice(i, 1);
            if ( i === this.stack.length ) {
                this.update();
            }
            return;
        }
    };

    // This tells that the url is definitely the one to be associated with the
    // tab, there is no longer any ambiguity about which root URL is really
    // sitting in which tab.
    TabContext.prototype.commit = function(url) {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) {
            return;
        }
        this.stack = [new StackEntry(url, true)];
        this.update();
    };

    TabContext.prototype.getNetFilteringSwitch = function() {
        if ( this.netFilteringReadTime > µb.netWhitelistModifyTime ) {
            return this.netFiltering;
        }
        // https://github.com/chrisaljoudi/uBlock/issues/1078
        // Use both the raw and normalized URLs.
        this.netFiltering = µb.getNetFilteringSwitch(this.normalURL);
        if ( this.netFiltering && this.rawURL !== this.normalURL && this.rawURL !== '' ) {
            this.netFiltering = µb.getNetFilteringSwitch(this.rawURL);
        }
        this.netFilteringReadTime = Date.now();
        return this.netFiltering;
    };

    // These are to be used for the API of the tab context manager.

    var push = function(tabId, url) {
        var entry = tabContexts[tabId];
        if ( entry === undefined ) {
            entry = new TabContext(tabId);
            entry.autodestroy();
        }
        entry.push(url);
        mostRecentRootDocURL = url;
        mostRecentRootDocURLTimestamp = Date.now();
        return entry;
    };

    // Find a tab context for a specific tab. If none is found, attempt to
    // fix this. When all fail, the behind-the-scene context is returned.
    var lookup = function(tabId, url) {
        var entry;
        if ( url !== undefined ) {
            entry = push(tabId, url);
        } else {
            entry = tabContexts[tabId];
        }
        if ( entry !== undefined ) {
            return entry;
        }
        // https://github.com/chrisaljoudi/uBlock/issues/1025
        // Google Hangout popup opens without a root frame. So for now we will
        // just discard that best-guess root frame if it is too far in the
        // future, at which point it ceases to be a "best guess".
        if ( mostRecentRootDocURL !== '' && mostRecentRootDocURLTimestamp + 500 < Date.now() ) {
            mostRecentRootDocURL = '';
        }
        // https://github.com/chrisaljoudi/uBlock/issues/1001
        // Not a behind-the-scene request, yet no page store found for the
        // tab id: we will thus bind the last-seen root document to the
        // unbound tab. It's a guess, but better than ending up filtering
        // nothing at all.
        if ( mostRecentRootDocURL !== '' ) {
            return push(tabId, mostRecentRootDocURL);
        }
        // If all else fail at finding a page store, re-categorize the
        // request as behind-the-scene. At least this ensures that ultimately
        // the user can still inspect/filter those net requests which were
        // about to fall through the cracks.
        // Example: Chromium + case #12 at
        //          http://raymondhill.net/ublock/popup.html
        return tabContexts[vAPI.noTabId];
    };

    var commit = function(tabId, url) {
        var entry = tabContexts[tabId];
        if ( entry === undefined ) {
            entry = push(tabId, url);
        } else {
            entry.commit(url);
        }
        return entry;
    };

    var unpush = function(tabId, url) {
        var entry = tabContexts[tabId];
        if ( entry !== undefined ) {
            entry.unpush(url);
        }
    };

    var exists = function(tabId) {
        return tabContexts[tabId] !== undefined;
    };

    // Behind-the-scene tab context
    (function() {
        var entry = new TabContext(vAPI.noTabId);
        entry.stack.push(new StackEntry('', true));
        entry.rawURL = '';
        entry.normalURL = µb.normalizePageURL(entry.tabId);
        entry.rootHostname = µb.URI.hostnameFromURI(entry.normalURL);
        entry.rootDomain = µb.URI.domainFromHostname(entry.rootHostname);
    })();

    // Context object, typically to be used to feed filtering engines.
    var Context = function(tabId) {
        var tabContext = lookup(tabId);
        this.rootHostname = tabContext.rootHostname;
        this.rootDomain = tabContext.rootDomain;
        this.pageHostname = 
        this.pageDomain =
        this.requestURL =
        this.requestHostname =
        this.requestDomain = '';
    };

    var createContext = function(tabId) {
        return new Context(tabId);
    };

    return {
        push: push,
        unpush: unpush,
        commit: commit,
        lookup: lookup,
        exists: exists,
        createContext: createContext
    };
})();

/******************************************************************************/
/******************************************************************************/

// When the DOM content of root frame is loaded, this means the tab
// content has changed.

vAPI.tabs.onNavigation = function(details) {
    if ( details.frameId !== 0 ) {
        return;
    }
    var tabContext = µb.tabContextManager.commit(details.tabId, details.url);
    var pageStore = µb.bindTabToPageStats(details.tabId, 'afterNavigate');

    // https://github.com/chrisaljoudi/uBlock/issues/630
    // The hostname of the bound document must always be present in the
    // mini-matrix. That's the best place I could find for the fix, all other
    // options had bad side-effects or complications.
    // TODO: Eventually, we will have to use an API to check whether a scheme
    //       is supported as I suspect we are going to start to see `ws`, `wss`
    //       as well soon.
    if ( pageStore && tabContext.rawURL.lastIndexOf('http', 0) === 0 ) {
        pageStore.hostnameToCountMap[tabContext.rootHostname] = 0;
    }
};

/******************************************************************************/

// It may happen the URL in the tab changes, while the page's document
// stays the same (for instance, Google Maps). Without this listener,
// the extension icon won't be properly refreshed.

vAPI.tabs.onUpdated = function(tabId, changeInfo, tab) {
    if ( !tab.url || tab.url === '' ) {
        return;
    }
    if ( !changeInfo.url ) {
        return;
    }
    µb.tabContextManager.commit(tabId, changeInfo.url);
    µb.bindTabToPageStats(tabId, 'tabUpdated');
};

/******************************************************************************/

vAPI.tabs.onClosed = function(tabId) {
    if (  vAPI.isBehindTheSceneTabId(tabId) ) {
        return;
    }
    µb.unbindTabFromPageStats(tabId);
};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/297

vAPI.tabs.onPopup = function(details) {
    //console.debug('vAPI.tabs.onPopup: details = %o', details);

    var tabContext = µb.tabContextManager.lookup(details.openerTabId);
    var openerURL = '';
    if ( tabContext.tabId === details.openerTabId ) {
        openerURL = tabContext.normalURL;
    }
    if ( openerURL === '' ) {
        return;
    }

    var µburi = µb.URI;

    // https://github.com/gorhill/uBlock/issues/341
    // Allow popups if uBlock is turned off in opener's context.
    if ( µb.getNetFilteringSwitch(openerURL) === false ) {
        return;
    }

    var targetURL = details.targetURL;

    // If the page URL is that of our "blocked page" URL, extract the URL of
    // the page which was blocked.
    if ( targetURL.lastIndexOf(vAPI.getURL('document-blocked.html'), 0) === 0 ) {
        var matches = /details=([^&]+)/.exec(targetURL);
        if ( matches !== null ) {
            targetURL = JSON.parse(atob(matches[1])).url;
        }
    }

    var openerHostname = µburi.hostnameFromURI(openerURL);
    var openerDomain = µburi.domainFromHostname(openerHostname);
    var context = {
        pageHostname: openerHostname,
        pageDomain: openerDomain,
        rootHostname: openerHostname,
        rootDomain: openerDomain,
        requestURL: targetURL,
        requestHostname: µb.URI.hostnameFromURI(targetURL),
        requestType: 'popup'
    };

    var result = '';
    var loggerEnabled = µb.logger.isEnabled();

    // Check user switch first
    if (
        targetURL !== µb.mouseURL &&
        µb.hnSwitches.evaluateZ('no-popups', openerHostname)
    ) {
        result = 'ub:no-popups: ' + µb.hnSwitches.z + ' true';
    }

    // https://github.com/gorhill/uBlock/issues/581
    //   Take into account popup-specific rules in dynamic URL filtering, OR
    //   generic allow rules.
    if ( result === '' ) {
        µb.sessionURLFiltering.evaluateZ(openerHostname, targetURL, 'popup');
        if (
            µb.sessionURLFiltering.r === 1 && µb.sessionURLFiltering.type === 'popup' ||
            µb.sessionURLFiltering.r === 2
        ) {
            result = µb.sessionURLFiltering.toFilterString();
        }
    }

    // https://github.com/gorhill/uBlock/issues/581
    //   Take into account `allow` rules in dynamic filtering: `block` rules
    //   are ignored, as block rules are not meant to block specific types
    //   like `popup` (just like with static filters).
    if ( result === '' ) {
        µb.sessionFirewall.evaluateCellZY(openerHostname, context.requestHostname, 'popup');
        if ( µb.sessionFirewall.r === 2 ) {
            result = µb.sessionFirewall.toFilterString();
        }
    }

    // https://github.com/chrisaljoudi/uBlock/issues/323
    // https://github.com/chrisaljoudi/uBlock/issues/1142
    //   Don't block if uBlock is turned off in popup's context
    if (
        result === '' &&
        µb.getNetFilteringSwitch(targetURL) &&
        µb.staticNetFilteringEngine.matchStringExactType(context, targetURL, 'popup') !== undefined
    ) {
        result = µb.staticNetFilteringEngine.toResultString(loggerEnabled);
    }

    // https://github.com/chrisaljoudi/uBlock/issues/91
    var pageStore = µb.pageStoreFromTabId(details.openerTabId);
    if ( pageStore ) {
        pageStore.logRequest(context, result);
    }

    if ( loggerEnabled ) {
        µb.logger.writeOne(
            details.openerTabId,
            'net',
            result,
            'popup',
            targetURL,
            openerHostname,
            openerHostname
        );
    }

    // Not blocked
    if ( µb.isAllowResult(result) ) {
        return;
    }

    // Blocked
    if ( µb.userSettings.showIconBadge ) {
        µb.updateBadgeAsync(details.openerTabId);
    }

    // It is a popup, block and remove the tab.
    µb.unbindTabFromPageStats(details.targetTabId);
    vAPI.tabs.remove(details.targetTabId);

    return true;
};

vAPI.tabs.registerListeners();

/******************************************************************************/
/******************************************************************************/

// Create an entry for the tab if it doesn't exist.

µb.bindTabToPageStats = function(tabId, context) {
    this.updateBadgeAsync(tabId);

    // Do not create a page store for URLs which are of no interests
    if ( µb.tabContextManager.exists(tabId) === false ) {
        this.unbindTabFromPageStats(tabId);
        return null;
    }

    // Reuse page store if one exists: this allows to guess if a tab is a popup
    var pageStore = this.pageStores[tabId];

    // Tab is not bound
    if ( !pageStore ) {
        this.updateTitle(tabId);
        this.pageStoresToken = Date.now();
        return (this.pageStores[tabId] = this.PageStore.factory(tabId));
    }

    // https://github.com/chrisaljoudi/uBlock/issues/516
    // Never rebind behind-the-scene scope
    if ( vAPI.isBehindTheSceneTabId(tabId) ) {
        return pageStore;
    }

    // https://github.com/gorhill/uBlock/issues/516
    // If context if 'beforeRequest', do not rebind, wait for confirmation.
    if ( context === 'beforeRequest' ) {
        return pageStore;
    }

    // Rebind according to context. We rebind even if the URL did not change,
    // as maybe the tab was force-reloaded, in which case the page stats must
    // be all reset.
    pageStore.reuse(context);

    this.updateTitle(tabId);
    this.pageStoresToken = Date.now();

    return pageStore;
};

/******************************************************************************/

µb.unbindTabFromPageStats = function(tabId) {
    //console.debug('µBlock> unbindTabFromPageStats(%d)', tabId);
    var pageStore = this.pageStores[tabId];
    if ( pageStore !== undefined ) {
        pageStore.dispose();
        delete this.pageStores[tabId];
        this.pageStoresToken = Date.now();
    }
};

/******************************************************************************/

µb.pageStoreFromTabId = function(tabId) {
    return this.pageStores[tabId] || null;
};

/******************************************************************************/

// Permanent page store for behind-the-scene requests. Must never be removed.

µb.pageStores[vAPI.noTabId] = µb.PageStore.factory(vAPI.noTabId);
µb.pageStores[vAPI.noTabId].title = vAPI.i18n('logBehindTheScene');

/******************************************************************************/

µb.updateTitle = (function() {
    var tabIdToTimer = Object.create(null);
    var tabIdToTryCount = Object.create(null);
    var delay = 499;

    var tryNoMore = function(tabId) {
        delete tabIdToTryCount[tabId];
    };

    var tryAgain = function(tabId) {
        var count = tabIdToTryCount[tabId];
        if ( count === undefined ) {
            return false;
        }
        if ( count === 1 ) {
            delete tabIdToTryCount[tabId];
            return false;
        }
        tabIdToTryCount[tabId] = count - 1;
        tabIdToTimer[tabId] = vAPI.setTimeout(updateTitle.bind(µb, tabId), delay);
        return true;
    };

    var onTabReady = function(tabId, tab) {
        if ( !tab ) {
            return tryNoMore(tabId);
        }
        var pageStore = this.pageStoreFromTabId(tabId);
        if ( pageStore === null ) {
            return tryNoMore(tabId);
        }
        // Firefox needs this: if you detach a tab, the new tab won't have
        // its rawURL set. Concretely, this causes the logger to report an
        // entry to itself in the logger's tab selector.
        // TODO: Investigate for a fix vAPI-side.
        pageStore.rawURL = tab.url;
        this.pageStoresToken = Date.now();
        if ( !tab.title && tryAgain(tabId) ) {
            return;
        }
        // https://github.com/gorhill/uMatrix/issues/225
        // Sometimes title changes while page is loading.
        var settled = tab.title && tab.title === pageStore.title;
        pageStore.title = tab.title || tab.url || '';
        this.pageStoresToken = Date.now();
        if ( settled || !tryAgain(tabId) ) {
            tryNoMore(tabId);
        }
    };

    var updateTitle = function(tabId) {
        delete tabIdToTimer[tabId];
        vAPI.tabs.get(tabId, onTabReady.bind(this, tabId));
    };

    return function(tabId) {
        if ( vAPI.isBehindTheSceneTabId(tabId) ) {
            return;
        }
        if ( tabIdToTimer[tabId] ) {
            clearTimeout(tabIdToTimer[tabId]);
        }
        tabIdToTimer[tabId] = vAPI.setTimeout(updateTitle.bind(this, tabId), delay);
        tabIdToTryCount[tabId] = 5;
    };
})();

/******************************************************************************/

// Stale page store entries janitor
// https://github.com/chrisaljoudi/uBlock/issues/455

var pageStoreJanitorPeriod = 15 * 60 * 1000;
var pageStoreJanitorSampleAt = 0;
var pageStoreJanitorSampleSize = 10;

var pageStoreJanitor = function() {
    var vapiTabs = vAPI.tabs;
    var tabIds = Object.keys(µb.pageStores).sort();
    var checkTab = function(tabId) {
        vapiTabs.get(tabId, function(tab) {
            if ( !tab ) {
                //console.error('tab.js> pageStoreJanitor(): stale page store found:', µtabId);
                µb.unbindTabFromPageStats(tabId);
            }
        });
    };
    if ( pageStoreJanitorSampleAt >= tabIds.length ) {
        pageStoreJanitorSampleAt = 0;
    }
    var tabId;
    var n = Math.min(pageStoreJanitorSampleAt + pageStoreJanitorSampleSize, tabIds.length);
    for ( var i = pageStoreJanitorSampleAt; i < n; i++ ) {
        tabId = tabIds[i];
        // Do not remove behind-the-scene page store
        if ( vAPI.isBehindTheSceneTabId(tabId) ) {
            continue;
        }
        checkTab(tabId);
    }
    pageStoreJanitorSampleAt = n;

    vAPI.setTimeout(pageStoreJanitor, pageStoreJanitorPeriod);
};

vAPI.setTimeout(pageStoreJanitor, pageStoreJanitorPeriod);

/******************************************************************************/

})();

/******************************************************************************/
