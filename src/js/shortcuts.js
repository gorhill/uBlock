/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2018-present Raymond Hill

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

(function() {

    // https://developer.mozilla.org/en-US/Add-ons/WebExtensions/manifest.json/commands#Shortcut_values
    let validStatus0Keys = new Map([
        [ 'alt', 'Alt' ],
        [ 'control', 'Ctrl' ],
    ]);
    let validStatus1Keys = new Map([
        [ 'a', 'A' ],
        [ 'b', 'B' ],
        [ 'c', 'C' ],
        [ 'd', 'D' ],
        [ 'e', 'E' ],
        [ 'f', 'F' ],
        [ 'g', 'G' ],
        [ 'h', 'H' ],
        [ 'i', 'I' ],
        [ 'j', 'J' ],
        [ 'k', 'K' ],
        [ 'l', 'L' ],
        [ 'm', 'M' ],
        [ 'n', 'N' ],
        [ 'o', 'O' ],
        [ 'p', 'P' ],
        [ 'q', 'Q' ],
        [ 'r', 'R' ],
        [ 's', 'S' ],
        [ 't', 'T' ],
        [ 'u', 'U' ],
        [ 'v', 'V' ],
        [ 'w', 'W' ],
        [ 'x', 'X' ],
        [ 'y', 'Y' ],
        [ 'z', 'Z' ],
        [ '0', '0' ],
        [ '1', '1' ],
        [ '2', '2' ],
        [ '3', '3' ],
        [ '4', '4' ],
        [ '5', '5' ],
        [ '6', '6' ],
        [ '7', '7' ],
        [ '8', '8' ],
        [ '9', '9' ],
        [ 'f1', 'F1' ],
        [ 'f2', 'F2' ],
        [ 'f3', 'F3' ],
        [ 'f4', 'F4' ],
        [ 'f5', 'F5' ],
        [ 'f6', 'F6' ],
        [ 'f7', 'F7' ],
        [ 'f8', 'F8' ],
        [ 'f9', 'F9' ],
        [ 'f10', 'F10' ],
        [ 'f11', 'F11' ],
        [ 'f12', 'F12' ],
        [ ' ', 'Space' ],
        [ ',', 'Comma' ],
        [ '.', 'Period' ],
        [ 'home', 'Home' ],
        [ 'end', 'End' ],
        [ 'pageup', 'PageUp' ],
        [ 'pagedown', 'PageDown' ],
        [ 'insert', 'Insert' ],
        [ 'delete', 'Delete' ],
        [ 'arrowup', 'Up' ],
        [ 'arrowdown', 'Down' ],
        [ 'arrowleft', 'Left' ],
        [ 'arrowright', 'Right' ],
        [ 'shift', 'Shift' ],
    ]);

    let commandNameFromElement = function(elem) {
        while ( elem !== null ) {
            let name = elem.getAttribute('data-name');
            if ( typeof name === 'string' && name !== '' ) { return name; }
            elem = elem.parentElement;
        }
    };

    let captureShortcut = function(ev) {
        let input = ev.target;
        let name = commandNameFromElement(input);
        if ( name === undefined ) { return; }

        let before = input.value;
        let after = new Set();
        let status = 0;

        let updateCapturedShortcut = function() {
            return (input.value = Array.from(after).join('+'));
        };

        let blurHandler = function() {
            input.removeEventListener('blur', blurHandler, true);
            input.removeEventListener('keydown', keydownHandler, true);
            input.removeEventListener('keyup', keyupHandler, true);
            if ( status === 2 ) {
                vAPI.messaging.send(
                    'dashboard',
                    { what: 'setShortcut', name: name, shortcut: updateCapturedShortcut() }
                );
            } else {
                input.value = before;
            }
        };

        let keydownHandler = function(ev) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            if ( ev.code === 'Escape' ) {
                input.blur();
                return;
            }
            if ( status === 0 ) {
                let keyName = validStatus0Keys.get(ev.key.toLowerCase());
                if ( keyName !== undefined ) {
                    after.add(keyName);
                    updateCapturedShortcut();
                    status = 1;
                }
                return;
            }
            if ( status === 1 ) {
                if ( ev.key === 'Shift' ) {
                    after.add('Shift');
                    updateCapturedShortcut();
                    return;
                }
                let keyName = validStatus1Keys.get(ev.key.toLowerCase());
                if ( keyName !== undefined ) {
                    after.add(keyName);
                    updateCapturedShortcut();
                    status = 2;
                    input.blur();
                    return;
                }
            }
        };

        let keyupHandler = function(ev) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            if ( status !== 1 ) { return; }
            let keyName = validStatus0Keys.get(ev.key.toLowerCase());
            if ( keyName !== undefined && after.has(keyName) ) {
                after.clear();
                updateCapturedShortcut();
                status = 0;
                return;
            }
            if ( ev.key === 'Shift' ) {
                after.delete('Shift');
                updateCapturedShortcut();
                return;
            }
        };

        input.value = '';
        input.addEventListener('blur', blurHandler, true);
        input.addEventListener('keydown', keydownHandler, true);
        input.addEventListener('keyup', keyupHandler, true);
    };

    let resetShortcut = function(ev) {
        let name = commandNameFromElement(ev.target);
        if ( name === undefined ) { return; }

        let input = document.querySelector('[data-name="' + name + '"] input');
        if ( input === null ) { return; }
        input.value = '';
        vAPI.messaging.send(
            'dashboard',
            { what: 'setShortcut', name: name }
        );
    };

    let onShortcutsReady = function(commands) {
        if ( Array.isArray(commands) === false ) { return; }
        let template = document.querySelector('#templates .commandEntry');
        let tbody = document.querySelector('.commandEntries tbody');
        for ( let command of commands ) {
            if ( command.description === '' ) { continue; }
            let tr = template.cloneNode(true);
            tr.setAttribute('data-name', command.name);
            tr.querySelector('.commandDesc').textContent = command.description;
            let input = tr.querySelector('.commandShortcut input');
            input.setAttribute('data-name', command.name);
            input.value = command.shortcut;
            input.addEventListener('focus', captureShortcut);
            tr.querySelector('.commandReset').addEventListener('click', resetShortcut);
            tbody.appendChild(tr);
        }
    };

    vAPI.messaging.send('dashboard', { what: 'getShortcuts' }, onShortcutsReady);

})();
