/*******************************************************************************

    µMatrix - a browser extension to block requests.
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
    var liTemplate = uDom('#templates > ul > li');
    var ulLeft = uDom('#diff > .left ul').empty().remove();
    var ulCenter = uDom('#diff > .center ul').empty().remove();
    var ulRight = uDom('#diff > .right ul').empty().remove();
    var liLeft, liCenter, liRight;
    var rules, rule, i;

    // Switches always displayed first -- just like in uMatrix
    rules = details.hnSwitches.split(/\n+/).sort();
    for ( i = 0; i < rules.length; i++ ) {
        rule = rules[i];
        liLeft = liTemplate.clone().text(rule);
        liCenter = liTemplate.clone();
        liRight = liTemplate.clone().text(rule);
        ulLeft.append(liLeft);
        ulCenter.append(liCenter);
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
        liCenter = liTemplate.clone();
        liRight = liTemplate.clone();
        if ( onLeft && onRight ) {
            liLeft.text(rule);
            liRight.text(rule);
        } else if ( onLeft ) {
            liLeft.text(rule).addClass('notRight');
            liCenter.html('<button type="button" class="commitButton"></button><button type="button" class="revertButton"></button>');
            liRight.text(rule).addClass('notRight toRemove');
        } else {
            liCenter.html('<button type="button" class="commitButton"></button><button type="button" class="revertButton"></button>');
            liRight.text(rule).addClass('notLeft');
            liLeft.text(rule).addClass('notLeft toRemove');
        }
        ulLeft.append(liLeft);
        ulCenter.append(liCenter);
        ulRight.append(liRight);
    }

    uDom('#diff > .left > .rulesContainer').append(ulLeft);
    uDom('#diff > .center > .rulesContainer').append(ulCenter);
    uDom('#diff > .right > .rulesContainer').append(ulRight);
    uDom('.rulesContainer .revertButton').on('click', singleRevertHandler);
    uDom('.rulesContainer .commitButton').on('click', singleCommitHandler);
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
    var singleAction = uDom('.singleAction').length;
    for ( var i = 0; i < lis.length; i++ ) {
        li = lis.at(i);
        if ( !singleAction && li.hasClassName('toRemove') ) {
            rules.push('');
        } else if ( li.hasClassName('singleAction') && li.hasClassName('toRemove') && ( li.hasClassName('notRight') || li.hasClassName('notLeft') ) ) {
            rules.push('');
        } else if ( li.hasClassName('singleAction') && ( li.hasClassName('notRight') || li.hasClassName('notLeft') ) ) {
            rules.push(li.text());
        } else if ( singleAction && li.hasClassName('toRemove') && ( li.hasClassName('notRight') || li.hasClassName('notLeft') ) ) {
            rules.push(li.text());
        } else if ( singleAction && ( li.hasClassName('notRight') || li.hasClassName('notLeft') ) ) {
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

var singleRevertHandler = function() {
    var i = [].indexOf.call(this.parentNode.parentNode.children, this.parentNode);
    var li = uDom('#diff .left li').at(i);
    li.addClass('singleAction');
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

var singleCommitHandler = function() {
    var i = [].indexOf.call(this.parentNode.parentNode.children, this.parentNode);
    var li = uDom('#diff .right li').at(i);
    li.addClass('singleAction');
    var request = {
        'what': 'setPermanentFirewallRules',
        'rules': rulesFromHTML('#diff .right li')
    };
    messager.send(request, renderRules);
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
    uDom('#diff > .pane.right > .rulesContainer').on('dblclick', editStartHandler);
    uDom('#editStopButton').on('click', editStopHandler);
    uDom('#editCancelButton').on('click', editCancelHandler);

    messager.send({ what: 'getFirewallRules' }, renderRules);
});

/******************************************************************************/

})();

