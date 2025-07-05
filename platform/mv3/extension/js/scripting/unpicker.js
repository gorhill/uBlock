/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2025-present Raymond Hill

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

(async ( ) => {

/******************************************************************************/

const ubolOverlay = self.ubolOverlay;
if ( ubolOverlay === undefined ) { return; }

const unpicker = self.ubolUnpicker = self.ubolUnpicker || {};
if ( unpicker.injected ) { return; }
unpicker.injected = true;

const docURL = new URL(document.baseURI);

/******************************************************************************/

function startPicker() {
    ubolOverlay.start();
}

function quitPicker() {
    ubolOverlay.stop();
    unpicker.injected = false;
}

/******************************************************************************/

function onMessage(msg) {
    switch ( msg.what ) {
    case 'startTool':
        startPicker();
        break;
    case 'quitTool':
        quitPicker();
        break;
    case 'highlightFromSelector': {
        const { elems, error } = ubolOverlay.elementsFromSelector(msg.selector);
        ubolOverlay.highlightElements(elems);
        ubolOverlay.postMessage({
            what: 'countFromSelector',
            count: elems.length,
            error,
        });
        break;
    }
    case 'injectCustomFilters':
        ubolOverlay.sendMessage({ what: 'injectCustomFilters',
            hostname: docURL.hostname,
        });
        break;
    case 'uninjectCustomFilters':
        ubolOverlay.sendMessage({ what: 'uninjectCustomFilters',
            hostname: docURL.hostname,
        });
        break;
    case 'removeCustomFilter':
        ubolOverlay.sendMessage({ what: 'removeCustomFilter',
            hostname: docURL.hostname,
            selector: msg.selector,
        });
        break;
    default:
        break;
    }
}

/******************************************************************************/

const success = await ubolOverlay.install('/unpicker-ui.html', onMessage);
if ( success !== true ) {
    quitPicker();
}

/******************************************************************************/

})();


void 0;
