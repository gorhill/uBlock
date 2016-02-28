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
    idgen = 0,
    admap = {},
    initialized = 0,
    lastActivity = 0,
    visitTimeout = 5000,
    pollingDisabled = 0,
    maxAttemptsPerAd = 3,
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
    var XMLHttpRequest_open = XMLHttpRequest.prototype.open, ads;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.delegate = null; // store ad here
      this.requestUrl = url; // store original target
      return XMLHttpRequest_open.apply(this, arguments);
    };

    admap = (settings && settings.admap) || {};
    ads = adlist();

    // compute the highest id in the admap
    idgen = Math.max(0, (Math.max.apply(Math,
      ads.map(function (ad) { return ad.id; }))));

    initialized = +new Date();

    console.log('AdNauseam.initialized: with ' + ads.length + ' ads');

    if (!pollingDisabled) pollQueue();
  }

  var pollQueue = function (interval) {

    interval = interval || pollQueueInterval;

    markActivity();

    // TODO check options.disabled (see #40)

    var pending = pendingAds();

    if (pending.length) {

      var next = pending.sort(byField('-foundTs'))[0];
      visitAd(next);
    }

    if (!pollingDisabled)
      setTimeout(pollQueue, Math.max(1, interval - (millis() - lastActivity))); // next poll
  }

  var markActivity = function () {

    return (lastActivity = millis());
  }

  var pendingAds = function () {

    return adlist().filter(function (a) {
      return a.visitedTs === 0 ||
        (a.visitedTs < 0 && a.attempts < maxAttemptsPerAd);
    });
  }

  var updateAd = function (xhr, ad) {

    var title = xhr.responseText.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (title && title.length > 1) {
      ad.title = unescapeHTML(title[1].trim());
    } else {
      console.warn('Unable to parse title from: ' + html);
    }

    ad.resolvedTargetUrl = xhr.responseURL; // URL after redirects
    ad.visitedTs = millis(); // successful visit time
  }

  // returns the current active visit attempt or null
  var activeVisit = function () {
    return xhr ? xhr.delegate : null;
  }

  // returns the current active visit attempt or null
  var activeVisitX = function () {

    var list = adlist();

    //console.log('activeVisit: '+list.length+' ads');

    var ads = list.filter(function (ad) {
      //console.log(ad.attemptedTs+' >? '+Math.abs(ad.visitedTs));
      return ad.attemptedTs > Math.abs(ad.visitedTs);
    });

    if (ads.length > 1)
      console.warn("Multiple active ad visit attempts!");

    var result = ads.length ? ads[0] : undefined;

    //console.log('activeVisit: ',result);
  }

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

    var status = this.status || 200,
      html = this.responseText;
    if (status < 200 || status >= 300 || !stringNotEmpty(html)) {
      return onVisitError.call(this, {
        status: status,
        responseText: html
      });
    }

    updateAd(this, ad);

    console.log('VISITED: ' + adinfo(ad)); // this);

    storeUserData();

    xhr = null; // end the visit
  };

  var onVisitError = function (e) {

    this.onload = this.onerror = this.ontimeout = null;

    markActivity();

    // Is it a timeout?
    if (e.type === 'timeout') {
      //this.statusText = 'Timeout(' + visitTimeout +')';
      console.warn('TIMEOUT: visiting ' + this.requestUrl + ' / ' + this.responseURL);
    } else {
      // or some other error?
      console.error('onVisitError()', e, this);
    }

    var ad = this.delegate;

    if (!ad) {
      console.error('Request received without Ad: ' + this.responseUrl);
      return;
    }

    // update the ad
    ad.visitedTs = -1 * millis();
    if (!ad.errors) ad.errors = [];
    ad.errors.push(this.status + ' (' + this.statusText + ')' + (e ? ' ' + e : ''));

    if (ad.attempts >= maxAttemptsPerAd)
      console.log('GIVEUP: ' + adinfo(ad)); // this);

    xhr = null; // end the visit
  };

  var visitAd = function (ad) {

    var url = ad.targetUrl,
      now = markActivity();

    //if (ad.attempts == maxAttemptsPerAd) return false;// double-check

    // TODO: tell menu/vault we have a new 'current'
    //UIManager.updateOnAdAttempt(next);

    if (xhr) {

      if (!xhr.delegate.attemptedTs) {
          console.log(xhr);
          throw Error('Invalid state: ', xhr);
      }

      var elapsed = (now - xhr.delegate.attemptedTs);

      console.log('Attempt to re-use active xhr: launched ' + elapsed + " ms ago");

      if (elapsed > visitTimeout) {
        return onVisitError.call(xhr, { type: 'timeout' });
      }
    }

    ad.attempts++;
    ad.attemptedTs = now;

    if (!/^http/.test(url)) { // only visit http/https
      console.warn("Aborting Visit::Bad targetURL: " + url);
      return;
    }

    xhr = new XMLHttpRequest(); // store one of these?

    //visitmap[url] = ad; // legacy

    console.log('TRYING: ' + adinfo(ad)); // this);

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
  };

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
          ad.id = null; // null the id from deleted ads (?)
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
    return 'Ad#' + ad.id + '(' + ad.contentType + ')';
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
      for (var i = 0; i < entities.length; i+=2)
          s = s.replace(new RegExp('&'+entities[i]+';', 'g'), entities[i+1]);
      return s;
  }

  /******************************* API ************************************/

  var clearAds = function () {

    var count = adlist().length;
    clearAdmap();
    storeUserData();
    console.log('AdNauseam.clear: ' + count + ' ads cleared');
  }

  // returns all ads for a page, or all pages, if page arg is null
  // called from µb.updateBadgeAsync()
  // TODO: memoize
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

  var adsForVault = function () {

    return {
      data: adlist(),
      current: activeVisit()
    };
  }

  var adsForMenu = function (request, pageStore, tabId) {

    var reqPageStore = request.tabId && µb.pageStoreFromTabId(request.tabId) || pageStore;

    if (!reqPageStore)
      throw Error('No pageStore found!', request, pageStore, tabId);

    var pageUrl = reqPageStore.rawURL,
      current = activeVisit(),
      data = menuAds(pageUrl);

    if (current && current.pageUrl === pageUrl) { // make sure current is at top (do we really need this?)

      if (current !== data[0]) {

          //console.log("Re-ordering menu list");
          var idx = -1;
          for (var i = 0; i < data.length; i++) {
            if (current.id === data[i].id) idx = i;
          }
          if (idx >= 0) data.splice(idx, 1);
          data.unshift(current);
      }

      //console.log('CURRENT', '#' + current.id, data);
    }

    return {
      data: data,
      current: current,
      total: adlist().length
    };
  }

  var registerAd = function (request, pageStore, tabId) {

    var ad = request.ad,
      pageUrl = pageStore.rawURL,
      pageDomain = pageStore.tabHostname;

    validate(ad);

    var adsOnPage = admap[pageUrl];

    if (!adsOnPage)
      admap[pageUrl] = (adsOnPage = {});

    var adhash = computeHash(ad);

    if (adsOnPage[adhash]) { // this may be a duplicate

      var orig = adsOnPage[adhash],
        msSinceFound = millis() - orig.foundTs;

      if (msSinceFound < repeatVisitInterval) {
        console.log('DUPLICATE: ' + adinfo(ad) + ' found ' + msSinceFound + ' ms ago');
        return;
      }
    }

    ad.id = ++idgen;
    ad.attemptedTs = 0;
    ad.domain = pageDomain;
    ad.pageUrl = pageUrl;

    // this will overwrite an older ad with the same key
    adsOnPage[adhash] = ad;

    console.log('DETECTED: ' + adinfo(ad), ad);

    if ( µb.userSettings.showIconBadge ) {
        µb.updateBadgeAsync(tabId);
    }

    storeUserData();

    return ad;
  };

  //vAPI.storage.clear();
  vAPI.storage.get(µb.adnSettings, initialize);

  /******************************************************************************/

  return {
    //updateBadge: updateBadge,
    adlist: adlist,
    clearAds: clearAds,
    exportAds: exportAds,
    importAds: importAds,
    registerAd: registerAd,
    adsForMenu: adsForMenu,
    adsForVault: adsForVault
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
    tabIdToTimer[tabId] = vAPI.setTimeout(updateBadge.bind(this, tabId), 666);
  };
})();

/****************************** messaging ********************************/

(function () {

  'use strict';

  vAPI.messaging.listen('adnauseam', function (request, sender, callback) {

    switch (request.what) { default: break; } // Async

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
