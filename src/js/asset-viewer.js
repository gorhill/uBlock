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

(function() {

    let params = new URL(document.location).searchParams;
    let assetKey = params.get('url');
    if ( assetKey === null ) { return; }

    vAPI.messaging.send(
        'default',
        {
            what : 'getAssetContent',
            url: assetKey
        },
        details => {
            cmEditor.setValue(details && details.content || '');
        }
    );

    let cmEditor = new CodeMirror(
        document.getElementById('content'),
        {
            autofocus: true,
            lineNumbers: true,
            lineWrapping: true,
            readOnly: true,
            styleActiveLine: true
        }
    );

    uBlockDashboard.patchCodeMirrorEditor(cmEditor);
})();
