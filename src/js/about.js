/* global uDom */

/******************************************************************************/

uDom.onLoad(function () {

  'use strict';

  var onAppDataReady = function (appData) {
    uDom('#aboutNameVer').text(appData.name +' v' + appData.version);
    uDom('#builtOn').text('built on'); //TODO: intl
  };

  vAPI.messaging.send('dashboard', {
    what: 'getAppData'
  }, onAppDataReady);

});
