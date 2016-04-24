/* global vAPI, uDom, $ */
/******************************************************************************/

(function () {

  'use strict';

  var ads, page; // remove? only if we can find an updated ad in the DOM

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

    //disable pause & resume buttons in case of options, vault, browser settings
    if (page === vAPI.getURL("vault.html") ||
          page.indexOf(vAPI.getURL("dashboard.html")) === 0 ||
          page.indexOf("chrome://") === 0 ||
          page.indexOf("about:") === 0) {
          uDom.nodeFromId('pause-button').disabled = true;
          uDom.nodeFromId('resume-button').disabled = true;
        }
    //$("#alert").addClass('hide'); // reset state
    uDom("#alert").addClass('hide'); // reset state
    //$('#main').toggleClass('disabled', dval()); // TODO: move select into dval
    uDom('#main').toggleClass('disabled', dval());

    updateMenuState();

    setCounts(ads, json.data.length);

    var $items = uDom('#ad-list-items');//$('#ad-list-items');

    $items.removeClass().empty();

    if (ads) {

      // if we have no page ads, use the most recent
      if (!ads.length) ads = doRecent(json.data);

      for (var i = 0, j = ads.length; i < j; i++)
        appendAd($items, ads[i]);

      setAttempting(json.current);
    }
  }

  var updateMenuState = function () {

    //if ($('#main').hasClass('disabled')) {
    if(uDom('#main').hasClass('disabled')){

      //$('#resume-button').show();
      uDom('#resume-button').removeClass('hide');
      uDom('#resume-button').addClass('show');
      //$('#pause-button').hide();
      uDom('#pause-button').removeClass('show');
      uDom('#pause-button').addClass('hide');

    } else {

      //$('#pause-button').show();
      uDom('#pause-button').removeClass('hide');
      uDom('#pause-button').addClass('show');
      //$('#resume-button').hide();
      uDom('#resume-button').removeClass('show');
      uDom('#resume-button').addClass('hide');

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

    if (verify(ad)) {

      var $ad = updateAdClasses(ad);

      // update the title
      //$ad.find('.title').text(getTitle(ad));
      $ad.descendants('.title').text(getTitle(ad));

      // update the url
      //$ad.find('cite').text(targetDomain(ad));
      $ad.descendants('cite').text(targetDomain(ad));


      // update the visited count
      if (ad.pageUrl === page) {

        //$('#visited-count').text(visitedCount(ads)); // **uses global ads, page
        uDom('#visited-count').text(visitedCount(ads)); // **uses global ads, page
      }
    }
  }

  var verify = function (ad) { // uses global ads
    if (!ads) err("NO GLOBAL ADS!!!");
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

  /*var filter = function(data, pageUrl) {

    var tmp = data.filter(function (ad) {

      return ad && (!pageUrl || ad.pageUrl === pageUrl) &&
        (prefs.parseTextAds || ad.contentType !== 'text');
    });

    console.log('filter(' + data.length + '): parseText=' + prefs.parseTextAds +
     " pageUrl=" + (pageUrl ? "true" : "false") + " -> " + tmp.length);

    return tmp;
  }*/

  var doRecent = function (data) {

    //$("#alert").removeClass('hide');
    uDom("#alert").removeClass('hide');
    //$('#ad-list-items').addClass('recent-ads');
    uDom('#ad-list-items').addClass('recent-ads');

    return data.sort(byField('-foundTs')).slice(0, 6);
  }

  var onPage = function (ads, pageUrl) {

    var res = [];
    for (var i = 0; i < ads.length; i++) {
      if (ads[i] && ads[i].pageUrl === pageUrl) {
        res.push(ads[i]);
      }
    }
    return res.sort(byField('-foundTs'));
  }

  var appendAd = function ($items, ad) {

    if (ad.contentType === 'img') {

      appendImageAd(ad, $items);

    } else if (ad.contentType === 'text') {

      appendTextAd(ad, $items);
    }
  }

  var removeClassFromAll = function (cls) {

    //$('.ad-item').removeClass(cls);
    uDom('.ad-item').removeClass(cls);
    //$('.ad-item-text').removeClass(cls);
    uDom('.ad-item-text').removeClass(cls);
  }

  var setAttempting = function (ad) {

    // one 'attempt' at a time
    removeClassFromAll('attempting');

    if (ad) {
      if (verify(ad))
        //$('#ad' + ad.id).addClass('attempting');
        uDom('#ad' + ad.id).addClass('attempting');
      else
        console.warn('Fail on setAttempting: ', ad);
    }
  }

  var updateAdClasses = function (ad) {

    var $ad = uDom('#ad' + ad.id);//$('#ad' + ad.id);

    // allow only one just-* at a time...
    removeClassFromAll('just-visited just-failed');

    // See https://github.com/dhowe/AdNauseam2/issues/61
    var cls = ad.visitedTs > 0 ? 'just-visited' : 'just-failed';
    $ad.removeClass('failed visited attempting').addClass(cls);

    // timed for animation
    setTimeout(function () {
      $ad.addClass(visitedClass(ad));
    }, 300);

    return $ad;
  }

  var setCounts = function (ads, total) {

    //console.log('setCounts: '+visited+"/"+found+' of '+total+' total');
    //$('#vault-count').text(total);
    uDom('#vault-count').text(total);
    //$('#visited-count').text(visitedCount(ads));
    uDom('#visited-count').text(visitedCount(ads));
    //$('#found-count').text(ads.length);
    uDom('#found-count').text(ads.length);
  }

  var appendImageAd = function (ad, $items) {

    var $img, $a, $span, $li = uDom(document.createElement('li'))
    .attr('id','ad' + ad.id)
    .addClass(('ad-item ' + visitedClass(ad)).trim());

    /*$('<li/>', {

      'id': 'ad' + ad.id,
      'class': ('ad-item ' + visitedClass(ad)).trim()
    });*/

    $a = uDom(document.createElement('a'))
    .attr('target','new')
    .attr('href',ad.targetUrl);

    /*$('<a/>', {

      'target': 'new',
      'href': ad.targetUrl
    });*/

    $span = uDom(document.createElement('span')).addClass('thumb');
    $span.appendTo($a);
    /*$span = $('<span/>', {
      'class': 'thumb'
    });*/
    $img = uDom(document.createElement('img'))
    .attr('src',(ad.contentData.src || ad.contentData))
    .addClass('ad-item-img')
    .on('click',"this.onerror=null; this.width=50; this.height=45; this.src='img/placeholder.svg'");

    $img.appendTo($span);
    /*$('<img/>', {

      'src': (ad.contentData.src || ad.contentData),
      'class': 'ad-item-img',
      'onerror': "this.onerror=null; this.width=50; " +
        "this.height=45; this.src='img/placeholder.svg'",

    }).appendTo($span);*/

    $span.appendTo($a);

    /*$('<span/>', {

      'class': 'title',
      'text': (ad.title ? ad.title : "#" + ad.id)

    }).appendTo($a);*/
    uDom(document.createElement('span'))
    .addClass('title')
    .text(ad.title ? ad.title : "#" + ad.id)
    .appendTo($a);

    /*$('<cite/>', {
      'text': targetDomain(ad)
    }).appendTo($a);*/
    uDom(document.createElement('cite'))
    .text(targetDomain(ad))
    .appendTo($a);

    $a.appendTo($li);
    $li.appendTo($items);
  }

  var appendTextAd = function (ad, $items) {

    var $cite, $h3, $li = uDom(document.createElement('li'))
    .attr('id','ad' + ad.id)
    .addClass(('ad-item-text ' + visitedClass(ad)).trim());

    /*$('<li/>', {

      'id': 'ad' + ad.id,
      'class': ('ad-item-text ' + visitedClass(ad)).trim()
    });*/
    uDom(document.createElement('span'))
    .addClass('thumb')
    .text('Text Ad').appendTo($li);
    /*$('<span/>', {

      'class': 'thumb',
      'text': 'Text Ad'

    }).appendTo($li);*/

    $h3 = uDom(document.createElement('h3'));
    //$('<h3/>');

    uDom(document.createElement('a'))
    .attr('target','new')
    .attr('href',ad.targetUrl)
    .addClass('title')
    .text(ad.title).appendTo($h3);
    /*$('<a/>', {

      'target': 'new',
      'class': 'title',
      'href': ad.targetUrl,
      'text': ad.title

    }).appendTo($h3);*/

    $h3.appendTo($li);

    /*$cite = $('<cite/>', {
      'text': ad.contentData.site
    });*/
    $cite = uDom(document.createElement('cite')).text(ad.contentData.site);

    $cite.text($cite.text() + ' (#' + ad.id + ')'); // testing-only

    $cite.appendTo($li);

    uDom(document.createElement('div'))
    .addClass('ads-creative')
    .text(ad.contentData.text).appendTo($li);
    /*$('<div/>', {

      'class': 'ads-creative',
      'text': ad.contentData.text

    }).appendTo($li);*/

    $li.appendTo($items);
  }

  var visitedClass = function (ad) {

    return ad.visitedTs > 0 ? 'visited' :
      (ad.visitedTs < 0 && ad.attempts >= 3) ? 'failed' : '';
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

  //$('#vault-button').click(
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

  //$('#settings-open')
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

  //$('#settings-close')
  uDom('#settings-close').on('click', function () {

    //$('.page').toggleClass('hide');
    uDom('.page').toggleClass('hide');
    //$('.settings').toggleClass('hide');
    uDom('.settings').toggleClass('hide');
  });

  var AboutURL = "https://github.com/dhowe/AdNauseam/wiki/FAQ"; // keep

  //$('#about-button')
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
    var pos;
    var over = target.getAttribute('data-tip-position') !== 'under';
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

    //console.log('toggleEnabled', ev);

    if (!popupData || !popupData.pageURL || (popupData.pageHostname ===
        'behind-the-scene' && !popupData.advancedUserEnabled)) {

      return;
    }

    vAPI.messaging.send(
      'adnauseam', {
        what: 'toggleEnabled',
        url: popupData.pageURL,
        scope: ev.ctrlKey || ev.metaKey ? 'page' : '',
        state: !uDom('#main').toggleClass('disabled').hasClass('disabled'),
        tabId: popupData.tabId
      });

    updateMenuState();
    //hashFromPopupData();
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
    uDom('body').on('mouseenter', '[data-tip]', onShowTooltip)
                .on('mouseleave', '[data-tip]', onHideTooltip);
  })();

  /********************************************************************/

})();
