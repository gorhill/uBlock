/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2018 Raymond Hill

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

/* global CodeMirror, uDom, uBlockDashboard */

'use strict';

/******************************************************************************/

(( ) => {

/******************************************************************************/

const reComment = /^\s*#\s*/;

const directiveFromLine = function(line) {
    const match = reComment.exec(line);
    return match === null
        ? line.trim()
        : line.slice(match.index + match[0].length).trim();
};

/******************************************************************************/

CodeMirror.defineMode("ubo-whitelist-directives", function() {
    const reRegex = /^\/.+\/$/;

    return {
        token: function(stream) {
            const line = stream.string.trim();
            stream.skipToEnd();
            if ( reBadHostname === undefined ) {
                return null;
            }
            if ( reComment.test(line) ) {
                return whitelistDefaultSet.has(directiveFromLine(line))
                    ? 'builtin comment'
                    : 'comment';
            }
            if ( line.indexOf('/') === -1 ) {
                if ( reBadHostname.test(line) ) { return 'error'; }
                if ( whitelistDefaultSet.has(line.trim()) ) {
                    return 'builtin';
                }
                return null;
            }
            if ( reRegex.test(line) ) {
                try {
                    new RegExp(line.slice(1, -1));
                } catch(ex) {
                    return 'error';
                }
                return null;
            }
            return reHostnameExtractor.test(line) ? null : 'error';
        }
    };
});

let reBadHostname;
let reHostnameExtractor;
let whitelistDefaultSet = new Set();

/******************************************************************************/

const messaging = vAPI.messaging;
const noopFunc = function(){};

let cachedWhitelist = '';

const cmEditor = new CodeMirror(
    document.getElementById('whitelist'),
    {
        autofocus: true,
        lineNumbers: true,
        lineWrapping: true,
        styleActiveLine: true
    }
);

uBlockDashboard.patchCodeMirrorEditor(cmEditor);

/******************************************************************************/

const whitelistChanged = function() {
    const whitelistElem = uDom.nodeFromId('whitelist');
    const bad = whitelistElem.querySelector('.cm-error') !== null;
    const changedWhitelist = cmEditor.getValue().trim();
    const changed = changedWhitelist !== cachedWhitelist;
    uDom.nodeFromId('whitelistApply').disabled = !changed || bad;
    uDom.nodeFromId('whitelistRevert').disabled = !changed;
    CodeMirror.commands.save = changed && !bad ? applyChanges : noopFunc;
};

cmEditor.on('changes', whitelistChanged);

/******************************************************************************/

const renderWhitelist = async function() {
    const details = await messaging.send('dashboard', {
        what: 'getWhitelist',
    });

    const first = reBadHostname === undefined;
    if ( first ) {
        reBadHostname = new RegExp(details.reBadHostname);
        reHostnameExtractor = new RegExp(details.reHostnameExtractor);
        whitelistDefaultSet = new Set(details.whitelistDefault);
    }
    const toAdd = new Set(whitelistDefaultSet);
    for ( const line of details.whitelist ) {
        const directive = directiveFromLine(line);
        if ( whitelistDefaultSet.has(directive) === false ) { continue; }
        toAdd.delete(directive);
        if ( toAdd.size === 0 ) { break; }
    }
    if ( toAdd.size !== 0 ) {
        details.whitelist.push(...Array.from(toAdd).map(a => `# ${a}`));
    }
    details.whitelist.sort((a, b) => {
        const ad = directiveFromLine(a);
        const bd = directiveFromLine(b);
        const abuiltin = whitelistDefaultSet.has(ad);
        if ( abuiltin !== whitelistDefaultSet.has(bd) ) {
            return abuiltin ? -1 : 1;
        }
        return ad.localeCompare(bd);
    });
    let whitelistStr = details.whitelist.join('\n').trim();
    cachedWhitelist = whitelistStr;
    if ( whitelistStr !== '' ) {
        whitelistStr += '\n';
    }
    cmEditor.setValue(whitelistStr);
    if ( first ) {
        cmEditor.clearHistory();
    }
};

/******************************************************************************/

const handleImportFilePicker = function() {
    const file = this.files[0];
    if ( file === undefined || file.name === '' ) { return; }
    if ( file.type.indexOf('text') !== 0 ) { return; }
    const fr = new FileReader();
    fr.onload = ev => {
        if ( ev.type !== 'load' ) { return; }
        cmEditor.setValue(
            [
                cmEditor.getValue().trim(),
                fr.result.trim()
            ].join('\n').trim()
        );
    };
    fr.readAsText(file);
};

/******************************************************************************/

const startImportFilePicker = function() {
    const input = document.getElementById('importFilePicker');
    // Reset to empty string, this will ensure an change event is properly
    // triggered if the user pick a file, even if it is the same as the last
    // one picked.
    input.value = '';
    input.click();
};

/******************************************************************************/

const exportWhitelistToFile = function() {
    const val = cmEditor.getValue().trim();
    if ( val === '' ) { return; }
    const filename =
        vAPI.i18n('whitelistExportFilename')
            .replace('{{datetime}}', uBlockDashboard.dateNowToSensibleString())
            .replace(/ +/g, '_');
    vAPI.download({
        'url': `data:text/plain;charset=utf-8,${encodeURIComponent(val + '\n')}`,
        'filename': filename
    });
};

/******************************************************************************/

const applyChanges = async function() {
    cachedWhitelist = cmEditor.getValue().trim();
    await messaging.send('dashboard', {
        what: 'setWhitelist',
        whitelist: cachedWhitelist,
    });
    renderWhitelist();
};

const revertChanges = function() {
    let content = cachedWhitelist;
    if ( content !== '' ) { content += '\n'; }
    cmEditor.setValue(content);
};

/******************************************************************************/

const getCloudData = function() {
    return cmEditor.getValue();
};

const setCloudData = function(data, append) {
    if ( typeof data !== 'string' ) { return; }
    if ( append ) {
        data = uBlockDashboard.mergeNewLines(cmEditor.getValue().trim(), data);
    }
    cmEditor.setValue(data.trim() + '\n');
};

self.cloud.onPush = getCloudData;
self.cloud.onPull = setCloudData;

/******************************************************************************/

self.hasUnsavedData = function() {
    return cmEditor.getValue().trim() !== cachedWhitelist;
};

/******************************************************************************/

uDom('#importWhitelistFromFile').on('click', startImportFilePicker);
uDom('#importFilePicker').on('change', handleImportFilePicker);
uDom('#exportWhitelistToFile').on('click', exportWhitelistToFile);
uDom('#whitelistApply').on('click', ( ) => { applyChanges(); });
uDom('#whitelistRevert').on('click', revertChanges);

renderWhitelist();

/******************************************************************************/

})();
