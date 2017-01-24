/* global uDom */

/******************************************************************************/

uDom.onLoad(function () {

  'use strict';

  var onAppDataReady = function (appData) {
    uDom('#aboutNameVer').text(appData.name +' v' + appData.version);
    uDom('#builtOn').attr('data-i18n', 'aboutBuiltOn');
  };

  vAPI.messaging.send('dashboard', {
    what: 'getAppData'
  }, onAppDataReady);

});
