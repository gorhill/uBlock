/* global vAPI, uDom */

/******************************************************************************/

(function () {

  'use strict';

  /******************************************************************************/

  var messager = vAPI.messaging;

  /******************************************************************************/
  var changeUserSettings = function (name, value) {

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

  function hideOrClickTrue () {
    var showBox = false;
    uDom('[data-setting-type="bool"]').forEach(function (uNode) {
      var name = uNode.attr('data-setting-name');
      if((name === 'hidingAds' || name === 'clickingAds') && uNode.prop('checked')){
        showBox = true;
      }
    });
    return showBox;
  }

  function toggleDNTExceptionBox(bool){
    var elem = uDom('#dnt-exception')["nodes"][0].parentElement;
    if(hideOrClickTrue()){
      elem.style.display = "block";
    }else{
      elem.style.display = "none";
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
          
          toggleDNTExceptionBox();

        });
    });

    uDom('[data-setting-type="input"]').forEach(function (uNode) {
      uNode.val(details[uNode.attr('data-setting-name')])
        .on('change', onInputChanged);
    });

    uDom('#confirm-close').on('click', function (e) {
      e.preventDefault();
      // handle #371 here 
      // is this function not only called on submit, why #371 here?
      window.open(location, '_self').close();
    });

    toggleDNTExceptionBox();
  };

  /******************************************************************************/

  uDom.onLoad(function () {

    messager.send('dashboard', {
      what: 'userSettings'
    }, onUserSettingsReceived);

  });

  /******************************************************************************/

})();
