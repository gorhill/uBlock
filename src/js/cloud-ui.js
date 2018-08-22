/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-2017 Raymond Hill

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
    if ( entry instanceof Object === false ) {
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
        function(error) {
            var failed = typeof error === 'string';
            document.getElementById('cloudPush')
                    .classList
                    .toggle('error', failed);
            document.querySelector('#cloudError > span')
                    .textContent = failed ? error : '';
            fetchCloudData();
        }
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
        if ( options instanceof Object === false ) {
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

    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'cloud-ui.html', true);
    xhr.overrideMimeType('text/html;charset=utf-8');
    xhr.responseType = 'text';
    xhr.onload = function() {
        this.onload = null;
        var parser = new DOMParser(),
            parsed = parser.parseFromString(this.responseText, 'text/html'),
            fromParent = parsed.body;
        while ( fromParent.firstElementChild !== null ) {
            widget.appendChild(
                document.adoptNode(fromParent.firstElementChild)
            );
        }

        vAPI.i18n.render(widget);
        widget.classList.remove('hide');

        uDom('#cloudPush').on('click', pushData);
        uDom('#cloudPull').on('click', pullData);
        uDom('#cloudPullAndMerge').on('click', pullAndMergeData);
        uDom('#cloudCog').on('click', openOptions);
        uDom('#cloudOptions').on('click', closeOptions);
        uDom('#cloudOptionsSubmit').on('click', submitOptions);
        
        // Patch 2018-01-05: Must not assume this XHR will always be faster
        // than messaging
        fetchCloudData();
    };
    xhr.send();
};

messaging.send('cloudWidget', { what: 'cloudGetOptions' }, onInitialize);

/******************************************************************************/

// https://www.youtube.com/watch?v=aQFp67VoiDA

})();
