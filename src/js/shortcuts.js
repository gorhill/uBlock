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
    let validStatus0Codes = new Map([
        [ 'AltLeft', 'Alt' ],
        [ 'ControlLeft', 'Ctrl' ],
        [ 'ControlRight', 'Ctrl' ],
    ]);
    let validStatus1Codes = new Map([
        [ 'KeyA', 'A' ],
        [ 'KeyB', 'B' ],
        [ 'KeyC', 'C' ],
        [ 'KeyD', 'D' ],
        [ 'KeyE', 'E' ],
        [ 'KeyF', 'F' ],
        [ 'KeyG', 'G' ],
        [ 'KeyH', 'H' ],
        [ 'KeyI', 'I' ],
        [ 'KeyJ', 'J' ],
        [ 'KeyK', 'K' ],
        [ 'KeyL', 'L' ],
        [ 'KeyM', 'M' ],
        [ 'KeyN', 'N' ],
        [ 'KeyO', 'O' ],
        [ 'KeyP', 'P' ],
        [ 'KeyQ', 'Q' ],
        [ 'KeyR', 'R' ],
        [ 'KeyS', 'S' ],
        [ 'KeyT', 'T' ],
        [ 'KeyU', 'U' ],
        [ 'KeyV', 'V' ],
        [ 'KeyW', 'W' ],
        [ 'KeyX', 'X' ],
        [ 'KeyY', 'Y' ],
        [ 'KeyZ', 'Z' ],
        [ 'Digit0', '0' ],
        [ 'Digit1', '1' ],
        [ 'Digit2', '2' ],
        [ 'Digit3', '3' ],
        [ 'Digit4', '4' ],
        [ 'Digit5', '5' ],
        [ 'Digit6', '6' ],
        [ 'Digit7', '7' ],
        [ 'Digit8', '8' ],
        [ 'Digit9', '9' ],
        [ 'F1', 'F1' ],
        [ 'F2', 'F2' ],
        [ 'F3', 'F3' ],
        [ 'F4', 'F4' ],
        [ 'F5', 'F5' ],
        [ 'F6', 'F6' ],
        [ 'F7', 'F7' ],
        [ 'F8', 'F8' ],
        [ 'F9', 'F9' ],
        [ 'F10', 'F10' ],
        [ 'F11', 'F11' ],
        [ 'F12', 'F12' ],
        [ 'Comma', 'Comma' ],
        [ 'Period', 'Period' ],
        [ 'Home', 'Home' ],
        [ 'End', 'End' ],
        [ 'PageUp', 'PageUp' ],
        [ 'PageDown', 'PageDown' ],
        [ 'Space', 'Space' ],
        [ 'Insert', 'Insert' ],
        [ 'Delete', 'Delete' ],
        [ 'ArrowUp', 'Up' ],
        [ 'ArrowDown', 'Down' ],
        [ 'ArrowLeft', 'Left' ],
        [ 'ArrowRight', 'Right' ],
        [ 'ShiftLeft', 'Shift' ],
        [ 'ShiftRight', 'Shift' ],
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
                let key = validStatus0Codes.get(ev.code);
                if ( key !== undefined ) {
                    after.add(key);
                    updateCapturedShortcut();
                    status = 1;
                }
                return;
            }
            if ( status === 1 ) {
                let key = validStatus1Codes.get(ev.code);
                if ( key === 'Shift' ) {
                    after.add('Shift');
                    updateCapturedShortcut();
                    return;
                }
                if ( key !== undefined ) {
                    after.add(key);
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
            let key = validStatus0Codes.get(ev.code);
            if ( key !== undefined && after.has(key) ) {
                after.clear();
                updateCapturedShortcut();
                status = 0;
                return;
            }
            key = validStatus1Codes.get(ev.code);
            if ( key === 'Shift' ) {
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
