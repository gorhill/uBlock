/* global vAPI, uDom */

/******************************************************************************/

(function () {

  'use strict';

  /******************************************************************************/

  var messager = vAPI.messaging;

  /******************************************************************************/
  var changeUserSettings = function (name, value) {  

    console.log("changing", name, value);
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

  function getValueOfSwitch(name){
    return uDom('[data-setting-name='+name+']').prop('checked');
  }

  function hideOrClickTrue () {
    var showBox = false;
    if(getValueOfSwitch('hidingAds') === true || getValueOfSwitch('clickingAds') === true){
      showBox = true;
    }
    return showBox;
  }

  function toggleDNTExceptionBox(bool){
    var dntInputWrapper = uDom('#dnt-exception')["nodes"][0].parentElement;
    if(hideOrClickTrue()){   
      dntInputWrapper.style.display = "block";
    }else{
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
          
          toggleDNTExceptionBox();

        });
    });


    //not sure when this one is called
    uDom('[data-setting-type="input"]').forEach(function (uNode) {
      uNode.val(details[uNode.attr('data-setting-name')])
        .on('change', onInputChanged);
    });

    uDom('#confirm-close').on('click', function (e) {
      e.preventDefault();
      // handle #371 here 
      if(getValueOfSwitch('hidingAds') === false && getValueOfSwitch('clickingAds') === false){
        changeUserSettings('respectDNT', false);
      }
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
