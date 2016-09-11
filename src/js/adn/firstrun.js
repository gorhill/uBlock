/* global vAPI, uDom */

/******************************************************************************/

(function () {

  'use strict';

  /******************************************************************************/

  var messager = vAPI.messaging;

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

  function toggleDNTException(bool) {
    var dntInputWrapper = uDom('#dnt-exception')["nodes"][0].parentElement;
    if (hideOrClick()) {
      dntInputWrapper.style.display = "block";
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

          changeUserSettings(
            this.getAttribute('data-setting-name'),
            this.checked
          );

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
      if (!hideOrClick()) {
        changeUserSettings('respectDNT', false);
      }
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
