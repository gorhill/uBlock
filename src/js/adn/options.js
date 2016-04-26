/* global vAPI, uDom */

/******************************************************************************/

(function () {

  'use strict';

  /******************************************************************************/

  var messager = vAPI.messaging;

  /******************************************************************************/

  function handleImportFilePicker(evt) {

    var msg = vAPI.i18n('adnImportConfirm');
    var proceed = vAPI.confirm(msg);
    if (proceed) {

      var files = evt.target.files;
      var reader = new FileReader();

      reader.onload = function (e) {
        var adData = JSON.parse(e.target.result);
        messager.send('adnauseam', {
          what: 'importAds',
          data: adData,
          file: files[0].name
        });
      }

      reader.readAsText(files[0]);
    }
  }

  var startImportFilePicker = function () {

    var input = document.getElementById('importFilePicker');
    // Reset to empty string, this will ensure an change event is properly
    // triggered if the user pick a file, even if it is the same as the last
    // one picked.
    input.value = '';
    input.click();
  };

  var exportToFile = function () {

    messager.send('adnauseam', {
      what: 'exportAds',
      filename: getExportFileName()
    }, onLocalDataReceived);
  };

  var onLocalDataReceived = function (details) {

    //onsole.log('onLocalDataReceived',details);

    uDom('#localData > ul > li:nth-of-type(1)').text(
      vAPI.i18n('settingsStorageUsed').replace('{{value}}', details.storageUsed.toLocaleString())
    );

    var elem, dt;
    var timeOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      timeZoneName: 'short'
    };
    var lastBackupFile = details.lastBackupFile || '';
    if (lastBackupFile !== '') {
      dt = new Date(details.lastBackupTime);
      uDom('#localData > ul > li:nth-of-type(2) > ul > li:nth-of-type(1)').text(dt.toLocaleString('fullwide', timeOptions));
      //uDom('#localData > ul > li:nth-of-type(2) > ul > li:nth-of-type(2)').text(lastBackupFile);
      uDom('#localData > ul > li:nth-of-type(2)').css('display', '');
    }

    var lastRestoreFile = details.lastRestoreFile || '';
    elem = uDom('#localData > p:nth-of-type(3)');
    if (lastRestoreFile !== '') {
      dt = new Date(details.lastRestoreTime);
      uDom('#localData > ul > li:nth-of-type(3) > ul > li:nth-of-type(1)').text(dt.toLocaleString('fullwide', timeOptions));
      uDom('#localData > ul > li:nth-of-type(3) > ul > li:nth-of-type(2)').text(lastRestoreFile);
      uDom('#localData > ul > li:nth-of-type(3)').css('display', '');
    }
  };

  /******************************************************************************/

  var clearAds = function () {

    var msg = vAPI.i18n('adnClearConfirm');
    var proceed = vAPI.confirm(msg);
    if (proceed) {
      messager.send('adnauseam', {
        what: 'clearAds'
      });
    }
  };

  /******************************************************************************/

  var changeUserSettings = function (name, value) {
    messager.send('dashboard', {
      what: 'userSettings',
      name: name,
      value: value
    });
  };

  /******************************************************************************/

  var onInputChanged = function (ev) {
    var input = ev.target;
    var name = this.getAttribute('data-setting-name');
    var value = input.value;
    if (name === 'largeMediaSize') {
      value = Math.min(Math.max(Math.floor(parseInt(value, 10) || 0), 0), 1000000);
    }
    if (value !== input.value) {
      input.value = value;
    }
    changeUserSettings(name, value);
  };

  /******************************************************************************/

  // TODO: use data-* to declare simple settings

  var onUserSettingsReceived = function (details) {
    uDom('[data-setting-type="bool"]').forEach(function (uNode) {
      uNode.prop('checked', details[uNode.attr('data-setting-name')] === true)
        .on('change', function () {
          changeUserSettings(
            this.getAttribute('data-setting-name'),
            this.checked
          );
        });
    });

    uDom('[data-setting-name="noLargeMedia"] ~ label:first-of-type > input[type="number"]')
      .attr('data-setting-name', 'largeMediaSize')
      .attr('data-setting-type', 'input');

    uDom('[data-setting-type="input"]').forEach(function (uNode) {
      uNode.val(details[uNode.attr('data-setting-name')])
        .on('change', onInputChanged);
    });

    uDom('#export').on('click', exportToFile);
    uDom('#import').on('click', startImportFilePicker);
    uDom('#importFilePicker').on('change', handleImportFilePicker);
    uDom('#reset').on('click', clearAds);
  };

  /******************************************************************************/

  uDom.onLoad(function () {
    messager.send('dashboard', {
      what: 'userSettings'
    }, onUserSettingsReceived);
    messager.send('dashboard', {
      what: 'getLocalData'
    }, onLocalDataReceived);
  });

  /******************************************************************************/

})();
