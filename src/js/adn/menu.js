/* global vAPI, uDom, $ */
/******************************************************************************/

(function () {

  'use strict';

  var ads, page; // can we remove? only if we can find an updated ad in the DOM

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
    }
  });

  /******************************************************************************/

  var renderPage = function (json) {

    page = json.pageUrl;
    ads = onPage(json.data, page);

    setCounts(ads, json.data.length);

    var $items = $('#ad-list-items');

    $items.removeClass().empty();

    if (ads) {

      // if we have no page ads, use the most recent
      if (!ads.length) ads = doRecent(json.data);

      for (var i = 0, j = ads.length; i < j; i++)
        appendAd($items, ads[i]);

      setAttempting(json.current);
    }
  }

  function getTitle(ad) {

    var title = ad.title + ' ';
    if (ad.visitedTs < 1) {

      // adds . to title for each failed attempt
      for (var i = 0; i < ad.attempts; i++)
        title += '.';
    }
    return title;
  }

  function updateAd(ad) { // update class, title, counts

    if (verify(ad)) {

      var $ad = updateAdClasses(ad);

      // update the title
      $ad.find('.title').text(getTitle(ad));

      // update the url
      $ad.find('cite').text(targetDomain(ad));

      // update the visited count
      if (ad.pageUrl === page)
        $('#visited-count').text(visitedCount(ads)); // **uses global ads, page
    }
  }

  function verify(ad) { // uses global ads (can be removed)

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

  function doRecent(data) {

    $("#alert").removeClass('hide');
    $('#ad-list-items').addClass('recent-ads');
    return data.sort(byField('-foundTs')).slice(0, 6);
  }

  function onPage(ads, pageUrl) {

    var res = [];
    for (var i = 0; i < ads.length; i++) {
      if (ads[i] && ads[i].pageUrl === pageUrl)
        res.push(ads[i]);
    }

    return res.sort(byField('-foundTs'));
  }

  function appendAd($items, ad) {

    if (ad.contentType === 'img') {

      appendImageAd(ad, $items);

    } else if (ad.contentType === 'text') {

      appendTextAd(ad, $items);
    }
  }

  function setAttempting(ad) {

    // one 'attempt' at a time
    $('.ad-item').removeClass('attempting');
    $('.ad-item-text').removeClass('attempting');

    if (ad) {
      if (verify(ad))
        $('#ad' + ad.id).addClass('attempting');
      else
        console.warn('Fail on setAttempting: ', ad, ads);
    }
  }

  function updateAdClasses(ad) {

    var $ad = $('#ad' + ad.id),
      jv = 'just-visited';

    // See https://github.com/dhowe/AdNauseam2/issues/61
    $ad.removeClass('failed visited attempting');
    $ad.removeClass(jv).addClass(jv);

    // timed for animation
    setTimeout(function () {
      $ad.addClass(visitedClass(ad));
    }, 300);

    return $ad;
  }

  function setCounts(ads, total) {

    //console.log('setCounts: '+visited+"/"+found+' of '+total+' total');
    $('#vault-count').text(total);
    $('#visited-count').text(visitedCount(ads));
    $('#found-count').text(ads.length);
  }

  function appendImageAd(ad, $items) {

    var $a, $span, $li = $('<li/>', {

      'id': 'ad' + ad.id,
      'class': ('ad-item ' + visitedClass(ad)).trim()
    });

    $a = $('<a/>', {

      'target': 'new',
      'href': ad.targetUrl
    });

    $span = $('<span/>', {
      'class': 'thumb'
    });

    $('<img/>', {

      'src': (ad.contentData.src || ad.contentData),
      'class': 'ad-item-img',
      'onerror': "this.onerror=null; this.width=50; " +
        "this.height=45; this.src='img/placeholder.svg'",

    }).appendTo($span);

    $span.appendTo($a);

    $('<span/>', {

      'class': 'title',
      'text': (ad.title ? ad.title : "#" + ad.id)

    }).appendTo($a);

    $('<cite/>', {
      'text': targetDomain(ad)
    }).appendTo($a);

    $a.appendTo($li);
    $li.appendTo($items);
  }

  function appendTextAd(ad, $items) {

    var $cite, $h3, $li = $('<li/>', {

      'id': 'ad' + ad.id,
      'class': ('ad-item-text ' + visitedClass(ad)).trim()
    });

    $('<span/>', {

      'class': 'thumb',
      'text': 'Text Ad'

    }).appendTo($li);

    $h3 = $('<h3/>');

    $('<a/>', {

      'target': 'new',
      'class': 'title',
      'href': ad.targetUrl,
      'text': ad.title

    }).appendTo($h3);

    $h3.appendTo($li);

    $cite = $('<cite/>', {
      'text': ad.contentData.site
    });

    $cite.text($cite.text() + ' (#' + ad.id + ')'); // testing-only

    $cite.appendTo($li);

    $('<div/>', {

      'class': 'ads-creative',
      'text': ad.contentData.text

    }).appendTo($li);

    $li.appendTo($items);
  }

  function visitedClass(ad) {

    return ad.visitedTs > 0 ? 'visited' :
      (ad.visitedTs < 0 ? 'failed' : '');
  }

  function visitedCount(arr) {

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

  var hashFromPopupData = function (reset) {
    // It makes no sense to offer to refresh the behind-the-scene scope
    if (popupData.pageHostname === 'behind-the-scene') {
      uDom('body').toggleClass('dirty', false);
      return;
    }

    var hasher = [];
    var rules = popupData.firewallRules;
    var rule;
    for (var key in rules) {
      if (rules.hasOwnProperty(key) === false) {
        continue;
      }
      rule = rules[key];
      if (rule !== '') {
        hasher.push(rule);
      }
    }
    hasher.sort();
    hasher.push(uDom('body').hasClass('off'));
    hasher.push(uDom.nodeFromId('no-large-media').classList.contains('on'));
    hasher.push(uDom.nodeFromId('no-cosmetic-filtering').classList.contains('on'));
    hasher.push(uDom.nodeFromId('no-remote-fonts').classList.contains('on'));

    var hash = hasher.join('');
    if (reset) {
      cachedPopupHash = hash;
    }
    uDom('body').toggleClass('dirty', hash !== cachedPopupHash);
  };

  // $('#log-button').click(function () {
  //
  //   window.open("./log.html");
  // });

  $('#vault-button').click(function () {

    vAPI.messaging.send(
        'default',
        {
            what: 'gotoURL',
            details: {
                url: "vault.html",
                select: true,
                index: -1
            }
        }
    );

    vAPI.closePopup();
  });

  $('#pause-button').click(function () {

      // Waiting on #46
  });

  $('#settings-open').click(function () {

    vAPI.messaging.send(
        'default',
        {
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

  $('#settings-close').click(function () {

    $('.page').toggleClass('hide');
    $('.settings').toggleClass('hide');
  });

  var AboutURL = "https://github.com/dhowe/AdNauseam/wiki/FAQ";

  $('#about-button').click(function () {

    window.open("./popup.html", '_self');
    //window.open(AboutURL);
  });

  (function () {

    var tabId = null;
    // Extract the tab id of the page this popup is for
    var matches = window.location.search.match(/[\?&]tabId=([^&]+)/);
    if (matches && matches.length === 2) {
      tabId = matches[1];
    }
    getPopupData(tabId);

  })();

  /********************************************************************/

})();
