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

  let ads, page, settings; // remove? only if we can find an updated ad already in the DOM

  vAPI.broadcastListener.add(request => {

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

  const renderPage = function (json) {

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

    ads = json && json.data;

    setCounts(ads, json && json.data && json.total, json.recent);

    const $items = uDom('#ad-list-items');

    $items.removeClass().empty();

    layoutAds(json);

    vAPI.messaging.send(
      'adnauseam', {
        what: 'verifyAdBlockersAndDNT',
        url: page
      }).then(details => {
        vAPI.messaging.send(
          'adnauseam', {
            what: 'getNotifications'
          }).then(notifications => {
              renderNotifications(notifications);
          })
      })

  }

  const updateMenuState = function () {

    if (uDom('#main').hasClass('disabled')) {

      uDom('#resume-button').removeClass('hide').addClass('show');
      uDom('#pause-button').removeClass('show').addClass('hide');

    } else {

      uDom('#pause-button').removeClass('hide').addClass('show');
      uDom('#resume-button').removeClass('show').addClass('hide');
    }
  }

  const setCounts = function (ads, total, recent) {

    const numVisits = recent ? 0 : (visitedCount(ads) || 0);
    uDom('#vault-count').text(total || 0);

    uDom('#visited').text(vAPI.i18n("adnMenuAdsClicked").replace("{{number}}", numVisits || 0));
    uDom('#found').text(vAPI.i18n("adnMenuAdsDetected").replace("{{count}}", (ads && !recent) ? ads.length : 0));
    setCost(numVisits);
  }

  const updateInterface = function (json) {

    const page = json.pageUrl;

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
    uDom('#visited').text(vAPI.i18n("adnMenuAdsClicked").replace("{{number}}", numVisits || 0));
    uDom('#found').text(vAPI.i18n("adnMenuAdsDetected").replace("{{count}}", ads ? ads.length : 0));
    //console.log("FOUND: " + ads.length);
  };

  const layoutAds = function (json) {

    const $items = uDom('#ad-list-items');
    $items.removeClass().empty();

    let ads = json.data;
    if (ads) {

      if (json.recent) doRecent();

      for (let i = 0, j = ads.length; i < j; i++)
        appendAd($items, ads[i]);

      setAttempting(json.current);
    }
  };

  const getTitle = function (ad) {

    let title = ad.title + ' ';
    if (ad.visitedTs < 1) {

      // adds . to title for each failed attempt
      for (let i = 0; i < ad.attempts; i++)
        title += '.';
    }
    return title;
  };

  const updateAd = function (ad) { // update class, title, counts
    // console.log(ad);
    if (verify(ad)) {

      const $ad = updateAdClasses(ad);

      // update the title
      $ad.descendants('.title').text(decodeEntities(getTitle(ad)));

      // update the url
      $ad.descendants('cite').text(targetDomain(ad));

      // update the visited count
      if (ad.pageUrl === page) { // global page here

        const numVisits = visitedCount(ads);
        uDom('#visited').text(vAPI.i18n("adnMenuAdsClicked").replace("{{number}}", numVisits || 0));
        setCost(numVisits);
      }
    }
  }

  const verify = function (ad) { // uses global ads

    if (!ads) console.error("NO GLOBAL ADS!!!");

    if (ad) {

      for (let i = 0; i < ads.length; i++) {

        if (ads[i].id === ad.id) {
          ads[i] = ad;
          return true;
        }
      }
    }

    return false;
  }

  const doRecent = function () {
    uDom("#alert").removeClass('hide');
    uDom('#ad-list-items').addClass('recent-ads');
  }

  const appendAd = function ($items, ad) {
    if(ad.private) return; // skip private ads

    if (ad.contentType === 'img') {

      appendImageAd(ad, $items);

    } else if (ad.contentType === 'text') {

      appendTextAd(ad, $items);
    }
  }

  const removeClassFromAll = function (cls) {

    uDom('.ad-item').removeClass(cls);
    uDom('.ad-item-text').removeClass(cls);
  };

  const setAttempting = function (ad) {

    // one 'attempt' at a time
    removeClassFromAll('attempting');

    if (verify(ad)) {
      uDom('#ad' + ad.id).addClass('attempting');
    }
  }

  const updateAdClasses = function (ad) {

    const $ad = uDom('#ad' + ad.id); //$('#ad' + ad.id);

    // allow only one just-* at a time...
    removeClassFromAll('just-visited just-failed');

    // See https://github.com/dhowe/AdNauseam/issues/61
    const cls = ad.visitedTs > 0 ? 'just-visited' : 'just-failed';
    // Update the status
    const txt = cls === 'just-visited' ? 'visited' : 'failed';
    $ad.descendants('.adStatus').text(txt);

    $ad.removeClass('failed visited attempting').addClass(cls);

    // timed for animation
    setTimeout(function () {
      $ad.addClass(visitedClass(ad));
    }, 300);

    return $ad;
  }

  const appendImageAd = function (ad, $items) {
    let $img;
    let $a;
    let $span;
    let $status;

    const $li = uDom(document.createElement('li'))
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

  const appendAdStatus = function(ad, parent) {
    const $status = uDom(document.createElement('span'))
        .addClass('adStatus').text(vAPI.i18n("adnAdClickingStatus" + adStatus(ad)));
    $status.appendTo(parent);

  }

  const adStatus = function (ad) {

    let status = settings.clickingDisabled ? "SkippedDisabled" : "Pending";

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

  const appendTextAd = function (ad, $items) {
    let $cite;
    let $h3;
    let $status;

    const $li = uDom(document.createElement('li'))
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
    if(ad.contentData.site) {
      $cite = uDom(document.createElement('cite')).text(ad.contentData.site);
      $cite.text($cite.text() + ' (#' + ad.id + ')'); // testing-only
      $cite.appendTo($li);
    }

    uDom(document.createElement('div'))
      .addClass('ads-creative')
      .text(ad.contentData.text).appendTo($li);

    $li.appendTo($items);
  }

  const visitedClass = function (ad) {

    return ad.dntAllowed ? 'dnt-allowed' : (ad.visitedTs > 0 ? 'visited' :
      (ad.visitedTs < 0 && ad.attempts >= 3) ? 'failed' : '');
  }

  const visitedCount = function (arr) {

    return (!(arr && arr.length)) ? 0 : arr.filter(function (ad) {
      return ad.visitedTs > 0;
    }).length;
  }

  const getPopupData = function (tabId) {

    const onPopupData = function (response) {
      cachePopupData(response);
      vAPI.messaging.send(
        'adnauseam', {
          what: 'adsForPage',
          tabId: popupData.tabId
        }).then(details => {
            renderPage(details);
        })
    };

    vAPI.messaging.send(
      'popupPanel', {
        what: 'getPopupData',
        tabId: tabId
      }).then(details => {
          onPopupData(details);
      })
  };

  const dval = function () {

    return popupData.pageURL === '' || !popupData.netFilteringSwitch ||
      (popupData.pageHostname === 'behind-the-scene' && !popupData.advancedUserEnabled);
  }

  /******************************************************************************/
  const cachedPopupHash = '';

  let hostnameToSortableTokenMap = {};
  let popupData = {};

  const scopeToSrcHostnameMap = {
    '/': '*',
    '.': ''
  };

  const cachePopupData = function (data) {

    popupData = {};
    scopeToSrcHostnameMap['.'] = '';
    hostnameToSortableTokenMap = {};

    if (typeof data !== 'object') {
      return popupData;
    }
    popupData = data;
    scopeToSrcHostnameMap['.'] = popupData.pageHostname || '';
    const hostnameDict = popupData.hostnameDict;
    if (typeof hostnameDict !== 'object') {
      return popupData;
    }

    let domain, prefix;
    for (const hostname in hostnameDict) {
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

  const AboutURL = "https://github.com/dhowe/AdNauseam/wiki/"; // keep

  uDom('#about-button').on('click', function () {

    window.open("./popup-fenix.html", '_self');
    //window.open(AboutURL);
  });

  const onHideTooltip = function () {

    uDom.nodeFromId('tooltip').classList.remove('show');
  };

  const onShowTooltip = function () {
    if (popupData.tooltipsDisabled) {
      return;
    }

    const target = this;

    // Tooltip container
    const ttc = uDom(target).ancestors('.tooltipContainer').nodeAt(0) ||
      document.body;
    const ttcRect = ttc.getBoundingClientRect();

    // Tooltip itself
    const tip = uDom.nodeFromId('tooltip');
    tip.textContent = target.getAttribute('data-tip');
    tip.style.removeProperty('top');
    tip.style.removeProperty('bottom');
    ttc.appendChild(tip);

    // Target rect
    const targetRect = target.getBoundingClientRect();

    // Default is "over"
    let pos;

    const over = target.getAttribute('data-tip-position') !== 'under';
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

  const toggleEnabled = function (ev) {

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

  const adjustBlockHeight = function () {

    // recalculate the height of ad-list
    const h = document.getElementById('notifications').offsetHeight;
    const newh = 350 - h;
    uDom('#ad-list').css('height', newh + 'px');
  };

  const setBackBlockHeight = function () {

    let height = document.getElementById('ad-list').offsetHeight;
    let top = parseInt(uDom('#paused-menu').css('top'));

    const unit = 39;
    height += unit;
    top -= unit;

    uDom('#ad-list').css('height', height + 'px');
    uDom('#paused-menu').css('top', top + 'px');
  };

  /********************************************************************/

  (function () {

    let tabId = null;

    // Extract the tab id of the page this popup is for
    const matches = window.location.search.match(/[\?&]tabId=([^&]+)/);
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
