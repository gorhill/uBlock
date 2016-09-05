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

/* exported µBlock */

'use strict';

/******************************************************************************/

var µBlock = (function() {

/******************************************************************************/

var oneSecond = 1000;
var oneMinute = 60 * oneSecond;
var oneHour = 60 * oneMinute;
// var oneDay = 24 * oneHour;

/******************************************************************************/

var defaultExternalLists = [
    '! Examples:',
    '! https://easylist-downloads.adblockplus.org/fb_annoyances_full.txt',
    '! https://easylist-downloads.adblockplus.org/yt_annoyances_full.txt',
    ''
].join('\n');

/******************************************************************************/

return {
    firstInstall: false,

    userSettings: {
        advancedUserEnabled: false,
        autoUpdate: true,
        cloudStorageEnabled: false,
        collapseBlocked: true,
        colorBlindFriendly: false,
        contextMenuEnabled: true,
        dynamicFilteringEnabled: true,
        externalLists: defaultExternalLists,
        firewallPaneMinimized: true,
        hyperlinkAuditingDisabled: true,
        ignoreGenericCosmeticFilters: false,
        largeMediaSize: 50,
        parseAllABPHideFilters: true,
        prefetchingDisabled: true,
        requestLogMaxEntries: 1000,
        showIconBadge: true,
        tooltipsDisabled: false,
        webrtcIPAddressHidden: false
    },

    // https://github.com/chrisaljoudi/uBlock/issues/180
    // Whitelist directives need to be loaded once the PSL is available
    netWhitelist: {},
    netWhitelistModifyTime: 0,
    netWhitelistDefault: [
        'about-scheme',
        'behind-the-scene',
        'chrome-extension-scheme',
        'chrome-scheme',
        'loopconversation.about-scheme',
        'opera-scheme',
        'vivaldi-scheme',
        ''
    ].join('\n').trim(),

    localSettings: {
        blockedRequestCount: 0,
        allowedRequestCount: 0
    },
    localSettingsModifyTime: 0,
    localSettingsSaveTime: 0,

    // read-only
    systemSettings: {
        compiledMagic: 'splsmclwnvoj',
        selfieMagic: 'rkzqonintytj'
    },

    restoreBackupSettings: {
        lastRestoreFile: '',
        lastRestoreTime: 0,
        lastBackupFile: '',
        lastBackupTime: 0
    },

    // EasyList, EasyPrivacy and many others have an 4-day update period,
    // as per list headers.
    updateAssetsEvery: 97 * oneHour,
    projectServerRoot: 'https://raw.githubusercontent.com/gorhill/uBlock/master/',
    userFiltersPath: 'assets/user/filters.txt',
    pslPath: 'assets/thirdparties/publicsuffix.org/list/effective_tld_names.dat',

    // permanent lists
    permanentLists: {
        // User
        'assets/user/filters.txt': {
            group: 'default'
        },
        // uBlock
        'assets/ublock/filters.txt': {
            title: 'uBlock filters',
            group: 'default'
        },
        'assets/ublock/privacy.txt': {
            title: 'uBlock filters – Privacy',
            group: 'default'
        },
        'assets/ublock/unbreak.txt': {
            title: 'uBlock filters – Unbreak',
            group: 'default'
        },
        'assets/ublock/badware.txt': {
            title: 'uBlock filters – Badware risks',
            group: 'default',
            supportURL: 'https://github.com/gorhill/uBlock/wiki/Badware-risks',
            instructionURL: 'https://github.com/gorhill/uBlock/wiki/Badware-risks'
        },
        'assets/ublock/experimental.txt': {
            title: 'uBlock filters – Experimental',
            group: 'default',
            off: true,
            supportURL: 'https://github.com/gorhill/uBlock/wiki/Experimental-filters',
            instructionURL: 'https://github.com/gorhill/uBlock/wiki/Experimental-filters'
        }
    },

    // current lists
    remoteBlacklists: {},
    oldListToNewListMap: {
        "assets/thirdparties/adblock.gardar.net/is.abp.txt": "http://adblock.gardar.net/is.abp.txt",
        "assets/thirdparties/adblock.schack.dk/block.txt": "https://adblock.dk/block.csv",
        "https://adblock.schack.dk/block.txt": "https://adblock.dk/block.csv",
        "assets/thirdparties/dl.dropboxusercontent.com/u/1289327/abpxfiles/filtri.txt": "https://dl.dropboxusercontent.com/u/1289327/abpxfiles/filtri.txt",
        "assets/thirdparties/easylist-downloads.adblockplus.org/advblock.txt": "https://easylist-downloads.adblockplus.org/advblock.txt",
        "assets/thirdparties/easylist-downloads.adblockplus.org/bitblock.txt": "https://easylist-downloads.adblockplus.org/bitblock.txt",
        "assets/thirdparties/easylist-downloads.adblockplus.org/easylist_noelemhide.txt": "https://easylist-downloads.adblockplus.org/easylist_noelemhide.txt",
        "assets/thirdparties/easylist-downloads.adblockplus.org/easylistchina.txt": "https://easylist-downloads.adblockplus.org/easylistchina.txt",
        "assets/thirdparties/easylist-downloads.adblockplus.org/easylistdutch.txt": "https://easylist-downloads.adblockplus.org/easylistdutch.txt",
        "assets/thirdparties/easylist-downloads.adblockplus.org/easylistgermany.txt": "https://easylist-downloads.adblockplus.org/easylistgermany.txt",
        "assets/thirdparties/easylist-downloads.adblockplus.org/easylistitaly.txt": "https://easylist-downloads.adblockplus.org/easylistitaly.txt",
        "assets/thirdparties/easylist-downloads.adblockplus.org/fanboy-annoyance.txt": "https://easylist-downloads.adblockplus.org/fanboy-annoyance.txt",
        "assets/thirdparties/easylist-downloads.adblockplus.org/fanboy-social.txt": "https://easylist-downloads.adblockplus.org/fanboy-social.txt",
        "assets/thirdparties/easylist-downloads.adblockplus.org/liste_fr.txt": "https://easylist-downloads.adblockplus.org/liste_fr.txt",
        "assets/thirdparties/gitorious.org/adblock-latvian/adblock-latvian/raw/master_lists/latvian-list.txt": "https://notabug.org/latvian-list/adblock-latvian/raw/master/lists/latvian-list.txt",
        "assets/thirdparties/home.fredfiber.no/langsholt/adblock.txt": "http://home.fredfiber.no/langsholt/adblock.txt",
        "assets/thirdparties/hosts-file.net/ad-servers": "http://hosts-file.net/.%5Cad_servers.txt",
        "assets/thirdparties/http://www.certyficate.it/adblock/adblock.txt": "https://raw.githubusercontent.com/MajkiIT/polish-ads-filter/master/polish-adblock-filters/adblock.txt",
        "assets/thirdparties/liste-ar-adblock.googlecode.com/hg/Liste_AR.txt": "https://liste-ar-adblock.googlecode.com/hg/Liste_AR.txt",
        "assets/thirdparties/margevicius.lt/easylistlithuania.txt": "http://margevicius.lt/easylistlithuania.txt",
        "assets/thirdparties/mirror1.malwaredomains.com/files/immortal_domains.txt": "http://malwaredomains.lehigh.edu/files/immortal_domains.txt",
        "assets/thirdparties/raw.githubusercontent.com/AdBlockPlusIsrael/EasyListHebrew/master/EasyListHebrew.txt": "https://raw.githubusercontent.com/AdBlockPlusIsrael/EasyListHebrew/master/EasyListHebrew.txt",
        "assets/thirdparties/raw.githubusercontent.com/cjx82630/cjxlist/master/cjxlist.txt": "https://raw.githubusercontent.com/cjx82630/cjxlist/master/cjxlist.txt",
        "assets/thirdparties/raw.githubusercontent.com/reek/anti-adblock-killer/master/anti-adblock-killer-filters.txt": "https://raw.githubusercontent.com/reek/anti-adblock-killer/master/anti-adblock-killer-filters.txt",
        "assets/thirdparties/raw.githubusercontent.com/szpeter80/hufilter/master/hufilter.txt": "https://raw.githubusercontent.com/szpeter80/hufilter/master/hufilter.txt",
        "assets/thirdparties/raw.githubusercontent.com/tomasko126/easylistczechandslovak/master/filters.txt": "https://raw.githubusercontent.com/tomasko126/easylistczechandslovak/master/filters.txt",
        "assets/thirdparties/someonewhocares.org/hosts/hosts": "http://someonewhocares.org/hosts/hosts",
        "assets/thirdparties/spam404bl.com/spam404scamlist.txt": "https://spam404bl.com/spam404scamlist.txt",
        "assets/thirdparties/stanev.org/abp/adblock_bg.txt": "http://stanev.org/abp/adblock_bg.txt",
        "assets/thirdparties/winhelp2002.mvps.org/hosts.txt": "http://winhelp2002.mvps.org/hosts.txt",
        "assets/thirdparties/www.fanboy.co.nz/enhancedstats.txt": "https://www.fanboy.co.nz/enhancedstats.txt",
        "assets/thirdparties/www.fanboy.co.nz/fanboy-antifacebook.txt": "https://www.fanboy.co.nz/fanboy-antifacebook.txt",
        "assets/thirdparties/www.fanboy.co.nz/fanboy-korean.txt": "https://www.fanboy.co.nz/fanboy-korean.txt",
        "assets/thirdparties/www.fanboy.co.nz/fanboy-swedish.txt": "https://www.fanboy.co.nz/fanboy-swedish.txt",
        "assets/thirdparties/www.fanboy.co.nz/fanboy-ultimate.txt": "https://www.fanboy.co.nz/r/fanboy-ultimate.txt",
        "assets/thirdparties/www.fanboy.co.nz/fanboy-vietnam.txt": "https://www.fanboy.co.nz/fanboy-vietnam.txt",
        "assets/thirdparties/www.void.gr/kargig/void-gr-filters.txt": "https://www.void.gr/kargig/void-gr-filters.txt",
        "assets/thirdparties/www.zoso.ro/pages/rolist.txt": "",
        "https://iadb.azurewebsites.net/Finland_adb.txt": "http://adb.juvander.net/Finland_adb.txt",
        "https://www.certyficate.it/adblock/adblock.txt": "https://raw.githubusercontent.com/MajkiIT/polish-ads-filter/master/polish-adblock-filters/adblock.txt",
        "https://raw.githubusercontent.com/heradhis/indonesianadblockrules/master/subscriptions/abpindo.txt": "https://raw.githubusercontent.com/ABPindo/indonesianadblockrules/master/subscriptions/abpindo.txt"
    },

    selfieAfter: 23 * oneMinute,

    pageStores: {},
    pageStoresToken: 0,

    storageQuota: vAPI.storage.QUOTA_BYTES,
    storageUsed: 0,

    noopFunc: function(){},

    apiErrorCount: 0,
    mouseX: -1,
    mouseY: -1,
    mouseURL: '',
    epickerTarget: '',
    epickerEprom: null,

    scriptlets: {
    },

    // so that I don't have to care for last comma
    dummy: 0
};

/******************************************************************************/

})();

/******************************************************************************/

