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
    const params = new URL(document.location).searchParams;
    const assetKey = params.get('url');
    if ( assetKey === null ) { return; }

    const cmEditor = new CodeMirror(
        document.getElementById('content'),
        {
            autofocus: true,
            lineNumbers: true,
            lineWrapping: true,
            readOnly: true,
            styleActiveLine: true,
        }
    );

    uBlockDashboard.patchCodeMirrorEditor(cmEditor);

    const details = await vAPI.messaging.send('default', {
        what : 'getAssetContent',
        url: assetKey,
    });
    cmEditor.setValue(details && details.content || '');
    if ( details.sourceURL ) {
        const a = document.querySelector('.cm-search-widget .sourceURL');
        a.setAttribute('href', details.sourceURL);
        a.setAttribute('title', details.sourceURL);
    }
})();
