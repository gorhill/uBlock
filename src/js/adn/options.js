/*******************************************************************************

    AdNauseam - Fight back against advertising surveillance.
    Copyright (C) 2014-2016 Daniel C. Howe

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

    Home: https://github.com/dhowe/AdNauseam
*/

/* global vAPI, uDom */

(function () {

  'use strict';

  /******************************************************************************/

  var messager = vAPI.messaging;

  /******************************************************************************/

  var onLocalDataReceived = function (details) {

    if (details.storageUsed)
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
    
    // var lastBackupFile = details.lastBackupFile || '';
    // if (lastBackupFile !== '') {
    //   dt = new Date(details.lastBackupTime);
    //   uDom('#localData > ul > li:nth-of-type(2) > ul > li:nth-of-type(1)').text(dt.toLocaleString('fullwide', timeOptions));
    //   //uDom('#localData > ul > li:nth-of-type(2) > ul > li:nth-of-type(2)').text(lastBackupFile);
    //   uDom('#localData > ul > li:nth-of-type(2)').css('display', '');
    // }

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

  var resetUserData = function() {
      var msg = vAPI.i18n('aboutResetDataConfirm').replace(/uBlock₀/g, 'AdNauseam'); // ADN
      var proceed = window.confirm(msg); // ADN: changed from vAPI.confirm merge1.14.12
      if ( proceed ) {
          messager.send('dashboard', { what: 'resetUserData' });
      }
  };

  /******************************************************************************/

  var changeUserSettings = function (name, value) {

    //console.log('changeUserSettings',name, value);

    messager.send('dashboard', {
      what: 'userSettings',
      name: name,
      value: value
    },
    function(details) {
      updateGroupState();
    });
  };

  var ClickProbabilityChanged = function() {
      var selection = uDom('input[id="slider"]');
      var slideVal = selection.nodes[0].value;

      selection.val(slideVal);

      messager.send('dashboard', {
        what: 'userSettings',
        name: 'clickProbability',
        value: Number(slideVal)
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

  // if any of 3 main toggles are off, disabled their subgroups
  var updateGroupState = function () {

    uDom('.hidingAds-child').prop('disabled', !uDom('#hidingAds').prop('checked'));
    uDom('.clickingAds-child').prop('disabled', !uDom('#clickingAds').prop('checked'));
    uDom('.blockingMalware-child').prop('disabled', !uDom('#blockingMalware').prop('checked'));
  }

   /******************************************************************************/

    var exportDialog = function() {
       uDom('#export-dialog').removeClass("hide");
     }
    
    var exportTo = function() {
        var action = uDom('#export-dialog input:checked').nodes[0].id;
        exportToFile(action)
        closeDialog();
    }

    var closeDialog = function() {
       uDom('#export-dialog').addClass("hide");
    }



  /******************************************************************************/

  // TODO: use data-* to declare simple settings

  var onUserSettingsReceived = function (details) {

    // console.log('onUserSettingsReceived', details);

    if (isMobile()) {
      uDom('.dntOption').css('display', 'none');
    }

    uDom('[data-setting-type="bool"]').forEach(function (uNode) {

      var name = uNode.attr('data-setting-name'), value = details[name];
      var selection = uDom('input[id="slider"]');


      //updateSubgroupState(name, value);

      selection.val(details.clickProbability);

      uNode.prop('checked', value === true)
        .on('change', function () {
          changeUserSettings(
            this.getAttribute('data-setting-name'),
            this.checked
          );
        });

        var id = "#slider";
        uDom(id).prop('checked',true);

    });

    uDom('input[type="range"]').on('change', ClickProbabilityChanged);

    uDom('[data-setting-name="noLargeMedia"] ~ label:first-of-type > input[type="number"]')
      .attr('data-setting-name', 'largeMediaSize')
      .attr('data-setting-type', 'input');

      uDom('[data-setting-type="input"]').forEach(function (uNode) {
        uNode.val(details[uNode.attr('data-setting-name')])
          .on('change', onInputChanged);
      });
    

    // Minor text fixes
    if (uDom('#exportDialog').text() === "Back up to file")
      uDom('#exportDialog').text("Backup to file");
    uDom('#import').text(uDom('#import').text().replace('...',''));
    uDom('#resetOptions').text(uDom('#resetOptions').text().replace('...',''));
    
    // On click events
    uDom('#reset').on('click', clearAds);
    uDom('#exportDialog').on('click', exportDialog);
    uDom('#export').on('click', exportTo);
    uDom('#import').on('click', startImportFilePicker);
    uDom('#importFilePicker').on('change', handleImportFilePicker);
    uDom('#resetOptions').on('click', resetUserData);
    uDom('#export-dialog .close').on('click', closeDialog);
    uDom('#confirm-close').on('click', function (e) {
      e.preventDefault();
      window.open(location, '_self').close();
    });

    updateGroupState();
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
