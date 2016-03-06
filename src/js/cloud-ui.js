/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-2016 Raymond Hill

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

/* global uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

self.cloud = {
    options: {},
    datakey: '',
    data: undefined,
    onPush: null,
    onPull: null
};

/******************************************************************************/

var widget = uDom.nodeFromId('cloudWidget');
if ( widget === null ) {
    return;
}

self.cloud.datakey = widget.getAttribute('data-cloud-entry') || '';
if ( self.cloud.datakey === '' ) {
    return;
}

var messaging = vAPI.messaging;

/******************************************************************************/

var onCloudDataReceived = function(entry) {
    if ( typeof entry !== 'object' || entry === null ) {
        return;
    }

    self.cloud.data = entry.data;

    uDom.nodeFromId('cloudPull').removeAttribute('disabled');
    uDom.nodeFromId('cloudPullAndMerge').removeAttribute('disabled');

    var timeOptions = {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        timeZoneName: 'short'
    };

    var time = new Date(entry.tstamp);
    widget.querySelector('span').textContent =
        entry.source + '\n' +
        time.toLocaleString('fullwide', timeOptions);
};

/******************************************************************************/

var fetchCloudData = function() {
    messaging.send(
        'cloudWidget',
        {
            what: 'cloudPull',
            datakey: self.cloud.datakey
        },
        onCloudDataReceived
    );
};

/******************************************************************************/

var pushData = function() {
    if ( typeof self.cloud.onPush !== 'function' ) {
        return;
    }
    messaging.send(
        'cloudWidget',
        {
            what: 'cloudPush',
            datakey: self.cloud.datakey,
            data: self.cloud.onPush()
        },
        fetchCloudData
    );
};

/******************************************************************************/

var pullData = function() {
    if ( typeof self.cloud.onPull === 'function' ) {
        self.cloud.onPull(self.cloud.data, false);
    }
};

/******************************************************************************/

var pullAndMergeData = function() {
    if ( typeof self.cloud.onPull === 'function' ) {
        self.cloud.onPull(self.cloud.data, true);
    }
};

/******************************************************************************/

var openOptions = function() {
    var input = uDom.nodeFromId('cloudDeviceName');
    input.value = self.cloud.options.deviceName;
    input.setAttribute('placeholder', self.cloud.options.defaultDeviceName);
    uDom.nodeFromId('cloudOptions').classList.add('show');
};

/******************************************************************************/

var closeOptions = function(ev) {
    var root = uDom.nodeFromId('cloudOptions');
    if ( ev.target !== root ) {
        return;
    }
    root.classList.remove('show');
};

/******************************************************************************/

var submitOptions = function() {
    var onOptions = function(options) {
        if ( typeof options !== 'object' || options === null ) {
            return;
        }
        self.cloud.options = options;
    };

    messaging.send(
        'cloudWidget',
        {
            what: 'cloudSetOptions',
            options: {
                deviceName: uDom.nodeFromId('cloudDeviceName').value
            }
        },
        onOptions
    );
    uDom.nodeFromId('cloudOptions').classList.remove('show');
};

/******************************************************************************/

var onInitialize = function(options) {
    if ( typeof options !== 'object' || options === null ) {
        return;
    }

    if ( !options.enabled ) {
        return;
    }
    self.cloud.options = options;

    fetchCloudData();

    var html = [
        '<button id="cloudPush" type="button" title="cloudPush"></button>',
        '<span data-i18n="cloudNoData"></span>',
        '<button id="cloudPull" type="button" title="cloudPull" disabled></button>&nbsp;',
        '<button id="cloudPullAndMerge" type="button" title="cloudPullAndMerge" disabled></button>',
        '<span id="cloudCog" class="fa">&#xf013;</span>',
        '<div id="cloudOptions">',
        '    <div>',
        '        <p><label data-i18n="cloudDeviceNamePrompt"></label> <input id="cloudDeviceName" type="text" value="">',
        '        <p><button id="cloudOptionsSubmit" type="button" data-i18n="genericSubmit"></button>',
        '    </div>',
        '</div>',
    ].join('');

    vAPI.insertHTML(widget, html);
    vAPI.i18n.render(widget);
    widget.classList.remove('hide');

    uDom('#cloudPush').on('click', pushData);
    uDom('#cloudPull').on('click', pullData);
    uDom('#cloudPullAndMerge').on('click', pullAndMergeData);
    uDom('#cloudCog').on('click', openOptions);
    uDom('#cloudOptions').on('click', closeOptions);
    uDom('#cloudOptionsSubmit').on('click', submitOptions);
};

messaging.send('cloudWidget', { what: 'cloudGetOptions' }, onInitialize);

/******************************************************************************/

// https://www.youtube.com/watch?v=aQFp67VoiDA

})();
