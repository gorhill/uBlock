/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 Raymond Hill

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

/* global uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var messaging = vAPI.messaging;

/******************************************************************************/

var renderRules = function(details) {
    var liTemplate = uDom('#templates > ul > li');
    var ulLeft = uDom('#diff > .left ul').empty().remove();
    var ulRight = uDom('#diff > .right ul').empty().remove();
    var liLeft, liRight;
    var rules, rule, i;

    // Switches always displayed first -- just like in uMatrix
    // Merge url rules and switches: they just look the same
    rules = details.hnSwitches.split(/\n+/).sort();

    for ( i = 0; i < rules.length; i++ ) {
        rule = rules[i];
        liLeft = liTemplate.clone().text(rule);
        liRight = liTemplate.clone().text(rule);
        ulLeft.append(liLeft);
        ulRight.append(liRight);
    }

    // Firewall rules follow
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
        liLeft = liTemplate.clone();
        liRight = liTemplate.clone();
        if ( onLeft && onRight ) {
            liLeft.text(rule);
            liRight.text(rule);
        } else if ( onLeft ) {
            liLeft.text(rule);
            liRight.text(rule).addClass('notRight toRemove');
        } else {
            liRight.text(rule).addClass('notLeft');
        }
        ulLeft.append(liLeft);
        ulRight.append(liRight);
    }

    uDom('#diff > .left > .rulesContainer').append(ulLeft);
    uDom('#diff > .right > .rulesContainer').append(ulRight);
    uDom('#diff').toggleClass('dirty', details.sessionRules !== details.permanentRules);
};

/******************************************************************************/

function handleImportFilePicker() {
    var fileReaderOnLoadHandler = function() {
        if ( typeof this.result !== 'string' || this.result === '' ) {
            return;
        }
        // https://github.com/chrisaljoudi/uBlock/issues/757
        // Support RequestPolicy rule syntax
        var result = this.result;
        var matches = /\[origins-to-destinations\]([^\[]+)/.exec(result);
        if ( matches && matches.length === 2 ) {
            result = matches[1].trim()
                               .replace(/\|/g, ' ')
                               .replace(/\n/g, ' * noop\n');
        }
        var request = {
            'what': 'setSessionRules',
            'rules': rulesFromHTML('#diff .right li') + '\n' + result
        };
        messaging.send('dashboard', request, renderRules);
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
        'url': 'data:text/plain,' + encodeURIComponent(rulesFromHTML('#diff .left li') + '\n'),
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
    return rules.join('\n').trim();
};

/******************************************************************************/

var revertHandler = function() {
    var request = {
        'what': 'setSessionRules',
        'rules': rulesFromHTML('#diff .left li')
    };
    messaging.send('dashboard', request, renderRules);
};

/******************************************************************************/

var commitHandler = function() {
    var request = {
        'what': 'setPermanentRules',
        'rules': rulesFromHTML('#diff .right li')
    };
    messaging.send('dashboard', request, renderRules);
};

/******************************************************************************/

var editStartHandler = function() {
    var parent = uDom(this).ancestors('#diff');
    // If we're already editing, don't reset
    if ( parent.hasClassName('edit') ) {
        return;
    }
    uDom('#diff .right textarea').val(rulesFromHTML('#diff .right li'));
    parent.toggleClass('edit', true);
};

/******************************************************************************/

var editStopHandler = function() {
    var parent = uDom(this).ancestors('#diff');
    parent.toggleClass('edit', false);
    var request = {
        'what': 'setSessionRules',
        'rules': uDom('#diff .right textarea').val()
    };
    messaging.send('dashboard', request, renderRules);
};

/******************************************************************************/

var editCancelHandler = function() {
    var parent = uDom(this).ancestors('#diff');
    parent.toggleClass('edit', false);
};

/******************************************************************************/

var getCloudData = function() {
    return rulesFromHTML('#diff .left li');
};

var setCloudData = function(data, append) {
    if ( typeof data !== 'string' ) {
        return;
    }
    if ( append ) {
        data = rulesFromHTML('#diff .right li') + '\n' + data;
    }
    var request = {
        'what': 'setSessionRules',
        'rules': data
    };
    messaging.send('dashboard', request, renderRules);
};

self.cloud.onPush = getCloudData;
self.cloud.onPull = setCloudData;

/******************************************************************************/

// Handle user interaction
uDom('#importButton').on('click', startImportFilePicker);
uDom('#importFilePicker').on('change', handleImportFilePicker);
uDom('#exportButton').on('click', exportUserRulesToFile);

uDom('#revertButton').on('click', revertHandler);
uDom('#commitButton').on('click', commitHandler);
uDom('#editEnterButton').on('click', editStartHandler);
uDom('#diff > .pane.right > .rulesContainer').on('dblclick', editStartHandler);
uDom('#editStopButton').on('click', editStopHandler);
uDom('#editCancelButton').on('click', editCancelHandler);

messaging.send('dashboard', { what: 'getRules' }, renderRules);

/******************************************************************************/

})();

