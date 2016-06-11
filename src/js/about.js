/* global uDom */

/******************************************************************************/

uDom.onLoad(function () {

  'use strict';

  var onAppDataReady = function (appData) {
    uDom('#aboutNameVer').text(appData.name +
      ' v' + appData.version + ' (built on uBlock)');
  };

  vAPI.messaging.send('dashboard', {
    what: 'getAppData'
  }, onAppDataReady);

  //if (document.location.href.endsWith('fr=1')) // show first-run content
    //uDom('#first-run-content').removeClass('hide');

});
