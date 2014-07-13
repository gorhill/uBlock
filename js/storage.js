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

/* global chrome, µBlock, punycode, publicSuffixList */

/******************************************************************************/

µBlock.getBytesInUse = function() {
    var getBytesInUseHandler = function(bytesInUse) {
        µBlock.storageUsed = bytesInUse;
    };
    chrome.storage.local.getBytesInUse(null, getBytesInUseHandler);
};

/******************************************************************************/

µBlock.saveLocalSettings = function() {
    chrome.storage.local.set(this.localSettings, function() {
        µBlock.getBytesInUse();
    });
};

/******************************************************************************/

µBlock.loadLocalSettings = function() {
    var settingsLoaded = function(store) {
        µBlock.localSettings = store;
    };

    chrome.storage.local.get(this.localSettings, settingsLoaded);
};

/******************************************************************************/

// Save local settings regularly. Not critical.

µBlock.asyncJobs.add(
    'autoSaveLocalSettings',
    null,
    µBlock.saveLocalSettings.bind(µBlock),
    2 * 60 * 1000,
    true
);

/******************************************************************************/

µBlock.saveUserSettings = function() {
    chrome.storage.local.set(this.userSettings, function() {
        µBlock.getBytesInUse();
    });
};

/******************************************************************************/

µBlock.loadUserSettings = function() {
    var settingsLoaded = function(store) {
        µBlock.userSettings = store;
    };

    chrome.storage.local.get(this.userSettings, settingsLoaded);
};

/******************************************************************************/

µBlock.saveUserFilters = function(content, callback) {
    return this.assets.put(this.userFiltersPath, content, callback);
};

/******************************************************************************/

µBlock.loadUserFilters = function(callback) {
    return this.assets.get(this.userFiltersPath, callback);
};

/******************************************************************************/

µBlock.appendUserFilters = function(content) {
    var onSaved = function(details) {
        if ( details.error ) {
            return;
        }
        µBlock.loadUbiquitousBlacklists();
    };
    var onLoaded = function(details) {
        if ( details.error ) {
            return;
        }
        if ( details.content.indexOf(content.trim()) !== -1 ) {
            return;
        }
        µBlock.saveUserFilters(details.content + '\n' + content, onSaved);
    };
    if ( content.length > 0 ) {
        this.loadUserFilters(onLoaded);
    }
};

/******************************************************************************/

µBlock.loadUbiquitousBlacklists = function() {
    var blacklistLoadCount;
    var obsoleteBlacklists = [];

    var removeObsoleteBlacklistsHandler = function(store) {
        if ( !store.remoteBlacklists ) {
            return;
        }
        var location;
        while ( location = obsoleteBlacklists.pop() ) {
            delete store.remoteBlacklists[location];
        }
        chrome.storage.local.set(store);
    };

    var removeObsoleteBlacklists = function() {
        if ( obsoleteBlacklists.length === 0 ) {
            return;
        }
        chrome.storage.local.get(
            { 'remoteBlacklists': µBlock.remoteBlacklists },
            removeObsoleteBlacklistsHandler
        );
    };

    var mergeBlacklist = function(details) {
        var µb = µBlock;
        µb.mergeUbiquitousBlacklist(details);
        blacklistLoadCount -= 1;
        if ( blacklistLoadCount === 0 ) {
            loadBlacklistsEnd();
        }
    };

    var loadBlacklistsEnd = function() {
        µBlock.abpFilters.freeze();
        µBlock.abpHideFilters.freeze();
        removeObsoleteBlacklists();
        µBlock.messaging.announce({ what: 'loadUbiquitousBlacklistCompleted' });
    };

    var loadBlacklistsStart = function(store) {
        var µb = µBlock;

        // rhill 2013-12-10: set all existing entries to `false`.
        µb.abpFilters.reset();
        µb.abpHideFilters.reset();
        var storedLists = store.remoteBlacklists;
        var storedListLocations = Object.keys(storedLists);

        blacklistLoadCount = storedListLocations.length;
        if ( blacklistLoadCount === 0 ) {
            loadBlacklistsEnd();
            return;
        }

        // Backward compatibility for when a list changes location
        var relocations = [
            {
                // https://github.com/gorhill/httpswitchboard/issues/361
                 'bad': 'assets/thirdparties/adblock-czechoslovaklist.googlecode.com/svn/filters.txt',
                'good': 'assets/thirdparties/raw.githubusercontent.com/tomasko126/easylistczechandslovak/master/filters.txt'
            }
        ];
        var relocation;
        while ( relocation = relocations.pop() ) {
            if ( µb.remoteBlacklists[relocation.good] && storedLists[relocation.bad] ) {
                storedLists[relocation.good].off = storedLists[relocation.bad].off;
            }
        }

        // Load each preset blacklist which is not disabled.
        var location;
        while ( location = storedListLocations.pop() ) {
            // If loaded list location is not part of default list locations,
            // remove its entry from local storage.
            if ( !µb.remoteBlacklists[location] ) {
                obsoleteBlacklists.push(location);
                blacklistLoadCount -= 1;
                continue;
            }
            // https://github.com/gorhill/httpswitchboard/issues/218
            // Transfer potentially existing list title into restored list data.
            if ( storedLists[location].title !== µb.remoteBlacklists[location].title ) {
                storedLists[location].title = µb.remoteBlacklists[location].title;
            }
            // Store details of this preset blacklist
            µb.remoteBlacklists[location] = storedLists[location];
            // rhill 2013-12-09:
            // Ignore list if disabled
            // https://github.com/gorhill/httpswitchboard/issues/78
            if ( storedLists[location].off ) {
                blacklistLoadCount -= 1;
                continue;
            }
            µb.assets.get(location, mergeBlacklist);
        }
    };

    var onListOfBlockListsLoaded = function(details) {
        var µb = µBlock;
        // Initialize built-in list of 3rd-party block lists.
        var lists = JSON.parse(details.content);
        for ( var location in lists ) {
            if ( lists.hasOwnProperty(location) === false ) {
                continue;
            }
            µb.remoteBlacklists['assets/thirdparties/' + location] = lists[location];
        }
        // Now get user's selection of list of block lists.
        chrome.storage.local.get(
            { 'remoteBlacklists': µb.remoteBlacklists },
            loadBlacklistsStart
        );
    };

    // Reset list of 3rd-party block lists.
    for ( var location in this.remoteBlacklists ) {
        if ( location.indexOf('assets/thirdparties/') === 0 ) {
            delete this.remoteBlacklists[location];
        }
    }

    // Get new list of 3rd-party block lists.
    this.assets.get('assets/ublock/filter-lists.json', onListOfBlockListsLoaded);
};

/******************************************************************************/

µBlock.mergeUbiquitousBlacklist = function(details) {
    // console.log('µBlock > mergeUbiquitousBlacklist from "%s": "%s..."', details.path, details.content.slice(0, 40));

    var rawText = details.content;
    var rawEnd = rawText.length;

    // rhill 2013-10-21: No need to prefix with '* ', the hostname is just what
    // we need for preset blacklists. The prefix '* ' is ONLY needed when
    // used as a filter in temporary blacklist.

    // rhill 2014-01-22: Transpose possible Adblock Plus-filter syntax
    // into a plain hostname if possible.
    // Useful references:
    //    https://adblockplus.org/en/filter-cheatsheet
    //    https://adblockplus.org/en/filters
    var abpFilters = this.abpFilters;
    var abpHideFilters = this.userSettings.parseAllABPHideFilters ? this.abpHideFilters : null;
    var thisListCount = 0;
    var thisListUsedCount = 0;
    var reLocalhost = /(^|\s)(localhost\.localdomain|localhost|local|broadcasthost|0\.0\.0\.0|127\.0\.0\.1|::1|fe80::1%lo0)(?=\s|$)/g;
    var reAdblockFilter = /^[^a-z0-9:]|[^a-z0-9]$|[^a-z0-9_:.-]/;
    var reAdblockHostFilter = /^\|\|([a-z0-9.-]+[a-z0-9])\^?$/;
    var reAsciiSegment = /^[\x21-\x7e]+$/;
    var matches;
    var lineBeg = 0, lineEnd, currentLineBeg;
    var line, c;

    while ( lineBeg < rawEnd ) {
        lineEnd = rawText.indexOf('\n', lineBeg);
        if ( lineEnd < 0 ) {
            lineEnd = rawText.indexOf('\r', lineBeg);
            if ( lineEnd < 0 ) {
                lineEnd = rawEnd;
            }
        }

        // rhill 2014-04-18: The trim is important here, as without it there
        // could be a lingering `\r` which would cause problems in the
        // following parsing code.
        line = rawText.slice(lineBeg, lineEnd).trim();
        currentLineBeg = lineBeg;
        lineBeg = lineEnd + 1;

        // Strip comments
        c = line.charAt(0);
        if ( c === '!' || c === '[' ) {
            continue;
        }

        // 2014-05-18: ABP element hide filters are allowed to contain space
        // characters
        if ( abpHideFilters !== null ) {
            if ( abpHideFilters.add(line) ) {
                continue;
            }
        }

        if ( c === '#' ) {
            continue;
        }

        // https://github.com/gorhill/httpswitchboard/issues/15
        // Ensure localhost et al. don't end up in the ubiquitous blacklist.
        line = line
            .replace(/\s+#.*$/, '')
            .toLowerCase()
            .replace(reLocalhost, '')
            .trim();

        // The filter is whatever sequence of printable ascii character without
        // whitespaces
        matches = reAsciiSegment.exec(line);
        if ( !matches || matches.length === 0 ) {
            continue;
        }

        // Bypass anomalies
        // For example, when a filter contains whitespace characters, or
        // whatever else outside the range of printable ascii characters.
        if ( matches[0] !== line ) {
            // console.error('"%s": "%s" !== "%s"', details.path, matches[0], line);
            continue;
        }

        line = matches[0];

        // Likely an ABP net filter?
        if ( reAdblockFilter.test(line) ) {
            if ( abpFilters !== null ) {
                if ( abpFilters.add(line) ) {
                    thisListCount++;
                    thisListUsedCount++;
                    continue;
                }
            }
            // rhill 2014-01-22: Transpose possible Adblock Plus-filter syntax
            // into a plain hostname if possible.
            matches = reAdblockHostFilter.exec(line);
            if ( !matches || matches.length < 2 ) {
                continue;
            }
            line = matches[1];
        }

        if ( line === '' ) {
            continue;
        }

        thisListCount++;
        if ( abpFilters.addAnyPartyHostname(line) ) {
            thisListUsedCount++;
        }
    }

    // For convenience, store the number of entries for this
    // blacklist, user might be happy to know this information.
    this.remoteBlacklists[details.path].entryCount = thisListCount;
    this.remoteBlacklists[details.path].entryUsedCount = thisListUsedCount;
};

/******************************************************************************/

// `switches` contains the preset blacklists for which the switch must be
// revisited.

µBlock.reloadPresetBlacklists = function(switches) {
    var presetBlacklists = this.remoteBlacklists;

    // Toggle switches, if any
    if ( switches !== undefined ) {
        var i = switches.length;
        while ( i-- ) {
            if ( !presetBlacklists[switches[i].location] ) {
                continue;
            }
            presetBlacklists[switches[i].location].off = !!switches[i].off;
        }

        // Save switch states
        chrome.storage.local.set({ 'remoteBlacklists': presetBlacklists }, function() {
            µBlock.getBytesInUse();
        });
    }

    // Now force reload
    this.loadUbiquitousBlacklists();
};

/******************************************************************************/

µBlock.loadPublicSuffixList = function() {
    var applyPublicSuffixList = function(details) {
        // TODO: Not getting proper suffix list is a bit serious, I think
        // the extension should be force-restarted if it occurs..
        if ( !details.error ) {
            publicSuffixList.parse(details.content, punycode.toASCII);
        }
    };
    this.assets.get(
        'assets/thirdparties/publicsuffix.org/list/effective_tld_names.dat',
        applyPublicSuffixList
    );
};

/******************************************************************************/

// Load updatable assets

µBlock.loadUpdatableAssets = function() {
    this.loadUbiquitousBlacklists();
    this.loadPublicSuffixList();
};

/******************************************************************************/

// Load all

µBlock.load = function() {
    this.loadLocalSettings();
    this.loadUserSettings();

    // load updatable assets -- after updating them if needed
    this.assetUpdater.update(null, this.loadUpdatableAssets.bind(this));

    this.getBytesInUse();
};
