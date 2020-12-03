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

/* global CodeMirror, uBlockDashboard */

'use strict';

/******************************************************************************/

(async ( ) => {
    const subscribeURL = new URL(document.location);
    const subscribeParams = subscribeURL.searchParams;
    const assetKey = subscribeParams.get('url');
    if ( assetKey === null ) { return; }

    const subscribeElem = subscribeParams.get('subscribe') !== null
        ? document.getElementById('subscribe')
        : null;
    if ( subscribeElem !== null && subscribeURL.hash !== '#subscribed' ) {
        const title = subscribeParams.get('title');
        const promptElem = document.getElementById('subscribePrompt');
        promptElem.children[0].textContent = title;
        const a = promptElem.children[1];
        a.textContent = assetKey;
        a.setAttribute('href', assetKey);
        subscribeElem.classList.remove('hide');
    }

    const cmEditor = new CodeMirror(document.getElementById('content'), {
        autofocus: true,
        foldGutter: true,
        gutters: [ 'CodeMirror-linenumbers', 'CodeMirror-foldgutter' ],
        lineNumbers: true,
        lineWrapping: true,
        matchBrackets: true,
        maxScanLines: 1,
        readOnly: true,
        styleActiveLine: {
            nonEmpty: true,
        },
    });

    uBlockDashboard.patchCodeMirrorEditor(cmEditor);

    const hints = await vAPI.messaging.send('dashboard', {
        what: 'getAutoCompleteDetails'
    });
    if ( hints instanceof Object ) {
        const mode = cmEditor.getMode();
        if ( mode.setHints instanceof Function ) {
            mode.setHints(hints);
        }
    }

    const details = await vAPI.messaging.send('default', {
        what : 'getAssetContent',
        url: assetKey,
    });
    cmEditor.setValue(details && details.content || '');

    if ( subscribeElem !== null ) {
        document.getElementById('subscribeButton').addEventListener(
            'click',
            ( ) => {
                subscribeElem.classList.add('hide');
                vAPI.messaging.send('scriptlets', {
                    what: 'applyFilterListSelection',
                    toImport: assetKey,
                }).then(( ) => {
                    vAPI.messaging.send('scriptlets', {
                        what: 'reloadAllFilters'
                    });
                });
            },
            { once: true }
        );
    }

    if ( details.sourceURL ) {
        const a = document.querySelector('.cm-search-widget .sourceURL');
        a.setAttribute('href', details.sourceURL);
        a.setAttribute('title', details.sourceURL);
    }

    document.body.classList.remove('loading');
})();
