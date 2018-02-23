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

/* global vAPI, uDom, $ */

(function () {

  'use strict';

  var ads, page, settings; // remove? only if we can find an updated ad already in the DOM

  vAPI.messaging.addChannelListener('adnauseam', function (request) {

    switch (request.what) {

    case 'adAttempt':
      setAttempting(request.ad);
      break;

    case 'adDetected':
      // for now, just re-render
      renderPage(request);
      break;

    case 'adVisited':
      updateAd(request.ad);
      break;

    case 'notifications':
      renderNotifications(request.notifications);
      adjustBlockHeight();
      break;
    }
  });

  /******************************************************************************/

  var renderPage = function (json) {

    page = json && json.pageUrl;
    settings = json && json.prefs;

    function disableMenu() {
      uDom.nodeFromId('pause-button').disabled = true;
      uDom.nodeFromId('resume-button').disabled = true;
    }

    if (page) {
      // disable pause & resume buttons for options, vault, about/chrome
      if (page === vAPI.getURL("vault.html") ||
        page.indexOf(vAPI.getURL("dashboard.html")) === 0 ||
        page.indexOf("chrome") === 0 || page.indexOf("about:") === 0)
      {
        disableMenu();
      }
    }
    else {
      // for Firefox new tab page (see #1196)
      disableMenu();
    }

    uDom("#alert").addClass('hide'); // reset state
    uDom('#main').toggleClass('disabled', dval());

    updateMenuState();

    ads = json && onPage(json.data, page);

    setCounts(ads, json && json.data && json.data.length);

    var $items = uDom('#ad-list-items');

    $items.removeClass().empty();

    if (ads) {

      // if we have no page ads, use the most recent
      if (!ads.length) ads = doRecent(json.data);

      for (var i = 0, j = ads.length; i < j; i++) {
        appendAd($items, ads[i]);
      }

      setAttempting(json.current);
    }

    vAPI.messaging.send(
      'adnauseam', {
        what: 'verifyAdBlockersAndDNT',
        url: page
      },
      function () {
        vAPI.messaging.send(
          'adnauseam', {
            what: 'getNotifications'
          },
          function (notifications) {
            renderNotifications(notifications);
          });
      });
  }

  var updateMenuState = function () {

    if (uDom('#main').hasClass('disabled')) {

      uDom('#resume-button').removeClass('hide').addClass('show');
      uDom('#pause-button').removeClass('show').addClass('hide');

    } else {

      uDom('#pause-button').removeClass('hide').addClass('show');
      uDom('#resume-button').removeClass('show').addClass('hide');
    }
  }

  var setCounts = function (ads, total) {

    var numVisits = visitedCount(ads) || 0;
    uDom('#vault-count').text(total || 0);
    uDom('#visited-count').text(numVisits || 0);
    uDom('#found-count').text(ads ? ads.length : 0);
    setCost(numVisits);
  }

  var updateInterface = function (json) {

    var page = json.pageUrl;

    // disable pause & resume buttons for options, vault, about/chrome
    if (page === vAPI.getURL("vault.html") ||
      page.indexOf(vAPI.getURL("dashboard.html")) === 0 ||
      page.indexOf("chrome://") === 0 ||
      page.indexOf("about:") === 0) {
      uDom.nodeFromId('pause-button').disabled = true;
      uDom.nodeFromId('resume-button').disabled = true;
    }

    uDom("#alert").addClass('hide'); // reset state
    uDom('#main').toggleClass('disabled', dval());
    uDom('#paused-on-page').toggleClass('hide', json.prefs.hidingDisabled);
    uDom('#paused-no-hiding').toggleClass('hide', !json.prefs.hidingDisabled);

    if (uDom('#main').hasClass('disabled')) {

      uDom('#resume-button').removeClass('hide').addClass('show');
      uDom('#pause-button').removeClass('show').addClass('hide');

    } else {

      uDom('#pause-button').removeClass('hide').addClass('show');
      uDom('#resume-button').removeClass('show').addClass('hide');
    }

    uDom('#vault-count').text(json.data.length);
    uDom('#visited-count').text(visitedCount(ads));
    uDom('#found-count').text(ads.length);
    //console.log("FOUND: " + ads.length);
  }

  var layoutAds = function (json) {

    var $items = uDom('#ad-list-items');
    $items.removeClass().empty();

    if (ads) {

      // if we have no page ads, use the most recent
      if (!ads.length) ads = doRecent(json.data);

      for (var i = 0, j = ads.length; i < j; i++)
        appendAd($items, ads[i]);

      setAttempting(json.current);
    }
  }

  var getTitle = function (ad) {

    var title = ad.title + ' ';
    if (ad.visitedTs < 1) {

      // adds . to title for each failed attempt
      for (var i = 0; i < ad.attempts; i++)
        title += '.';
    }
    return title;
  }

  var updateAd = function (ad) { // update class, title, counts
    // console.log(ad);
    if (verify(ad)) {

      var $ad = updateAdClasses(ad);

      // update the title
      $ad.descendants('.title').text(decodeEntities(getTitle(ad)));

      // update the url
      $ad.descendants('cite').text(targetDomain(ad));

      // update the visited count
      if (ad.pageUrl === page) { // global page here

        var numVisits = visitedCount(ads);
        uDom('#visited-count').text(numVisits); // **uses global ads, page
        setCost(numVisits);
      }
    }
  }

  var verify = function (ad) { // uses global ads

    if (!ads) console.error("NO GLOBAL ADS!!!");

    if (ad) {

      for (var i = 0; i < ads.length; i++) {

        if (ads[i].id === ad.id) {
          ads[i] = ad;
          return true;
        }
      }
    }

    return false;
  }

  var doRecent = function (data) { // return 6 newest ads

    uDom("#alert").removeClass('hide');
    uDom('#ad-list-items').addClass('recent-ads');

    return data.sort(byField('-foundTs')).slice(0, 6);
  }

  var onPage = function (ads, pageUrl) {

    if (pageUrl) {

      var res = [];

      // first try current ads
      for (var i = 0; i < ads.length; i++) {
        if (ads[i] && ads[i].pageUrl === pageUrl && ads[i].current) {
          res.push(ads[i]);
        }
      }

      // then all page ads
      if (res.length === 0) {
        for (var i = 0; i < ads.length; i++) {
          if (ads[i] && ads[i].pageUrl === pageUrl) {
            res.push(ads[i]);
          }
        }
      }

      return res.sort(byField('-foundTs'));
    }
  }

  var appendAd = function ($items, ad) {

    if (ad.contentType === 'img') {

      appendImageAd(ad, $items);

    } else if (ad.contentType === 'text') {

      appendTextAd(ad, $items);
    }
  }

  var removeClassFromAll = function (cls) {

    uDom('.ad-item').removeClass(cls);
    uDom('.ad-item-text').removeClass(cls);
  }

  var setAttempting = function (ad) {

    // one 'attempt' at a time
    removeClassFromAll('attempting');

    if (verify(ad)) {
      uDom('#ad' + ad.id).addClass('attempting');
    }
  }

  var updateAdClasses = function (ad) {

    var $ad = uDom('#ad' + ad.id); //$('#ad' + ad.id);

    // allow only one just-* at a time...
    removeClassFromAll('just-visited just-failed');

    // See https://github.com/dhowe/AdNauseam/issues/61
    var cls = ad.visitedTs > 0 ? 'just-visited' : 'just-failed';
    // Update the status
    var txt = cls === 'just-visited' ? 'visited' : 'failed';
    $ad.descendants('.adStatus').text(txt);

    $ad.removeClass('failed visited attempting').addClass(cls);

    // timed for animation
    setTimeout(function () {
      $ad.addClass(visitedClass(ad));
    }, 300);

    return $ad;
  }

  var appendImageAd = function (ad, $items) {

    var $img, $a, $span, $status, $li = uDom(document.createElement('li'))
      .attr('id', 'ad' + ad.id)
      .addClass(('ad-item ' + visitedClass(ad)).trim());

    $a = uDom(document.createElement('a'))
      .attr('target', 'new')
      .attr('href', ad.targetUrl);

    $span = uDom(document.createElement('span')).addClass('thumb');
    $span.appendTo($a);

    appendAdStatus(ad,$a);

    $img = uDom(document.createElement('img'))
      .attr('src', (ad.contentData.src || ad.contentData))
      .addClass('ad-item-img')
      .on('click', "this.onerror=null; this.width=50; this.height=45; this.src='img/placeholder.svg'");

    $img.on("error", function () {

      $img.css({
        width: 80,
        height: 40
      });
      $img.attr('src', 'img/placeholder.svg');
      $img.attr('alt', 'Unable to load image');
      $img.off("error");
    });

    $img.appendTo($span);

    //    $span.appendTo($a);

    uDom(document.createElement('span'))
      .addClass('title')
      .text(ad.title ? decodeEntities(ad.title) : "#" + ad.id)
      .appendTo($a);

    uDom(document.createElement('cite'))
      .text(targetDomain(ad))
      .appendTo($a);

    $a.appendTo($li);
    $li.appendTo($items);
  }

  var appendAdStatus = function(ad, parent) {
    var $status = uDom(document.createElement('span'))
        .addClass('adStatus').text(vAPI.i18n("adnAdClickingStatus" + adStatus(ad)));
    $status.appendTo(parent);

  }

  var adStatus = function (ad) {

    var status = settings.clickingDisabled ? "SkippedDisabled" : "Pending";

    if (!ad.noVisit) {
      if (ad.attempts > 0) {
        status = ad.visitedTs > 0 ? 'Visited' : 'Failed';
      }
    } else if (status != "SkippedDisabled") {
      if (ad.clickedByUser) status = "SkippedUser";
      else status = "Skipped" +  (ad.dntAllowed ? "DNT" : "Frequency");
    }
    return status;
  }

  var appendTextAd = function (ad, $items) {

    var $cite, $h3, $status, $li = uDom(document.createElement('li'))
      .attr('id', 'ad' + ad.id)
      .addClass(('ad-item-text ' + visitedClass(ad)).trim());

    uDom(document.createElement('span'))
      .addClass('thumb')
      .text('Text Ad').appendTo($li);

    appendAdStatus(ad,$li); 

    $h3 = uDom(document.createElement('h3'));

    uDom(document.createElement('a'))
      .attr('target', 'new')
      .attr('href', ad.targetUrl)
      .addClass('title')
      .text(decodeEntities(ad.title)).appendTo($h3);

    $h3.appendTo($li);

    $cite = uDom(document.createElement('cite')).text(ad.contentData.site);
    $cite.text($cite.text() + ' (#' + ad.id + ')'); // testing-only
    $cite.appendTo($li);

    uDom(document.createElement('div'))
      .addClass('ads-creative')
      .text(ad.contentData.text).appendTo($li);

    $li.appendTo($items);
  }

  var visitedClass = function (ad) {

    return ad.dntAllowed ? 'dnt-allowed' : (ad.visitedTs > 0 ? 'visited' :
      (ad.visitedTs < 0 && ad.attempts >= 3) ? 'failed' : '');
  }

  var visitedCount = function (arr) {

    return (!(arr && arr.length)) ? 0 : arr.filter(function (ad) {
      return ad.visitedTs > 0;
    }).length;
  }

  var getPopupData = function (tabId) {

    var onPopupData = function (response) {
      cachePopupData(response);
      vAPI.messaging.send(
        'adnauseam', {
          what: 'adsForPage',
          tabId: popupData.tabId
        }, renderPage);
    };

    vAPI.messaging.send(
      'popupPanel', {
        what: 'getPopupData',
        tabId: tabId
      }, onPopupData);
  };

  var dval = function () {

    return popupData.pageURL === '' || !popupData.netFilteringSwitch ||
      (popupData.pageHostname === 'behind-the-scene' && !popupData.advancedUserEnabled);
  }

  /******************************************************************************/
  var cachedPopupHash = '',
    hostnameToSortableTokenMap = {},
    popupData = {};

  var scopeToSrcHostnameMap = {
    '/': '*',
    '.': ''
  };

  var cachePopupData = function (data) {

    popupData = {};
    scopeToSrcHostnameMap['.'] = '';
    hostnameToSortableTokenMap = {};

    if (typeof data !== 'object') {
      return popupData;
    }
    popupData = data;
    scopeToSrcHostnameMap['.'] = popupData.pageHostname || '';
    var hostnameDict = popupData.hostnameDict;
    if (typeof hostnameDict !== 'object') {
      return popupData;
    }

    var domain, prefix;
    for (var hostname in hostnameDict) {
      if (hostnameDict.hasOwnProperty(hostname) === false) {
        continue;
      }
      domain = hostnameDict[hostname].domain;
      prefix = hostname.slice(0, 0 - domain.length);
      // Prefix with space char for 1st-party hostnames: this ensure these
      // will come first in list.
      if (domain === popupData.pageDomain) {
        domain = '\u0020';
      }
      hostnameToSortableTokenMap[hostname] = domain + prefix.split('.').reverse().join('.');
    }
    return popupData;
  };

  uDom('#vault-button').on('click', function () {

    vAPI.messaging.send(
      'default', {
        what: 'gotoURL',
        details: {
          url: "vault.html",
          select: true,
          index: -1
        }
      }
    )

    vAPI.closePopup();
  });

  uDom('#settings-open').on('click', function () {

    vAPI.messaging.send(
      'default', {
        what: 'gotoURL',
        details: {
          url: "dashboard.html#options.html",
          select: true,
          index: -1
        }
      }
    );

    vAPI.closePopup();
  });

    uDom('#help-button').on('click', function () {

    vAPI.messaging.send(
      'default', {
        what: 'gotoURL',
        details: {
          url: "https://github.com/dhowe/AdNauseam/wiki/FAQ",
          select: true,
          index: -1
        }
      }
    );

    vAPI.closePopup();
  });

  uDom('#settings-close').on('click', function () {

    uDom('.page').toggleClass('hide');
    uDom('.settings').toggleClass('hide');
  });

  var AboutURL = "https://github.com/dhowe/AdNauseam/wiki/"; // keep

  uDom('#about-button').on('click', function () {

    window.open("./popup.html", '_self');
    //window.open(AboutURL);
  });

  var onHideTooltip = function () {

    uDom.nodeFromId('tooltip').classList.remove('show');
  };

  var onShowTooltip = function () {

    if (popupData.tooltipsDisabled) {
      return;
    }

    var target = this;

    // Tooltip container
    var ttc = uDom(target).ancestors('.tooltipContainer').nodeAt(0) ||
      document.body;
    var ttcRect = ttc.getBoundingClientRect();

    // Tooltip itself
    var tip = uDom.nodeFromId('tooltip');
    tip.textContent = target.getAttribute('data-tip');
    tip.style.removeProperty('top');
    tip.style.removeProperty('bottom');
    ttc.appendChild(tip);

    // Target rect
    var targetRect = target.getBoundingClientRect();

    // Default is "over"
    var pos, over = target.getAttribute('data-tip-position') !== 'under';
    if (over) {
      pos = ttcRect.height - targetRect.top + ttcRect.top;
      tip.style.setProperty('bottom', pos + 'px');
    } else {
      pos = targetRect.bottom - ttcRect.top;
      tip.style.setProperty('top', pos + 'px');
    }

    // Tooltip's horizontal position
    tip.style.setProperty('left', targetRect.left + 'px');

    tip.classList.add('show');
  };

  var toggleEnabled = function (ev) {

    if (!popupData || !popupData.pageURL || (popupData.pageHostname ===
        'behind-the-scene' && !popupData.advancedUserEnabled)) {

      return;
    }

    vAPI.messaging.send(
      'adnauseam', {
        what: 'toggleEnabled',
        url: popupData.pageURL,
        scope: ev.altKey || ev.metaKey ? 'page' : '',
        state: !uDom('#main').toggleClass('disabled').hasClass('disabled'),
        tabId: popupData.tabId
      });

    updateMenuState();
    // hashFromPopupData();
  };

  var adjustBlockHeight = function () {

    // recalculate the height of ad-list
    var h = document.getElementById('notifications').offsetHeight;
    var newh = 350 - h;
    uDom('#ad-list').css('height', newh + 'px');
  };

  var setBackBlockHeight = function () {

    var height = document.getElementById('ad-list').offsetHeight;
    var top = parseInt(uDom('#paused-menu').css('top'));

    var unit = 39;
    height += unit;
    top -= unit;

    uDom('#ad-list').css('height', height + 'px');
    uDom('#paused-menu').css('top', top + 'px');
  };

  /********************************************************************/

  (function () {

    var tabId = null;

    // Extract the tab id of the page this popup is for
    var matches = window.location.search.match(/[\?&]tabId=([^&]+)/);
    if (matches && matches.length === 2) {
      tabId = matches[1];
    }
    getPopupData(tabId);

    uDom('#pause-button').on('click', toggleEnabled);
    uDom('#resume-button').on('click', toggleEnabled);
    uDom('#notifications').on('click', setBackBlockHeight);
    uDom('body').on('mouseenter', '[data-tip]', onShowTooltip)
      .on('mouseleave', '[data-tip]', onHideTooltip);

    // tmp Russian fix
    if (uDom('#vault-button').text() === " Просмотр хранилища рекламы") {
      uDom('#vault-button').css("font-size","14px");
      uDom('#stats').css("font-size","16px");
    }

    // Mobile device?
    // https://github.com/gorhill/uBlock/issues/3032
    // - If at least one of the window's viewport dimension is larger than the
    //   corresponding device's screen dimension, assume uBO's popup panel sits in
    //   its own tab.
    if (
        /[\?&]mobile=1/.test(window.location.search) ||
        window.innerWidth >= window.screen.availWidth ||
        window.innerHeight >= window.screen.availHeight
    ) {
        document.body.classList.add('mobile');
    }


  })();

  /********************************************************************/

})();
