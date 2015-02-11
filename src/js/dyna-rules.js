/*******************************************************************************

    µMatrix - a Chromium browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

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

    Home: https://github.com/gorhill/uMatrix
*/

/* global vAPI, uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var messager = vAPI.messaging.channel('dyna-rules.js');

/******************************************************************************/

var renderRules = function(details) {
    var rules, rule, i;
    var permanentList = [];
    var sessionList = [];
    var allRules = {};
    var permanentRules = {};
    var sessionRules = {};
    var onLeft, onRight;

    rules = details.sessionRules.split(/\n+/);
    i = rules.length;
    while ( i-- ) {
        rule = rules[i].trim();
        if ( rule === '' ) {
            continue;
        }
        sessionRules[rule] = allRules[rule] = true;
    }
    details.sessionRules = rules.sort().join('\n');

    rules = details.permanentRules.split(/\n+/);
    i = rules.length;
    while ( i-- ) {
        rule = rules[i].trim();
        if ( rule === '' ) {
            continue;
        }
        permanentRules[rule] = allRules[rule] = true;
    }
    details.permanentRules = rules.sort().join('\n');

    rules = Object.keys(allRules).sort();
    for ( i = 0; i < rules.length; i++ ) {
        rule = rules[i];
        onLeft = permanentRules.hasOwnProperty(rule);
        onRight = sessionRules.hasOwnProperty(rule);
        if ( onLeft && onRight ) {
            permanentList.push('<li>', rule);
            sessionList.push('<li>', rule);
        } else if ( onLeft ) {
            permanentList.push('<li>', rule);
            sessionList.push('<li class="notRight toRemove">', rule);
        } else {
            permanentList.push('<li>&nbsp;');
            sessionList.push('<li class="notLeft">', rule);
        }
    }

    uDom('#diff > .left ul > li').remove();
    uDom('#diff > .left ul').html(permanentList.join(''));
    uDom('#diff > .right ul > li').remove();
    uDom('#diff > .right ul').html(sessionList.join(''));
    uDom('#diff').toggleClass('dirty', details.sessionRules !== details.permanentRules);
};

/******************************************************************************/

function handleImportFilePicker() {
    var fileReaderOnLoadHandler = function() {
        if ( typeof this.result !== 'string' || this.result === '' ) {
            return;
        }
        // https://github.com/gorhill/uBlock/issues/757
        // Support RequestPolicy rule syntax
        var result = this.result;
        var matches = /\[origins-to-destinations\]([^\[]+)/.exec(result);
        if ( matches && matches.length === 2 ) {
            result = matches[1].trim()
                               .replace(/\|/g, ' ')
                               .replace(/\n/g, ' * noop\n');
        }
        var request = {
            'what': 'setSessionFirewallRules',
            'rules': rulesFromHTML('#diff .right li') + '\n' + result
        };
        messager.send(request, renderRules);
    };
    var file = this.files[0];
    if ( file === undefined || file.name === '' ) {
        return;
    }
    if ( file.type.indexOf('text') !== 0 ) {
        return;
    }
    var fr = new FileReader();
    fr.onload = fileReaderOnLoadHandler;
    fr.readAsText(file);
}

/******************************************************************************/

var startImportFilePicker = function() {
    var input = document.getElementById('importFilePicker');
    // Reset to empty string, this will ensure an change event is properly
    // triggered if the user pick a file, even if it is the same as the last
    // one picked.
    input.value = '';
    input.click();
};

/******************************************************************************/

function exportUserRulesToFile() {
    var now = new Date();
    var filename = vAPI.i18n('rulesDefaultFileName')
        .replace('{{datetime}}', now.toLocaleString())
        .replace(/ +/g, '_');
    vAPI.download({
        'url': 'data:text/plain,' + encodeURIComponent(rulesFromHTML('#diff .left li')),
        'filename': filename,
        'saveAs': true
    });
}

/******************************************************************************/

var rulesFromHTML = function(selector) {
    var rules = [];
    var lis = uDom(selector);
    var li;
    for ( var i = 0; i < lis.length; i++ ) {
        li = lis.at(i);
        if ( li.hasClassName('toRemove') ) {
            rules.push('');
        } else {
            rules.push(li.text());
        }
    }
    return rules.join('\n');
};

/******************************************************************************/

var revertHandler = function() {
    var request = {
        'what': 'setSessionFirewallRules',
        'rules': rulesFromHTML('#diff .left li')
    };
    messager.send(request, renderRules);
};

/******************************************************************************/

var commitHandler = function() {
    var request = {
        'what': 'setPermanentFirewallRules',
        'rules': rulesFromHTML('#diff .right li')
    };
    messager.send(request, renderRules);
};

/******************************************************************************/

var editStartHandler = function() {
    uDom('#diff .right textarea').val(rulesFromHTML('#diff .right li'));
    var parent = uDom(this).ancestors('#diff');
    parent.toggleClass('edit', true);
};

/******************************************************************************/

var editStopHandler = function() {
    var parent = uDom(this).ancestors('#diff');
    parent.toggleClass('edit', false);
    var request = {
        'what': 'setSessionFirewallRules',
        'rules': uDom('#diff .right textarea').val()
    };
    messager.send(request, renderRules);
};

/******************************************************************************/

var editCancelHandler = function() {
    var parent = uDom(this).ancestors('#diff');
    parent.toggleClass('edit', false);
};

/******************************************************************************/

uDom.onLoad(function() {
    // Handle user interaction
    uDom('#importButton').on('click', startImportFilePicker);
    uDom('#importFilePicker').on('change', handleImportFilePicker);
    uDom('#exportButton').on('click', exportUserRulesToFile);

    uDom('#revertButton').on('click', revertHandler);
    uDom('#commitButton').on('click', commitHandler);
    uDom('#editEnterButton').on('click', editStartHandler);
    uDom('#editStopButton').on('click', editStopHandler);
    uDom('#editCancelButton').on('click', editCancelHandler);

    messager.send({ what: 'getFirewallRules' }, renderRules);
});

/******************************************************************************/

})();

