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

  var resetUserData = function() {
      var msg = vAPI.i18n('aboutResetDataConfirm').replace(/uBlock₀/g, 'AdNauseam');
      var proceed = vAPI.confirm(msg);
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

      // see #488
      // renderNotifications(details.notifications);

      updateGroupState();
    });
  };

  /******************************************************************************/
  // Not needed for new slider
  // var frequencyTagConverter = function(input) {
  //     var match = {
  //         all: 1,
  //         most: 0.75,
  //         some: 0.3,
  //         occasional: 0.1
  //     }
  //
  //     if (typeof input === "string") return match[input];
  //     else {
  //         for (var prop in match) {
  //             if (match[prop] === input) return prop;
  //         }
  //     }
  //
  // }
  /******************************************************************************/
  var ClickChoice = function(slideVal, disabled) {
    var choiceValue = document.getElementById('choiceValue');

    if ( disabled) {
      return choiceValue.innerHTML = "<i>Disabled</i>";
    }
    if (Number(slideVal) < .3) {
      return choiceValue.innerHTML = "Occasional";
    }
    if (.3 <= Number(slideVal) &&  Number(slideVal) < .75) {
      return choiceValue.innerHTML = "Some";
    }
    if (.75 <= Number(slideVal) &&  Number(slideVal)  < 1) {
      return choiceValue.innerHTML = "Most";
    }
    if (Number(slideVal) === 1) {
      return choiceValue.innerHTML = "All";
    }


  }
  var ClickProbabilityChanged = function() {
      var selection = uDom('input[id="slider"]');
      var slideVal = selection.nodes[0].value;

      selection.val(slideVal);

      ClickChoice(slideVal, selection.nodes[0].disabled);

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

  // TODO: use data-* to declare simple settings

  var onUserSettingsReceived = function (details) {

    // console.log('onUserSettingsReceived', details);

    uDom('[data-setting-type="bool"]').forEach(function (uNode) {

      var name = uNode.attr('data-setting-name'), value = details[name];
      var selection = uDom('input[id="slider"]');

      ClickChoice(details.clickProbability, !details.clickingAds);

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

    uDom('#reset').on('click', clearAds);
    uDom('#export').on('click', exportToFile);
    uDom('#import').on('click', startImportFilePicker);
    uDom('#importFilePicker').on('change', handleImportFilePicker);
    uDom('#resetOptions').on('click', resetUserData);
    uDom('#confirm-close').on('click', function (e) {
      e.preventDefault();
      window.open(location, '_self').close();
    });

    // see #488
    //renderNotifications(details.notifications);
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
