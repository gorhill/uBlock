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

(function() {
    if ( µBlock.canUseShortcuts === false ) { return; }

    vAPI.commands.onCommand.addListener(function(command) {
        var µb = µBlock;

        switch ( command ) {
        case 'launch-element-zapper':
        case 'launch-element-picker':
            vAPI.tabs.get(null, function(tab) {
                if ( tab instanceof Object === false ) { return; }
                µb.mouseEventRegister.x = µb.mouseEventRegister.y = -1;
                µb.elementPickerExec(tab.id, undefined, command === 'launch-element-zapper');
            });
            break;
        case 'launch-logger':
            vAPI.tabs.get(null, function(tab) {
                let hash = tab.url.startsWith(vAPI.getURL('')) ?
                    '' :
                    '#tab_active+' + tab.id;
                µb.openNewTab({
                    url: 'logger-ui.html' + hash,
                    select: true,
                    index: -1
                });
            });
            break;
        default:
            break;
        }
    });
})();

/******************************************************************************/
