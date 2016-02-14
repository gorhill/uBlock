/* global vAPI, uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var renderPage = function(ads) {

};

/******************************************************************************/

var tabId;

(function() {

    tabId = null;

    // Extract the tab id of the page this popup is for
    var matches = window.location.hash.match(/#tab_([^&]+)/);

    if ( matches && matches.length === 2 ) {
        tabId = matches[1];
    }

    messager.send({

        what: 'adsForVault',
        tabId: tabId

    }, renderPage);

})();

/********************************************************************/

})();
