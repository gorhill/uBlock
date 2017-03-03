/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 Raymond Hill

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

    Home: https://github.com/gorhill/uBlock
*/

/* global uDom */

'use strict';

/******************************************************************************/

(function () {

  'use strict';

  /******************************************************************************/

  var resizeFrame = function () {
    var navRect = document.getElementById('dashboard-nav').getBoundingClientRect();
    var viewRect = document.documentElement.getBoundingClientRect();
    var notiRect = document.getElementById('notifications').offsetHeight;

    document.getElementById('iframe').style.setProperty('height', (viewRect.height - navRect.height - notiRect) + 'px');
  };

  var loadDashboardPanel = function (notifications) {
    // console.log(notifications);

    var pane = window.location.hash.slice(1);
    if ( pane === '' ) {
        pane = vAPI.localStorage.getItem('dashboardLastVisitedPane') || 'options.html';
    } else {
        vAPI.localStorage.setItem('dashboardLastVisitedPane', pane);
    }

    var tabButton = uDom('[href="#' + pane + '"]');
    if (!tabButton) return;

    uDom('.tabButton.selected').toggleClass('selected', false);
    uDom('iframe').attr('src', pane);

    tabButton.toggleClass('selected', true);

    notifications && renderNotifications(notifications, "dashboard");
    resizeFrame();
  };

  var onTabClickHandler = function (e) {
    var url = window.location.href,
      pos = url.indexOf('#');
    if (pos !== -1) {
      url = url.slice(0, pos);
    }
    url += this.hash;
    window.location.replace(url);
    loadDashboardPanel();

    e.preventDefault();
  };

  var recalculateIframeHeight = function () {
    //recalculate the height
    var h = document.getElementById('notifications').offsetHeight;
    var currenth = document.getElementById('ad-list').offsetHeight;
    var newh = currenth - h;
    uDom('#ad-list').css('height', newh + 'px');
  };

  var setBackBlockHeight = function () {
    uDom('#ad-list').css('height', '350px');
  };


  vAPI.messaging.addChannelListener('adnauseam', function (request) {

    // console.log("dashboard.js::BROADCAST", request);

    switch (request.what) {


    case 'notifications':

      loadDashboardPanel(request.notifications);
      break;
    }
  });


  /******************************************************************************/

  uDom.onLoad(function () {
    resizeFrame();
    window.addEventListener('resize', resizeFrame);
    uDom('.tabButton').on('click', onTabClickHandler);
    uDom('#notifications').on('click', resizeFrame);

     vAPI.messaging.send(
      'adnauseam', {
          what: 'verifyAdBlockers'
        }, function() {
          vAPI.messaging.send(
          'adnauseam', {
            what: 'getNotifications'
          }, loadDashboardPanel);
      });

  });

  /******************************************************************************/

})();
