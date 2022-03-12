/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2017-present Raymond Hill

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

import µb from './background.js';
import { hostnameFromURI } from './uri-utils.js';

/******************************************************************************/

µb.canUseShortcuts = vAPI.commands instanceof Object;

// https://github.com/uBlockOrigin/uBlock-issues/issues/386
//   Firefox 74 and above has complete shortcut assignment user interface.
µb.canUpdateShortcuts = false;

if (
    µb.canUseShortcuts &&
    vAPI.webextFlavor.soup.has('firefox') &&
    typeof vAPI.commands.update === 'function'
) {
    self.addEventListener(
        'webextFlavor',
        ( ) => {
            µb.canUpdateShortcuts = vAPI.webextFlavor.major < 74;
            if ( µb.canUpdateShortcuts === false ) { return; }
            vAPI.storage.get('commandShortcuts').then(bin => {
                if ( bin instanceof Object === false ) { return; }
                const shortcuts = bin.commandShortcuts;
                if ( Array.isArray(shortcuts) === false ) { return; }
                µb.commandShortcuts = new Map(shortcuts);
                for ( const [ name, shortcut ] of shortcuts ) {
                    vAPI.commands.update({ name, shortcut });
                }
            });
        },
        { once: true }
    );
}

/******************************************************************************/

(( ) => {

// *****************************************************************************
// start of local namespace

if ( µb.canUseShortcuts === false ) { return; }

const relaxBlockingMode = (( ) => {
    const reloadTimers = new Map();

    return function(tab) {
        if ( tab instanceof Object === false || tab.id <= 0 ) { return; }

        const normalURL = µb.normalizeTabURL(tab.id, tab.url);

        if ( µb.getNetFilteringSwitch(normalURL) === false ) { return; }

        const hn = hostnameFromURI(normalURL);
        const curProfileBits = µb.blockingModeFromHostname(hn);
        let newProfileBits;
        for ( const profile of µb.liveBlockingProfiles ) {
            if ( (curProfileBits & profile.bits & ~1) !== curProfileBits ) {
                newProfileBits = profile.bits;
                break;
            }
        }

        // TODO: Reset to original blocking profile?
        if ( newProfileBits === undefined ) { return; }

        const noReload = (newProfileBits & 0b00000001) === 0;

        if (
            (curProfileBits & 0b00000010) !== 0 &&
            (newProfileBits & 0b00000010) === 0
        ) {
            µb.toggleHostnameSwitch({
                name: 'no-scripting',
                hostname: hn,
                state: false,
            });
        }
        if ( µb.userSettings.advancedUserEnabled ) {
            if (
                (curProfileBits & 0b00000100) !== 0 &&
                (newProfileBits & 0b00000100) === 0
            ) {
                µb.toggleFirewallRule({
                    tabId: noReload ? tab.id : undefined,
                    srcHostname: hn,
                    desHostname: '*',
                    requestType: '3p',
                    action: 3,
                });
            }
            if (
                (curProfileBits & 0b00001000) !== 0 &&
                (newProfileBits & 0b00001000) === 0
            ) {
                µb.toggleFirewallRule({
                    srcHostname: hn,
                    desHostname: '*',
                    requestType: '3p-script',
                    action: 3,
                });
            }
            if (
                (curProfileBits & 0b00010000) !== 0 &&
                (newProfileBits & 0b00010000) === 0
            ) {
                µb.toggleFirewallRule({
                    srcHostname: hn,
                    desHostname: '*',
                    requestType: '3p-frame',
                    action: 3,
                });
            }
        }

        // Reload the target tab?
        if ( noReload ) { return; }

        // Reload: use a timer to coalesce bursts of reload commands.
        let timer = reloadTimers.get(tab.id);
        if ( timer !== undefined ) {
            clearTimeout(timer);
        }
        timer = vAPI.setTimeout(
            tabId => {
                reloadTimers.delete(tabId);
                vAPI.tabs.reload(tabId);
            },
            547,
            tab.id
        );
        reloadTimers.set(tab.id, timer);
    };
})();

vAPI.commands.onCommand.addListener(async command => {
    // Generic commands
    if ( command === 'open-dashboard' ) {
        µb.openNewTab({
            url: 'dashboard.html',
            select: true,
            index: -1,
        });
        return;
    }
    // Tab-specific commands
    const tab = await vAPI.tabs.getCurrent();
    if ( tab instanceof Object === false ) { return; }
    switch ( command ) {
    case 'launch-element-picker':
    case 'launch-element-zapper': {
        µb.epickerArgs.mouse = false;
        µb.elementPickerExec(
            tab.id,
            0,
            undefined,
            command === 'launch-element-zapper'
        );
        break;
    }
    case 'launch-logger': {
        const hash = tab.url.startsWith(vAPI.getURL(''))
            ? ''
            : `#_+${tab.id}`;
        µb.openNewTab({
            url: `logger-ui.html${hash}`,
            select: true,
            index: -1,
        });
        break;
    }
    case 'relax-blocking-mode':
        relaxBlockingMode(tab);
        break;
    case 'toggle-cosmetic-filtering':
        µb.toggleHostnameSwitch({
            name: 'no-cosmetic-filtering',
            hostname: hostnameFromURI(µb.normalizeTabURL(tab.id, tab.url)),
        });
        break;
    default:
        break;
    }
});

// end of local namespace
// *****************************************************************************

})();

/******************************************************************************/
