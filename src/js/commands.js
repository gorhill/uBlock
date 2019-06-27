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

/******************************************************************************/

'use strict';

/******************************************************************************/

µBlock.canUseShortcuts = vAPI.commands instanceof Object;
µBlock.canUpdateShortcuts = µBlock.canUseShortcuts &&
                            typeof vAPI.commands.update === 'function';

/******************************************************************************/

(( ) => {

// *****************************************************************************
// start of local namespace

if ( µBlock.canUseShortcuts === false ) { return; }

const relaxBlockingMode = function(tab) {
    if (
        tab instanceof Object === false ||
        tab.id <= 0
    ) {
        return;
    }

    const µb = µBlock;
    const normalURL = µb.normalizePageURL(tab.id, tab.url);

    if ( µb.getNetFilteringSwitch(normalURL) === false ) { return; }

    const hn = µb.URI.hostnameFromURI(normalURL);

    // Construct current blocking profile
    const ssw = µb.sessionSwitches;
    const sfw = µb.sessionFirewall;
    let currentProfile = 0;

    if ( ssw.evaluateZ('no-scripting', hn) ) {
        currentProfile |= 0b00000010;
    }
    if ( µb.userSettings.advancedUserEnabled ) {
        if ( sfw.evaluateCellZY(hn, '*', '3p') === 1 ) {
            currentProfile |= 0b00000100;
        }
        if ( sfw.evaluateCellZY(hn, '*', '3p-script') === 1 ) {
            currentProfile |= 0b00001000;
        }
        if ( sfw.evaluateCellZY(hn, '*', '3p-frame') === 1 ) {
            currentProfile |= 0b00010000;
        }
    }

    const profiles = [];
    for ( const s of µb.hiddenSettings.blockingProfiles.split(/\s+/) ) {
        const v = parseInt(s, 2);
        if ( isNaN(v) ) { continue; }
        profiles.push(v);
    }
    let newProfile;
    for ( const profile of profiles ) {
        if ( (currentProfile & profile & 0b11111110) !== currentProfile ) {
            newProfile = profile;
            break;
        }
    }

    // TODO: Reset to original blocking profile?
    if ( newProfile === undefined ) { return; }

    if (
        (currentProfile & 0b00000010) !== 0 &&
        (newProfile & 0b00000010) === 0
    ) {
        µb.toggleHostnameSwitch({
            name: 'no-scripting',
            hostname: hn,
            state: false,
        });
    }
    if ( µb.userSettings.advancedUserEnabled ) {
        if (
            (currentProfile & 0b00000100) !== 0 &&
            (newProfile & 0b00000100) === 0
        ) {
            µb.toggleFirewallRule({
                srcHostname: hn,
                desHostname: '*',
                requestType: '3p',
                action: 3,
            });
        }
        if (
            (currentProfile & 0b00001000) !== 0 &&
            (newProfile & 0b00001000) === 0
        ) {
            µb.toggleFirewallRule({
                srcHostname: hn,
                desHostname: '*',
                requestType: '3p-script',
                action: 3,
            });
        }
        if (
            (currentProfile & 0b00010000) !== 0 &&
            (newProfile & 0b00010000) === 0
        ) {
            µb.toggleFirewallRule({
                srcHostname: hn,
                desHostname: '*',
                requestType: '3p-frame',
                action: 3,
            });
        }
    }

    if ( newProfile & 0b00000001 ) {
        vAPI.tabs.reload(tab.id);
    }
};

vAPI.commands.onCommand.addListener(command => {
    const µb = µBlock;

    switch ( command ) {
    case 'launch-element-picker':
    case 'launch-element-zapper':
        vAPI.tabs.get(null, tab => {
            if ( tab instanceof Object === false ) { return; }
            µb.mouseEventRegister.x = µb.mouseEventRegister.y = -1;
            µb.elementPickerExec(
                tab.id,
                undefined,
                command === 'launch-element-zapper'
            );
        });
        break;
    case 'launch-logger':
        vAPI.tabs.get(null, tab => {
            const hash = tab.url.startsWith(vAPI.getURL(''))
                ? ''
                : `#_+${tab.id}`;
            µb.openNewTab({
                url: `logger-ui.html${hash}`,
                select: true,
                index: -1
            });
        });
        break;
    case 'relax-blocking-mode':
        vAPI.tabs.get(null, relaxBlockingMode);
        break;
    default:
        break;
    }
});

// end of local namespace
// *****************************************************************************

})();

/******************************************************************************/
