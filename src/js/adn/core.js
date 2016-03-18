/* global vAPI, uDom */

/* TODO

  on-visit: if menu is open, update title & state (also vault)
  recent-ads in menu
  ad-janitor: look for timeouts based on attemptedTs and mark as error?
  delete-ad-set

  traffic.js
    onBeforeRequest
    onBeforeRootFrameRequest
*/

µBlock.adnauseam = (function () {

  'use strict';

  var µb = µBlock;

  /******************************************************************************/

  var xhr,
    idgen,
    inspected,
    admap = {},
    lastActivity = 0,
    autoFailMode = 0,
    clearAdsOnInit = 0,
    pollingDisabled = 0,
    maxAttemptsPerAd = 3,
    visitTimeout = 10000,
    pollQueueInterval = 5000,
    repeatVisitInterval = 60000;

  // ignore adchoices
  var imageIgnores = ['http://pagead2.googlesyndication.com/pagead/images/ad_choices_en.png'];

  // block scripts from these page domains (either regex or string)
  var blockablePageDomains = []; //'www.webpronews.com', 'www.tomshardware.com', 'www.zdnet.com', 'www.techrepublic.com'],

  // always block scripts from these domains (either regex or string)
  var blockableScriptDomains = ['partner.googleadservices.com'];

  var initialize = function (settings) {

    // modify XMLHttpRequest to store original request/ad
    var ads, XMLHttpRequest_open = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.delegate = null; // store ad here
      this.requestUrl = url; // store original target
      return XMLHttpRequest_open.apply(this, arguments);
    };

    admap = (!clearAdsOnInit && settings && settings.admap) || {};
    ads = adlist();

    // compute the highest id in the admap
    idgen = Math.max(0, (Math.max.apply(Math,
      ads.map(function (ad) {
        return ad.id;
      }))));

    console.log('AdNauseam.initialized: with ' + ads.length + ' ads');

    if (!pollingDisabled) pollQueue();
  }

  var pollQueue = function (interval) {

    interval = interval || pollQueueInterval;

    markActivity();

    // TODO check options.disabled (see #40)

    var next, pending = pendingAds();

    if (pending.length) {

      // if an unvisited ad is being inspected, visit it next
      if (visitPending(inspected)) {

        next = inspected;

      } else {

        // else take the most recent ad needing a visit
        next = pending.sort(byField('-foundTs'))[0];
      }

      visitAd(next);
    }

    if (!pollingDisabled) {

      setTimeout(pollQueue, Math.max(1, interval - (millis() - lastActivity))); // next poll
    }
  }

  var markActivity = function () {

    return (lastActivity = millis());
  }

  var pendingAds = function () {

    return adlist().filter(function (a) {
      return visitPending(a);
    });
  }

  var visitPending = function (ad) {

    return ad && ad.attempts < maxAttemptsPerAd && ad.visitedTs <= 0;
  }

  var getVaultTabId = function () {

    var menuUrl = vAPI.getURL('adn-vault.html');
    for (var tabId in µb.pageStores) {
      var pageStore = µb.pageStoreFromTabId(tabId);
      if (pageStore !== null && pageStore.rawURL.startsWith(menuUrl)) {
        return tabId;
      }
    }
  }

  var updateAdOnFailure = function (xhr, e) {

    var ad = xhr.delegate;

    if (ad) {

      // update the ad
      ad.visitedTs = -1 * millis();
      if (!ad.errors) ad.errors = [];
      ad.errors.push(xhr.status + ' (' + xhr.statusText + ')' + (e ? ' ' + e : ''));

      if (ad.attempts >= maxAttemptsPerAd) {
        console.log('GIVEUP: ' + adinfo(ad)); // this);
        if (ad.title === 'Pending') ad.title = 'Failed';
      }

      vAPI.messaging.broadcast({ what: 'adVisited', ad: ad });

    } else {

      console.error("NO Ad in updateAdOnFailure()");
    }
  }

  var updateAdOnSuccess = function (xhr, ad) {

    var ad = xhr.delegate;

    if (ad) {

      var title = xhr.responseText.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (title && title.length > 1) {
        ad.title = unescapeHTML(title[1].trim());
      } else {
        console.warn('Unable to parse title from: ' + html);
      }

      ad.resolvedTargetUrl = xhr.responseURL; // URL after redirects
      ad.visitedTs = millis(); // successful visit time

      vAPI.messaging.broadcast({ what: 'adVisited', ad: ad });

      if (ad === inspected) {
        inspected = null;
      }

      console.log('VISITED: ' + adinfo(ad)); // this);
    }

    storeUserData();
  }

  // returns the current active visit attempt or null
  var activeVisit = function (pageUrl) {
    if (xhr && xhr.delegate) {
      if (!pageUrl || xhr.delegate === pageUrl)
        return xhr.delegate;
    }
  }

  var onVisitError = function (e) {

    this.onload = this.onerror = this.ontimeout = null;

    markActivity();

    // Is it a timeout?
    if (e.type === 'timeout') {

      console.warn('TIMEOUT: visiting ' + this.requestUrl + ' / ' + this.responseURL);

    } else {

      // or some other error?
      console.error('onVisitError()', e, this);
    }

    if (!this.delegate) {

      console.error('Request received without Ad: ' + this.responseUrl);
      return;
    }

    updateAdOnFailure(this, e);

    xhr = null; // end the visit
  };

  var onVisitResponse = function () {

    //console.log('onVisitResponse', this);

    this.onload = this.onerror = this.ontimeout = null;

    markActivity();

    var ad = this.delegate;

    if (!ad) {
      console.error('Request received without Ad: ' + this.responseUrl);
      return;
    }

    if (!ad.id) {
      console.warn("Visit response from deleted ad! ", ad);
      return;
    }

    var status = this.status || 200, html = this.responseText;

    if (autoFailMode || status < 200 || status >= 300 || !stringNotEmpty(html)) {

      return onVisitError.call(this, {
        status: status,
        responseText: html
      });
    }

    updateAdOnSuccess(this, ad);

    xhr = null; // end the visit
  };

  var visitAd = function (ad) {

    var url = ad.targetUrl,
      now = markActivity();

    // tell menu/vault we have a new attempt
    vAPI.messaging.broadcast({ what: 'adAttempt', ad: ad });

    if (xhr) {

      if (!xhr.delegate.attemptedTs) {
        console.log(xhr);
        throw Error('Invalid state: ', xhr);
      }

      var elapsed = (now - xhr.delegate.attemptedTs);

      console.log('Attempt to re-use active xhr: launched ' + elapsed + " ms ago");

      if (elapsed > visitTimeout) {

        return onVisitError.call(xhr, {
          type: 'timeout'
        });
      }
    }

    ad.attempts++;
    ad.attemptedTs = now;

    if (!/^http/.test(url)) { // only visit http/https
      console.warn("Aborting Visit::Bad targetURL: " + url);
      return;
    }

    console.log('TRYING: ' + adinfo(ad));

    sendXhr(url, ad);
  };

  var sendXhr = function(url, ad) {

      //console.log('sendXhr('+url+')');

      xhr = new XMLHttpRequest();

      try {

        xhr.open('get', url, true);
        xhr.delegate = ad;
        xhr.timeout = visitTimeout;
        xhr.onload = onVisitResponse;
        xhr.onerror = onVisitError;
        xhr.ontimeout = onVisitError;
        xhr.responseType = ''; // 'document'?;
        xhr.send();

      } catch (e) {

        onVisitError.call(xhr, e);
      }
  }

  var storeUserData = function (immediate) {

    // TODO: defer if we've recently written and !immediate
    µb.adnSettings.admap = admap;
    vAPI.storage.set(µb.adnSettings);
  }

  var validate = function (ad) {

    if (!/^http/.test(ad.targetUrl)) {

      // Here we try to extract an obfuscated URL
      //console.log("Ad.targetUrl(malformed): " + next.targetUrl);

      var idx = ad.targetUrl.indexOf('http');
      if (idx != -1) {
        ad.targetUrl = decodeURIComponent(ad.targetUrl.substring(idx));
        //console.log("Ad.targetUrl Updated: " + next.targetUrl);

      } else {

        console.warn("Ad.targetUrl(PARSE-FAIL!!!): " + ad.targetUrl);
      }
    }

    ad.title = unescapeHTML(ad.title); // fix to #31
    if (typeof ad.contentData.title !== 'undefined')
      ad.contentData.title = unescapeHTML(ad.contentData.title);
    if (typeof ad.contentData.text !== 'undefined')
      ad.contentData.text = unescapeHTML(ad.contentData.text);
  }

  var clearAdmap = function () {

    var pages = Object.keys(admap);

    for (var i = 0; i < pages.length; i++) {

      if (admap[pages[i]]) {

        var hashes = Object.keys(admap[pages[i]]);

        for (var j = 0; j < hashes.length; j++) {
          var ad = admap[pages[i]][hashes[j]];
          //ad.id = null; // null the id from deleted ads (?)
          delete admap[pages[i]][hashes[j]];
        }
      }

      delete admap[pages[i]];
    }

    admap = {}; // redundant
  }

  var millis = function () {

    return +new Date();
  }

  var adinfo = function (ad) {

    var id = ad.id || -1;
    return 'Ad#' + id + '(' + ad.contentType + ')';
  }

  // sort ads (by found time) for display in menu
  var menuAds = function (pageUrl) {

    return adlist(pageUrl).sort(byField('-foundTs'));
  }

  var unescapeHTML = function (s) { // hack

    var entities = [
      '#39', '\'',
      'apos', '\'',
      'amp', '&',
      'lt', '<',
      'gt', '>',
      'quot', '"',
      '#x27', '\'',
      '#x60', '`'
    ];
    for (var i = 0; i < entities.length; i += 2)
      s = s.replace(new RegExp('&' + entities[i] + ';', 'g'), entities[i + 1]);
    return s;
  }

  var adById = function (id) {

    var list = adlist();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id)
        return list[i];
    }
  }

  var deleteAd = function (id) {

    var ad = adById(id), count = adlist().length;
    if (!ad) console.warn("No Ad to delete", id, admap);
    delete admap[ad.pageUrl][computeHash(ad)];
    if (adlist().length < count) {
        console.log('DELETED: '+adinfo(ad));
    }
    else {
        console.warn('Unable to delete: ', ad);
    }
    storeUserData();
  }

  var adsForUI = function (pageUrl) {

    return {
      data: adlist(),
      pageUrl: pageUrl,
      current: activeVisit()
    };
  }

  /******************************* API ************************************/

  var clearAds = function () {

    var count = adlist().length;
    clearAdmap();
    vAPI.tabs.remove(getVaultTabId()); // close vault
    storeUserData();
    console.log('AdNauseam.clear: ' + count + ' ads cleared');
  }

  // returns all ads for a page, or all pages, if page arg is null
  // called from µb.updateBadgeAsync()
  // TODO: memoize?
  var adlist = function (pageUrl) {

    var result = [],
      pages = pageUrl ? [pageUrl] : Object.keys(admap);

    for (var i = 0; i < pages.length; i++) {

      if (admap[pages[i]]) {
        var hashes = Object.keys(admap[pages[i]]);

        for (var j = 0; j < hashes.length; j++)
          result.push(admap[pages[i]][hashes[j]]);
      }
    }

    return result;
  }

  var importAds = function (request) {

    clearAds();
    admap = request.data;
    storeUserData();

    console.log('AdNauseam.import: ' + adlist().length + ' ads from ' + request.file);
  }

  var exportAds = function (request) {

    var filename = request.filename,
      count = adlist().length;

    vAPI.download({
      'url': 'data:text/plain;charset=utf-8,' +
        encodeURIComponent(JSON.stringify(admap, null, '  ')),
      'filename': filename
    });

    console.log('AdNauseam.export: ' + count + ' ads to ' + filename);
  }

  var adsForPage = function(request, pageStore, tabId) {

      var reqPageStore = request.tabId &&
        µb.pageStoreFromTabId(request.tabId) || pageStore;
      if (!reqPageStore)
        throw Error('No pageStore found!', request, pageStore, tabId);
      return adsForUI(reqPageStore.rawURL);
  }

  var adsForVault = function(request, pageStore, tabId) {

      return adsForUI();
  }

  var itemInspected = function (request, pageStore, tabId) {

    if (request.id) {
      var ad = adById(request.id)
      inspected = ad;
    }
  }

  var deleteAdset = function (request, pageStore, tabId) {

    for (var j = 0; j < request.ids.length; j++) {
      deleteAd(request.ids[j]);
    }
  }

  var registerAd = function (request, pageStore, tabId) {

    var adhash, ad = request.ad,
      pageDomain = pageStore.tabHostname,
      pageUrl = pageStore.rawURL;

    if (!ad) {
        console.warn("No Ad to register!");
        return;
    }

    validate(ad);

    if (!admap[pageUrl]) admap[pageUrl] = {};

    adhash = computeHash(ad);

    if (!adhash) console.warn('UNABLE TO computeHash() for: ',ad);

    if (admap[pageUrl][adhash]) { // this may be a duplicate

      var orig = admap[pageUrl][adhash],
        msSinceFound = millis() - orig.foundTs;

      if (msSinceFound < repeatVisitInterval) {
        console.log('DUPLICATE: ' + adinfo(ad) + ' found ' + msSinceFound + ' ms ago');
        return;
      }
    }

    ad.id = ++idgen;
    ad.attemptedTs = 0;
    ad.pageUrl = pageUrl;
    ad.domain = pageDomain;
    ad.version = vAPI.app.version;

    // this will overwrite an older ad with the same key
    admap[pageUrl][adhash] = ad;

    // if vault/menu is open, send the new ad
    var json = adsForUI(pageUrl);
    json.what = 'adDetected';
    json.ad = ad;

    vAPI.messaging.broadcast(json);

    console.log('DETECTED: ' + adinfo(ad), ad);

    if (µb.userSettings.showIconBadge) {
      µb.updateBadgeAsync(tabId);
    }

    storeUserData();
  };

  //vAPI.storage.clear();
  vAPI.storage.get(µb.adnSettings, initialize);

  /******************************************************************************/

  return {
    adlist: adlist,
    clearAds: clearAds,
    exportAds: exportAds,
    importAds: importAds,
    registerAd: registerAd,
    adsForPage: adsForPage,
    adsForVault: adsForVault,
    deleteAdset: deleteAdset,
    itemInspected: itemInspected
  };

})();

/**************************** override tab.js ****************************/

µBlock.updateBadgeAsync = (function () {

  var tabIdToTimer = Object.create(null);

  var updateBadge = function (tabId) {
    delete tabIdToTimer[tabId];

    var state = false;
    var badge = '';

    var pageStore = this.pageStoreFromTabId(tabId);
    if (pageStore !== null) {
      state = pageStore.getNetFilteringSwitch();

      var count = µBlock.adnauseam.adlist(pageStore.rawURL).length;
      if (state && this.userSettings.showIconBadge) { // only if non-zero?
        badge = this.formatCount(count);
      }
    }

    vAPI.setIcon(tabId, state ? 'on' : 'off', badge);
  };

  return function (tabId) {

    if (tabIdToTimer[tabId] || vAPI.isBehindTheSceneTabId(tabId)) return;
    tabIdToTimer[tabId] = vAPI.setTimeout(updateBadge.bind(this, tabId), 665);
  };
})();

/****************************** messaging ********************************/

(function () {

  'use strict';

  vAPI.messaging.listen('adnauseam', function (request, sender, callback) {

    switch (request.what) {
      default: break;
    } // Async

    var pageStore, tabId;

    if (sender && sender.tab) {
      tabId = sender.tab.id;
      pageStore = µBlock.pageStoreFromTabId(tabId);
    }

    if (typeof µBlock.adnauseam[request.what] === 'function') {

      callback(µBlock.adnauseam[request.what](request, pageStore, tabId));

    } else {

      return vAPI.messaging.UNHANDLED;
    }
  });

})();

/******************************************************************************/
