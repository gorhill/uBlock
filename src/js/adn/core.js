/* global vAPI, uDom */

/* TODO

  on-visit: if menu is open, update title & state (also vault)
  recent-ads in menu
  ad-janitor: look for timeouts based on attemptedTs and mark as error?
  delete-ad-set

  traffic.js
    onBeforeRequest
    onBeforeRootFrameRequest

  visit fails: adVisited
*/

µBlock.adnauseam = (function () {

  'use strict';

  var µb = µBlock;

  // debugging only
  var autoFailMode = 0, // all visits will fail
    clearAdsOnInit = 0, // start with zero ads
    testVisitMode = 0, // all visit data is reset
    automatedMode = 0; // for automated testing

  var xhr,
    idgen,
    inspected,
    admap = {},
    lastActivity = 0,
    pollingDisabled = 0,
    maxAttemptsPerAd = 3,
    visitTimeout = 20000,
    pollQueueInterval = 5000,
    repeatVisitInterval = 60000;

  // ignore adchoices
  var imageIgnores = ['http://pagead2.googlesyndication.com/pagead/images/ad_choices_en.png'];

  // block scripts from these page domains (either regex or string) // add to rules
  var blockablePageDomains = []; //'www.webpronews.com', 'www.tomshardware.com', 'www.zdnet.com', 'www.techrepublic.com'],

  // always block scripts from these domains (either regex or string)
  var blockableScriptDomains = ['partner.googleadservices.com']; // add to rules

  // mark ad visits as failure if any of these are included in title
  var errorStrings = ['file not found', 'website is currently unavailable'];

  var initialize = function (settings) {

    // modify XMLHttpRequest to store original request/ad
    var ads, XMLHttpRequest_open = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method, url) {

      this.delegate = null; // store ad here
      this.requestUrl = url; // store original target
      return XMLHttpRequest_open.apply(this, arguments);
    };

    admap = (!clearAdsOnInit && settings && settings.admap) || {};
    checkAdStorage(ads = adlist());

    if (testVisitMode) {

      console.warn("[WARN] Clearing all Ad visit data!");
      ads.forEach(function (ad) {
        ad.visitedTs = 0;
        ad.attempts = 0
      });
    }

    // compute the highest id in the admap
    idgen = Math.max(0, (Math.max.apply(Math,
      ads.map(function (ad) {
        return ad ? ad.id : -1;
      }))));

    console.log('AdNauseam.initialized: with ' + ads.length + ' ads');

    if (!pollingDisabled) pollQueue();
  }

  // make sure we have no bad data in ad storage (should be impossible)
  var checkAdStorage = function (ads) {

    for (var i = 0; i < ads.length; i++) {

      if (!validateFields(ads[i])) {

        console.warn('Invalid ad in storage', allAds[i]);
      }

      if (ads[i].visitedTs === 0 && ads[i].attempts) {

        console.warn('Invalid visitTs/attempts pair', ads[i]);
        ads[i].attempts = 0; // this shouldn't happen
      }
    }
  }

  var pollQueue = function (interval) {

    interval = interval || pollQueueInterval;

    markActivity();

    // TODO check options.disabled (see #40)

    var next, nextMs, pending = pendingAds();

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

      nextMs = Math.max(1, interval - (millis() - lastActivity));
      setTimeout(pollQueue, nextMs); // next poll
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

    var menuUrl = vAPI.getURL('vault.html');

    for (var tabId in µb.pageStores) {

      var pageStore = µb.pageStoreFromTabId(tabId);
      if (pageStore !== null && pageStore.rawURL.startsWith(menuUrl)) {

        return tabId;
      }
    }
  }

  var updateAdOnFailure = function (xhr, e) {

    var ad = xhr.delegate;

    if (ad && ad.visitedTs <= 0) { // make sure we haven't visited already

      // update the ad
      ad.visitedTs = -millis();
      if (!ad.errors) ad.errors = [];
      ad.errors.push(xhr.status + ' (' + xhr.statusText + ')' + (e ? ' ' + e.type : ''));

      if (ad.attempts >= maxAttemptsPerAd) {

        console.log('GIVEUP: ' + adinfo(ad), ad); // this);
        if (ad.title === 'Pending') ad.title = 'Failed';
      }

      vAPI.messaging.broadcast({
        what: 'adVisited',
        ad: ad
      });

    } else {

      console.error("NO Ad in updateAdOnFailure()", xhr, e);
    }
  }

  var parseTitle = function (xhr) {

    var title = xhr.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (title && title.length > 1) {

      return unescapeHTML(title[1].trim());

    } else {
      console.warn('Unable to parse title from: ' + xhr.responseText);
    }

    return false;
  }

  var updateAdOnSuccess = function (xhr, ad, title) {

    var ad = xhr.delegate;

    if (ad) {

      if (title) ad.title = title;

      ad.resolvedTargetUrl = xhr.responseURL; // URL after redirects
      ad.visitedTs = millis(); // successful visit time

      vAPI.messaging.broadcast({
        what: 'adVisited',
        ad: ad
      });

      if (ad === inspected) inspected = null;

      console.log('VISITED: ' + adinfo(ad), ad.title);
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

      console.warn('TIMEOUT: visiting ', this.requestUrl, e, this);

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

    var status = this.status || 200,
      html = this.responseText;

    if (autoFailMode || status < 200 || status >= 300 || !stringNotEmpty(html)) {

      return onVisitError.call(this, {
        status: status,
        responseText: html
      });
    }

    var title = parseTitle(html);
    if (title) {

      for (var i = 0; i < errorStrings.length; i++) {

        if (title.toLowerCase().indexOf(errorStrings[i]) > -1) {

          return onVisitError.call(this, {
            title: title,
            status: status,
            responseText: html
          });
        }
      }
    }

    updateAdOnSuccess(this, ad, title);

    xhr = null; // end the visit
  };

  var visitAd = function (ad) {

    var url = ad.targetUrl,
      now = markActivity();

    // tell menu/vault we have a new attempt
    vAPI.messaging.broadcast({
      what: 'adAttempt',
      ad: ad
    });

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

    if (!validateTarget(ad)) return deleteAd(ad);

    return sendXhr(ad);
  };

  var sendXhr = function (ad) {

    console.log('TRYING: ' + adinfo(ad), ad.targetUrl);

    xhr = new XMLHttpRequest();

    try {

      xhr.open('get', ad.targetUrl, true);
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

  var validateTarget = function (ad) {

    var url = ad.targetUrl;

    if (!/^http/.test(url)) {

      // Here we try to extract an obfuscated URL
      var idx = url.indexOf('http');
      if (idx != -1) {

        ad.targetUrl = decodeURIComponent(url.substring(idx));
        console.log("Ad.targetUrl updated: " + ad.targetUrl);

      } else {

        console.warn("Invalid TargetUrl: " + url);
        return false;
      }
    }

    return true;
  }

  var validateFields = function (ad) {

    return ad && type(ad) === 'object' &&
      type(ad.pageUrl) === 'string' &&
      type(ad.contentType) === 'string' &&
      type(ad.contentData) === 'object';
  }

  var validate = function (ad) {

    if (!validateFields(ad)) {
      console.warn('validateFields: ',ad);
      return false;
    }

    ad.title = unescapeHTML(ad.title); // fix to #31

    if (ad.contentType === 'text') {

      ad.contentData.title = unescapeHTML(ad.contentData.title);
      ad.contentData.text = unescapeHTML(ad.contentData.text);

    } else if (ad.contentType === 'img') {

      if (!/^http/.test(ad.contentData.src) && !/^data:image/.test(ad.contentData.src)) {

        console.log("Relative-image: " + ad.contentData.src);
        ad.contentData.src = ad.pageUrl.substring(0, ad.pageUrl.lastIndexOf('/')) + '/' + ad.contentData.src;

        console.log("    --> " + ad.contentData.src);
      }

    } else {

      console.warn('Invalid ad type: ' + ad.contentType);
    }

    return validateTarget(ad);
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

    var id = ad.id || '?';
    return 'Ad#' + id + '(' + ad.contentType + ')';
  }

  // sort ads (by found time) for display in menu
  var menuAds = function (pageUrl) {

    return adlist(pageUrl).sort(byField('-foundTs'));
  }

  var unescapeHTML = function (s) { // hack

    if (s && s.length) {
      var entities = [
        '#0*32', ' ',
        '#0*33', '!',
        '#0*34', '"',
        '#0*35', '#',
        '#0*36', '$',
        '#0*37', '%',
        '#0*38', '&',
        '#0*39', '\'',
        'apos', '\'',
        'amp', '&',
        'lt', '<',
        'gt', '>',
        'quot', '"',
        '#x27', '\'',
        '#x60', '`'
      ];

      for (var i = 0; i < entities.length; i += 2) {
        s = s.replace(new RegExp('\&' + entities[i] + ';', 'g'), entities[i + 1]);
      }
    }

    return s;
  }

  var adById = function (id) {

    var list = adlist();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id)
        return list[i];
    }
  }

  var closeVault = function () {

    for (var tabId in µb.pageStores) {

      var pageStore = µb.pageStoreFromTabId(tabId);
      if (pageStore && pageStore.rawURL.indexOf("vault.html") >= 0) {
        try {
          vAPI.tabs.remove(tabId, true);
        } catch (e) {
          console.error(e);
        }
      }
    }
  }

  var deleteAd = function (arg) {

    var ad = type(arg) === 'object' ? arg : adById(arg),
      count = adlist().length;

    if (!ad) console.warn("No Ad to delete", id, admap);

    delete admap[ad.pageUrl][computeHash(ad)];

    if (adlist().length < count) {

      console.log('DELETED: ' + adinfo(ad));
      updateBadges();
    } else {
      console.warn('Unable to delete: ', ad);
    }

    storeUserData();
  }

  var scriptPrefs = function () {

    // preferences relevant to our content/ui-scripts
    return {
      parseTextAds: µb.userSettings.parseTextAds
    };
  }

  var adsForUI = function (pageUrl) {

    return {
      data: adlist(),
      pageUrl: pageUrl,
      prefs: scriptPrefs(),
      current: activeVisit()
    };
  }
  var validateImport = function (map) {

    if (type(map) !== 'object')
      return false;

    var pass = 0,
      newmap = {},
      pages = Object.keys(map);

    for (var i = 0; i < pages.length; i++) {

      if (type(map[pages[i]]) !== 'object')
        return false;

      var hashes = Object.keys(map[pages[i]]);
      for (var j = 0; j < hashes.length; j++) {

        if (type(hashes[j]) !== 'string' || hashes[j].indexOf('::') < 0) {

          console.warn('Bad hash in import: ', hashes[j], ad); // tmp
          return false;
        }

        var ad = map[pages[i]][hashes[j]];
        if (validateFields(ad)) {

          if (!newmap[pages[i]]) newmap[pages[i]] = {};
          newmap[pages[i]][hashes[j]] = ad;
          pass++;

        } else {

          console.warn('Invalid ad in import: ', ad); // tmp
        }
      }
    }

    return pass ? newmap : false;
  }

  var validateAdArray = function (map) { // not used

    var newmap = {},
      ads = map;

    for (var j = 0; j < ads.length; j++) {

      var ad = ads[j],
        hash = computeHash(ad);

      if (!validateFields(ad)) {
        console.warn('Unable to validate legacy ad', ad);
        continue;
      }

      var page = ad.pageUrl;
      if (!newmap[page]) newmap[page] = {};
      newmap[page][hash] = updateLegacyAd(ad);

      console.log('converted ad', newmap[page][hash]);
    }

    return newmap;
  }

  var validateLegacyImport = function (map) {

    if (type(map) !== 'object') {

      console.warn('not object: ', map);
      return false;
    }

    var newmap = {},
      pages = Object.keys(map);

    if (!pages || !pages.length) {
      console.warn('no pages: ', pages);
      return false;
    }

    for (var i = 0; i < pages.length; i++) {

      var ads = map[pages[i]];

      if (type(ads) === 'array') {

        console.warn('not array', type(ads), ads);
        return false;
      }

      newmap[pages[i]] = {};

      for (var j = 0; j < ads.length; j++) {

        var ad = ads[j],
          hash = computeHash(ad);

        if (!hash || !validateFields(ad)) {

          console.warn('Unable to validate legacy ad', ad);
          continue;
        }

        newmap[pages[i]][hash] = updateLegacyAd(ad);

        console.log('converted ad', newmap[pages[i]][hash]);
      }
    }

    return newmap;
  }

  var updateLegacyAd = function (ad) {

    // a new id to avoid conflicts
    ad.id = ++idgen;
    ad.attemptedTs = 0;
    ad.version = vAPI.app.version;
    ad.attempts = ad.attempts || 0;
    if (!ad.errors || !ad.errors.length)
      ad.errors = null;
    delete ad.hashkey;
    delete ad.path;

    return ad;
  }

  /******************************* API ************************************/

  var clearAds = function () {

    var count = adlist().length;

    clearAdmap();
    updateBadges();
    closeVault();
    storeUserData();

    console.log('AdNauseam.clear: ' + count + ' ads cleared');
  }

  var updateBadges = function () {

    // update badges if we are showing them
    if (µb.userSettings.showIconBadge) {

      // get all open tabs
      for (var tabId in µb.pageStores) {

        var pageStore = µb.pageStoreFromTabId(tabId);

        // update the badge icon if its not the settings tab
        if (pageStore && pageStore.rawURL.indexOf("options.html") < 0) {

          try {
            vAPI.setIcon(tabId, 'on', adlist(pageStore.rawURL).length.toString());
          } catch (e) {
            console.error(e);
          }
        }
      }
    }
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

    // try to parse imported ads in current format
    var legacy, map = validateImport(request.data);

    if (!map) {

      // no good, try to parse in legacy-format
      map = validateLegacyImport(request.data);

      if (map) {

        // check that legacy ads were converted ok
        map = validateImport(map);
        if (map) {

          // ok, legacy ads converted and verified
          console.log('Updating legacy ads to current format');
        }

      } else {

        console.warn('Unable to parse legacy-format:', request.data);
        return; // give up
      }
    }

    clearAds();
    admap = map;
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

  var adsForPage = function (request, pageStore, tabId) {

    var reqPageStore = request.tabId &&
      µb.pageStoreFromTabId(request.tabId) || pageStore;

    if (!reqPageStore)
      throw Error('No pageStore found!', request, pageStore, tabId);

    return adsForUI(reqPageStore.rawURL);
  }

  var adsForVault = function (request, pageStore, tabId) {

    return adsForUI();
  }

  var itemInspected = function (request, pageStore, tabId) {

    if (request.id) {
      var ad = adById(request.id)
      inspected = ad;
    }
  }

  var getPreferences = function (request, pageStore, tabId) {

    return scriptPrefs();
  }

  var logAdSet = function (request, pageStore, tabId) {

    var data = '';

    for (var j = 0; j < request.ids.length; j++) {

      data += JSON.stringify(adById(request.ids[j]));
    }

    console.log('ADSET #' + request.gid + '\n', data);

    vAPI.messaging.broadcast({
      what: 'logJSON',
      data: data
    });

    return data;
  }

  var deleteAdSet = function (request, pageStore, tabId) {

    for (var j = 0; j < request.ids.length; j++) {
      deleteAd(request.ids[j]);
    }
  }

  var registerAd = function (request, pageStore, tabId) {

    var json, adhash, msSinceFound, orig,
      pageUrl = pageStore.rawURL,
      ad = request.ad;

    ad.attemptedTs = 0;
    ad.pageUrl = pageUrl;
    ad.pageTitle = pageStore.title;
    ad.domain = pageStore.tabHostname;
    ad.version = vAPI.app.version;

    if (!ad || !validate(ad)) {

      console.warn("Invalid Ad: ", ad);
      return;
    }

    if (!admap[pageUrl]) admap[pageUrl] = {};

    adhash = computeHash(ad);

    if (admap[pageUrl][adhash]) { // may be a duplicate

      orig = admap[pageUrl][adhash];
      msSinceFound = millis() - orig.foundTs;

      if (msSinceFound < repeatVisitInterval) {

        console.log('DUPLICATE: ' + adinfo(ad) + ' found ' + msSinceFound + ' ms ago');
        return;
      }
    }

    ad.id = ++idgen; // gets an id only if its not a duplicate

    // this will overwrite an older ad with the same key
    admap[pageUrl][adhash] = ad;

    // if vault/menu is open, send the new ad
    json = adsForUI(pageUrl);
    json.what = 'adDetected';
    json.ad = ad;

    if (automatedMode) json.automated = true;

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
    logAdSet: logAdSet,
    clearAds: clearAds,
    exportAds: exportAds,
    importAds: importAds,
    registerAd: registerAd,
    adsForPage: adsForPage,
    adsForVault: adsForVault,
    deleteAdSet: deleteAdSet,
    itemInspected: itemInspected,
    getPreferences: getPreferences
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
