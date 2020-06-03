
  'use strict';

(async ( ) => {

    vAPI.messaging.send('dashboard', { what: 'getAppData' }, appData => {
        uDom('#aboutNameVer').text(appData.name + ' v' + appData.version);
    });

    // document.querySelector(
    //     '[href="logger-ui.html"]'
    // ).addEventListener(
    //     'click',
    //     self.uBlockDashboard.openOrSelectPage
    // );

    const appData = await vAPI.messaging.send('dashboard', {
        what: 'getAppData',
    });
    uDom('#aboutNameVer').text(appData.name + ' v' + appData.version);
})();
