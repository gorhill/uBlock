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

/******************************************************************************/

(function () {

  'use strict';

  /******************************************************************************/

  var messager = vAPI.messaging;
  var dntRespectAppeared = false;
  /******************************************************************************/
  var changeUserSettings = function (name, value) {

    //console.log("changing", name, value);

    messager.send('dashboard', {
      what: 'userSettings',
      name: name,
      value: value
    });
  };

  var onInputChanged = function (ev) {
    var input = ev.target;
    var name = this.getAttribute('data-setting-name');
    var value = input.value;
    if (value !== input.value) {
      input.value = value;
    }
    changeUserSettings(name, value);
  };

  function switchValue(name) {
    return uDom('[data-setting-name=' + name + ']').prop('checked');
  }

  function hideOrClick() {
    return switchValue('hidingAds') || switchValue('clickingAds');
  }

  function changeDNTexceptions(bool){
    changeUserSettings("disableClickingForDNT", bool);
    changeUserSettings("disableHidingForDNT", bool);
  }

  function toggleDNTException(bool) {
    var dntInput = uDom('#dnt-exception')["nodes"][0];
    var dntInputWrapper = dntInput.parentElement;
    if (hideOrClick()) {
      dntInputWrapper.style.display = "block";
      // this runs once only:
      if(!dntRespectAppeared){
        changeDNTexceptions(true);
        dntInput.checked = true;
        dntRespectAppeared = true;
      }
    } else {
      dntInputWrapper.style.display = "none";
    }
  }

  /******************************************************************************/

  // TODO: use data-* to declare simple settings

  var onUserSettingsReceived = function (details) {

    uDom('[data-setting-type="bool"]').forEach(function (uNode) {
      uNode.prop('checked', details[uNode.attr('data-setting-name')] === true)
        .on('change', function () {

          if(this.getAttribute('data-setting-name') === "respectDNT"){
            changeDNTexceptions(this.checked);
          }else{
            changeUserSettings(
              this.getAttribute('data-setting-name'),
              this.checked
            );
          }

          if (!hideOrClick()) {
            changeDNTexceptions(false);
          }

          toggleDNTException();

        });
    });

    uDom('[data-setting-type="input"]').forEach(function (uNode) {
      uNode.val(details[uNode.attr('data-setting-name')])
        .on('change', onInputChanged);
    });

    uDom('#confirm-close').on('click', function (e) {
      e.preventDefault();
      // handles #371
      window.open(location, '_self').close();
    });

    toggleDNTException();
  };

  /******************************************************************************/

  uDom.onLoad(function () {
    messager.send('dashboard', {
      what: 'userSettings'
    }, onUserSettingsReceived);
  });

  /******************************************************************************/

})();
