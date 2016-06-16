/* global vAPI, µBlock */

µBlock.adnauseam = (function () {

  'use strict';

  // for debugging only
  var failAllVisits = 0, // all visits will fail
    clearAdsOnInit = 0, // start with zero ads
    clearVisitData = 0, // reset all ad visit data
    automatedMode = 0, // for automated testing
    logBlocks = 0; // tmp: for testing list-blocking

  var xhr, idgen, admap, inspected, listEntries,
    µb = µBlock,
    production = 0,
    lastActivity = 0,
    maxAttemptsPerAd = 3,
    visitTimeout = 20000,
    profiler = +new Date(),
    pollQueueInterval = 5000,
    strictBlockingDisabled = false,
    repeatVisitInterval = Number.MAX_VALUE;

  // mark ad visits as failure if any of these are included in title
  var errorStrings = ['file not found', 'website is currently unavailable'];

  var enabledBlockLists = ['EasyPrivacy', 'uBlock filters – Badware risks',
    'Malware domains', 'Malware Domain List'
  ]; // 'uBlock filters – Unbreak', 'uBlock filters – Privacy' ];

  // rules from EasyPrivacy we need to ignore (TODO: prune in load?)
  var disabledBlockingRules = ['||googleadservices.com^$third-party',
    '||pixanalytics.com^$third-party', '||stats.g.doubleclick.net^'
  ];

  var reSpecialChars = /[\*\^\t\v\n]/;

  /**************************** functions ******************************/

  /* called when the addon is first loaded */
  var initialize = function (settings) {

    // modify XMLHttpRequest to store original request/ad
    var ads, XMLHttpRequest_open = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method, url) {

      this.delegate = null; // store ad here
      this.requestUrl = url; // store original target
      return XMLHttpRequest_open.apply(this, arguments);
    };

    if (production) { // disable all test-modes if production

      failAllVisits = clearVisitData = automatedMode = clearAdsOnInit = 0;
    }

    admap = (settings && settings.admap) || {};
    ads = validateAdStorage();
    computeNextId(ads);

    log('AdNauseam.initialized: with ' + ads.length + ' ads');

    setTimeout(pollQueue, pollQueueInterval * 2);
  }

  var clearAdVisits = function (ads) {

    warn("[WARN] Clearing all Ad visit data!");

    ads.forEach(function (ad) {

      ad.visitedTs = 0;
      ad.attempts = 0
    });
  }

  /* make sure we have no bad data in ad storage */
  var validateAdStorage = function () {

    var ads = adlist(),
      i = ads.length;

    if (clearAdsOnInit) {

      setTimeout(function () {

        warn("[DEBUG] Clearing all ad data!");
        clearAds();

      }, 2000);

      return ads;
    }

    clearVisitData && clearAdVisits(ads);

    while (i--) {

      if (!validateFields(ads[i])) {

        warn('Invalid ad in storage', ads[i]);
        ads.splice(i, 1);
        continue;
      }

      if (ads[i].visitedTs === 0 && ads[i].attempts) {

        warn('Invalid visitTs/attempts pair', ads[i]);
        ads[i].attempts = 0; // this shouldn't happen
      }
    }

    return ads;
  }

  // compute the highest id still in the admap
  var computeNextId = function (ads) {

    ads = ads || adlist();
    idgen = Math.max(0, (Math.max.apply(Math,
      ads.map(function (ad) {
        return ad ? ad.id : -1;
      }))));
  }

  var pollQueue = function (interval) {

    interval = interval || pollQueueInterval;

    markActivity();

    var next, pending = pendingAds();

    if (pending.length && µb.userSettings.clickingAds) {

      // if an unvisited ad is being inspected, visit it next
      if (visitPending(inspected)) {

        next = inspected;

      } else {

        // else take the most recent ad needing a visit
        next = pending.sort(byField('-foundTs'))[0];
      }

      visitAd(next);
    }

    // next poll
    setTimeout(pollQueue, Math.max(1, interval - (millis() - lastActivity)));
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

  var getExtPageTabId = function (htmlPage) {

    var pageUrl = vAPI.getURL(htmlPage);

    for (var tabId in µb.pageStores) {

      var pageStore = µb.pageStoreFromTabId(tabId);

      if (pageStore !== null && pageStore.rawURL.startsWith(pageUrl))
        return tabId;
    }
  }

  var updateAdOnFailure = function (xhr, e) {

    var ad = xhr.delegate;

    if (ad && ad.visitedTs <= 0) { // make sure we haven't visited already

      // update the ad
      ad.visitedTs = -millis();

      if (!ad.errors) ad.errors = [];
      ad.errors.push(xhr.status + ' (' +
        xhr.statusText + ')' + (e ? ' ' + e.type : ''));

      if (ad.attempts >= maxAttemptsPerAd) {

        log('GIVEUP: ' + adinfo(ad), ad); // this);
        if (ad.title === 'Pending') ad.title = 'Failed';
      }

      vAPI.messaging.broadcast({
        what: 'adVisited',
        ad: ad
      });

    } else {

      err("No Ad in updateAdOnFailure()", xhr, e);
    }
  }

  var parseTitle = function (xhr) {

    var html = xhr.responseText,
      title = html.match(/<title[^>]*>([^<]+)<\/title>/i);

    if (title && title.length > 1) {

      title = unescapeHTML(title[1].trim());

      for (var i = 0; i < errorStrings.length; i++) {

        // check the title isn't something like 'file not found'
        if (title.toLowerCase().indexOf(errorStrings[i]) > -1) {

          onVisitError.call(xhr, {
            title: title,
            status: xhr.status,
            responseText: html
          });

          throw Error('Bad-title: ' + title + " from: " + xhr.requestUrl);
        }
      }

      return title;
    }

    warn('Unable to parse title from: ' + xhr.requestUrl, html);

    return false;
  }

  var updateAdOnSuccess = function (xhr, ad, title) {

    var ad = xhr.delegate;

    if (ad) {

      if (title) ad.title = title;

      // TODO: if title still = 'Pending' here, replace it with the hostname
      if (ad.title === 'Pending') {

        ad.title = parseDomain(xhr.requestUrl, true);
        warn('replaced "Pending" with: ' + ad.title);
      }

      ad.resolvedTargetUrl = xhr.responseURL; // URL after redirects
      ad.visitedTs = millis(); // successful visit time

      vAPI.messaging.broadcast({
        what: 'adVisited',
        ad: ad
      });

      if (ad === inspected) inspected = null;

      log('VISITED: ' + adinfo(ad), ad.title);
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

      warn('TIMEOUT: visiting ', this.requestUrl, e, this);

    } else {

      // or some other error?
      warn('onVisitError()', e, this);
    }

    if (!this.delegate) {

      err('Request received without Ad: ' + this.responseURL);
      return;
    }

    updateAdOnFailure(this, e);

    xhr = null; // end the visit
  };

  var onVisitResponse = function () {

    /*if (this.responseURL==='http://rednoise.org/adntest/headers.php') // tmp
        log('onVisitResponseHeaders\n', this.responseText);*/

    this.onload = this.onerror = this.ontimeout = null;

    markActivity();

    var ad = this.delegate;

    if (!ad) {

      err('Request received without Ad: ' + this.responseURL);
      return;
    }

    if (!ad.id) {

      warn("Visit response from deleted ad! ", ad);
      return;
    }

    ad.attemptedTs = 0; // reset as visit no longer in progress

    var status = this.status || 200,
      html = this.responseText;

    if (failAllVisits || status < 200 || status >= 300 || !stringNotEmpty(html)) {

      return onVisitError.call(this, {
        status: status,
        responseText: html
      });
    }

    try {
      updateAdOnSuccess(this, ad, parseTitle(this));

    } catch (e) {

      warn(e.message);
    }

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
        log(xhr);
        throw Error('Invalid state: ', xhr);
      }

      var elapsed = (now - xhr.delegate.attemptedTs);

      log('Attempt to re-use active xhr: launched ' + elapsed + " ms ago");

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

    log('TRYING: ' + adinfo(ad), ad.targetUrl);

    xhr = new XMLHttpRequest();

    try {

      xhr.open('get', ad.targetUrl, true);
      xhr.withCredentials = true;
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
    µb.userSettings.admap = admap;
    vAPI.storage.set(µb.userSettings);
  }

  var validateTarget = function (ad) {

    var url = ad.targetUrl;

    if (!/^http/.test(url)) {

      // Here we try to extract an obfuscated URL
      var idx = url.indexOf('http');
      if (idx != -1) {

        ad.targetUrl = decodeURIComponent(url.substring(idx));
        log("Ad.targetUrl updated: " + ad.targetUrl);

      } else {

        warn("Invalid TargetUrl: " + url);
        return false;
      }
    }

    if (0 && targetDomain(ad) === ad.pageDomain) { // disabled for now

      log('Ignoring ad with internal targetUrl: ', ad.targetUrl + ' ?= ' + ad.pageDomain, ad);
      return false;
    }

    return true;
  }

  var validateFields = function (ad) { // no side-effects

    return ad && type(ad) === 'object' &&
      type(ad.pageUrl) === 'string' &&
      type(ad.contentType) === 'string' &&
      type(ad.contentData) === 'object';
  }

  var validate = function (ad) {

    if (!validateFields(ad)) {

      warn('Invalid ad-fields: ', ad);
      return false;
    }

    var cd = ad.contentData,
      ct = ad.contentType,
      pu = ad.pageUrl;

    ad.title = unescapeHTML(ad.title); // fix to #31

    if (ct === 'text') {

      cd.title = unescapeHTML(cd.title);
      cd.text = unescapeHTML(cd.text);

    } else if (ct === 'img') {

      if (!/^http/.test(cd.src) && !/^data:image/.test(cd.src)) {

        if (/^\/\//.test(cd.src)) {

          cd.src = 'http:' + cd.src;

        } else {

          log("Relative-image: " + cd.src);
          cd.src = pu.substring(0, pu.lastIndexOf('/')) + '/' + cd.src;
          log("    --> " + cd.src);
        }
      }

    } else {

      warn('Invalid ad type: ' + ct);
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

  var closeExtPage = function (htmlPage) {

    var tabId = getExtPageTabId(htmlPage)
    tabId && vAPI.tabs.remove(tabId, true);
  }

  var reloadExtPage = function (htmlPage) {

    var tabId = getExtPageTabId(htmlPage)
    tabId && vAPI.tabs.reload(tabId);
  }

  var deleteAd = function (arg) {

    var ad = type(arg) === 'object' ? arg : adById(arg),
      count = adlist().length;

    if (!ad) warn("No Ad to delete", id, admap);

    if (admap[ad.pageUrl]) {

      var hash = computeHash(ad);

      if (admap[ad.pageUrl][hash]) {

        delete admap[ad.pageUrl][hash];
      } else {
        warn('Unable to find ad: ', ad, admap);
      }
    }

    if (adlist().length < count) {

      log('DELETED: ' + adinfo(ad));
      updateBadges();

    } else {

      warn('Unable to delete: ', ad);
    }

    storeUserData();
  }

  var log = function () {
    !production && console.log.apply(console, arguments);
    return true;
  }

  var warn = function () {
    !production && console.warn.apply(console, arguments);
    return false;
  }

  var err = function () {
    console.error.apply(console, arguments);
    return false;
  }

  var contentPrefs = function () {

    // preferences relevant to our content/ui-scripts
    return {

      automated: automatedMode,
      hidingDisabled: !µb.userSettings.hidingAds,
      clickingDisabled: !µb.userSettings.clickingAds,
      textAdsDisabled: !µb.userSettings.parseTextAds
    };
  }

  var adsForUI = function (pageUrl) {

    return {
      data: adlist(),
      pageUrl: pageUrl,
      prefs: contentPrefs(),
      current: activeVisit()
    };
  }

  var validateImport = function (map, replaceAll) {

    if (type(map) !== 'object')
      return false;

    var pass = 0,
      newmap = replaceAll ? {} : admap,
      pages = Object.keys(map);

    for (var i = 0; i < pages.length; i++) {

      if (type(map[pages[i]]) !== 'object')
        return false;

      var hashes = Object.keys(map[pages[i]]);
      for (var j = 0; j < hashes.length; j++) {

        if (type(hashes[j]) !== 'string' || hashes[j].indexOf('::') < 0) {

          warn('Bad hash in import: ', hashes[j], ad); // tmp
          return false;
        }

        var ad = map[pages[i]][hashes[j]];
        if (validateFields(ad)) {

          if (!newmap[pages[i]]) newmap[pages[i]] = {};
          newmap[pages[i]][hashes[j]] = ad;
          pass++;

        } else {

          warn('Invalid ad in import: ', ad); // tmp
        }
      }
    }

    return pass ? newmap : false;
  }

  var validateAdArray = function (ads, replaceAll) {

    var map = replaceAll ? {} : admap;

    for (var j = 0; j < ads.length; j++) {

      var ad = updateLegacyAd(ads[j]),
        hash = computeHash(ad);

      if (!validateFields(ad)) {

        warn('Unable to validate legacy ad', ad);
        continue;
      }

      var page = ad.pageUrl;
      if (!map[page]) map[page] = {};
      map[page][hash] = ad;

      //console.log('converted ad', map[page][hash]);
    }

    return map;
  }

  var validateLegacyImport = function (map) {

    if (type(map) !== 'object') {

      return (type(map) === 'array') ? validateAdArray(map) :
        warn('Import-fail: not object or array', type(map), map);
    }

    var ad, ads, hash, newmap = {},
      pages = Object.keys(map);

    if (!pages || !pages.length) {

      warn('no pages: ', pages);
      return false;
    }

    for (var i = 0; i < pages.length; i++) {

      ads = map[pages[i]];

      if (type(ads) !== 'array') {

        warn('not array', type(ads), ads);
        return false;
      }

      newmap[pages[i]] = {};

      for (var j = 0; j < ads.length; j++) {

        ad = updateLegacyAd(ads[j]);
        hash = computeHash(ad);

        if (!validateFields(ad)) {

          warn('Unable to validate legacy ad', ad);
          continue;
        }

        newmap[pages[i]][hash] = ad;

        //log('converted ad', newmap[pages[i]][hash]);
      }
    }

    return newmap;
  }

  var updateLegacyAd = function (ad) {

    ad.id = ++idgen;
    ad.attemptedTs = 0;
    ad.version = vAPI.app.version;
    ad.attempts = ad.attempts || 0;
    ad.pageDomain = parseDomain(ad.pageUrl) || ad.pageUrl;
    if (!ad.errors || !ad.errors.length)
      ad.errors = null;
    delete ad.hashkey;
    delete ad.path;

    return ad;
  }

  var postRegister = function (ad, pageUrl, tabId) {

    log('DETECTED: ' + adinfo(ad), ad);

    // if vault/menu is open, send the new ad
    var json = adsForUI(pageUrl);
    json.what = 'adDetected';
    json.ad = ad;

    if (automatedMode) json.automated = true;

    vAPI.messaging.broadcast(json);

    if (µb.userSettings.showIconBadge)
      µb.updateBadgeAsync(tabId);

    storeUserData();
  }

  var activeBlockList = function (test) {

    return enabledBlockLists.indexOf(test) > -1;
  }

  var ruleDisabled = function (test) {

    return disabledBlockingRules.indexOf(test) > -1;
  };

  /******************************* API ************************************/

  var clearAds = function () {

    var pre = adlist().length;

    clearAdmap();
    closeExtPage('vault.html');
    updateBadges();
    storeUserData();
    computeNextId();

    log('AdNauseam.clear: ' + pre + ' ads cleared');
  }

  // update tab badges if we're showing them
  var updateBadges = function () {

    if (µb.userSettings.showIconBadge) {

      var optionsUrl = vAPI.getURL('options.html');

      for (var tabId in µb.pageStores) {

        var store = µb.pageStoreFromTabId(tabId);
        if (store !== null && !store.rawURL.startsWith(optionsUrl))
          µb.updateBadgeAsync(tabId);
      }
    }
  }

  /*
   Returns all ads for a page, or all pages, if page arg is null
   Omits text-ads if specified in preferences
   Called also from tab.js::µb.updateBadgeAsync()
   */
  var adlist = function (pageUrl) {

    var result = [],
      pages = pageUrl ? [pageUrl] : Object.keys(admap);

    //    if (µb.userSettings.hidingAds) {

    for (var i = 0; i < pages.length; i++) {

      if (admap[pages[i]]) {

        var hashes = Object.keys(admap[pages[i]]);

        for (var j = 0; j < hashes.length; j++) {

          var ad = admap[pages[i]][hashes[j]];

          // ignore text-ads according to parseTextAds prefe
          if (ad && (µb.userSettings.parseTextAds || ad.contentType !== 'text'))
            result.push(ad);
        }
      }
    }
    //}

    return result;
  }

  var importAds = function (request) {

    // try to parse imported ads in current format
    var count = adlist().length,
      importedCount = 0,
      map = validateImport(request.data);

    if (!map) {

      // no good, try to parse in legacy-format
      map = validateLegacyImport(request.data);

      if (map) {

        // check that legacy ads were converted ok
        map = validateImport(map);
        if (map) {

          // ok, legacy ads converted and verified
          log('Updating legacy ads to current format');
        }

      } else {

        warn('Unable to parse legacy-format:', request.data);
        return { // give up and show 0 ads imported
          what: 'importConfirm',
          count: 0
        };
      }
    }

    //clearAds();
    admap = map;
    computeNextId();
    clearVisitData && clearAdVisits(ads);
    storeUserData();

    importedCount = adlist().length - count;

    log('AdNauseam.import: ' + importedCount + ' ads from ' + request.file);

    // reload Vault page
    reloadExtPage('vault.html');

    return {
      what: 'importConfirm',
      count: importedCount
    };
  }

  var exportAds = function (request) {

    var count = adlist().length,
      filename = (request && request.filename) || getExportFileName();

    vAPI.download({
      'url': 'data:text/plain;charset=utf-8,' +
        encodeURIComponent(JSON.stringify(admap, null, '  ')),
      'filename': filename
    });

    log('AdNauseam.export: ' + count + ' ads to ' + filename);
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

  var logAdSet = function (request, pageStore, tabId) {

    var data = '';

    request.ids.forEach(function (id) {
      data += JSON.stringify(adById(id));
    });

    log('ADSET #' + request.gid + '\n', data);

    vAPI.messaging.broadcast({
      what: 'logJSON',
      data: data
    });

    return data;
  }

  var toggleEnabled = function (request, pageStore, tabId) {

    var store = µb.pageStoreFromTabId(request.tabId);
    if (store) {

      store.toggleNetFilteringSwitch(request.url, request.scope, request.state);
      updateBadges();

      // close whitelist if open (see gh #113)
      var wlId = getExtPageTabId("dashboard.html#whitelist.html")
      wlId && vAPI.tabs.replace(wlId, vAPI.getURL("dashboard.html"));
    }
  }

  var deleteAdSet = function (request, pageStore, tabId) {

    request.ids.forEach(function (id) {
      deleteAd(id);
    });
  }

  var registerAd = function (request, pageStore, tabId) {

    var json, adhash, msSinceFound, orig,
      pageUrl = pageStore.rawURL,
      ad = request.ad;

    ad.attemptedTs = 0;
    ad.pageUrl = pageUrl;
    ad.pageTitle = pageStore.title;
    ad.pageDomain = pageStore.tabHostname;
    ad.version = vAPI.app.version;

    if (!validate(ad)) {

      warn("Invalid Ad: ", ad);
      return;
    }

    if (!admap[pageUrl]) admap[pageUrl] = {};

    adhash = computeHash(ad);

    if (admap[pageUrl][adhash]) { // may be a duplicate

      orig = admap[pageUrl][adhash];
      msSinceFound = millis() - orig.foundTs;

      if (msSinceFound < repeatVisitInterval) {

        log('DUPLICATE: ' + adinfo(ad) + ' found ' + msSinceFound + ' ms ago');
        return;
      }
    }

    ad.id = ++idgen; // gets an id only if its not a duplicate

    // this will overwrite an older ad with the same key
    admap[pageUrl][adhash] = ad;

    postRegister(ad, pageUrl, tabId);
  };

  var fromNetFilterSync = function (compiledFilter, rawFilter) {

    var entry, content, pos, c, lists = [];

    for (var path in listEntries) {

      entry = listEntries[path];
      //console.log(entry);
      if (entry === undefined) {
        continue;
      }
      content = entry.content;
      pos = content.indexOf(compiledFilter);
      if (pos === -1) {
        continue;
      }
      // We need an exact match.
      // https://github.com/gorhill/uBlock/issues/1392
      if (pos !== 0 && reSpecialChars.test(content.charAt(pos - 1)) === false) {
        continue;
      }
      // https://github.com/gorhill/uBlock/issues/835
      c = content.charAt(pos + compiledFilter.length);
      if (c !== '' && reSpecialChars.test(c) === false) {
        continue;
      }
      lists.push({
        title: entry.title,
        supportURL: entry.supportURL
      });
    }

    return lists;
  };

  var domainCosmeticSelectors = function (request, pageStore, tabId) {

    var response;
    if (pageStore && pageStore.getNetFilteringSwitch()) {
      response = µb.cosmeticFilteringEngine.retrieveDomainSelectors(request);
      if (response) {
        if (response.skipCosmeticFiltering !== true) {
          response.skipCosmeticFiltering = !pageStore.getSpecificCosmeticFilteringSwitch();// || !µb.userSettings.hidingAds; // adn
        }
        response.prefs = contentPrefs();
      }
    }
    //console.log('domainCosmeticSelectors', response.prefs);
    return response;
  }

  var isBlockableRequest = function (result, requestURL, isTop) {

    if (strictBlockingDisabled && µb.userSettings.blockingMalware) {
      var compiled = result.slice(3),
        snfe = µb.staticNetFilteringEngine,
        raw = snfe.filterStringFromCompiled(compiled),
        hits = fromNetFilterSync(compiled, raw);

      //console.log('isBlockableRequest',requestURL, compiled);

      if (hits && hits.length) {

        if (!activeBlockList(hits[0].title) || ruleDisabled(raw)) {

          return false; //log("Reject-block: " + title, raw);

        } else logBlocks && log("[BLOCK" + (isTop ? '-MAIN] ' : '] ') + hits[0].title + ' ' + raw + ': ', requestURL);

      } else warn("NO hits ****", raw, compiled);

    } else logBlocks && warn("[ALLOW] blocking-off or loading: ",requestURL);

    return true;
  }

  /******************************************************************************/

  // start by grabbing user-settings, then calling initialize()
  vAPI.storage.get(µb.userSettings, function (settings) {

    //this for backwards compatibility
    var mapSz = Object.keys(settings.admap).length;
    if (!mapSz && µb.adnSettings && µb.adnSettings.admap) {

      settings.admap = µb.adnSettings.admap;
      log("Using legacy admap...");
      setTimeout(function () {
        storeUserData(true);
      }, 2000);
    }

    initialize(settings);
  });

  var verifyListSelection = function () {

    µb.getAvailableLists(function (lists) {
      var ok = (lists[requiredList].off !== true);
      //console.log('verifyListSelection->' + ok);
      vAPI.messaging.broadcast({
        what: 'listsVerified',
        result: ok
      });
    });
  };

  var onAllReady = function (firstRun) {

    µb.staticFilteringReverseLookup.initWorker(function (entries) {

      listEntries = entries;
      log("Loaded/compiled " + Object.keys(entries).length +
        " 3rd-party lists in " + (+new Date() - profiler) + "ms");
      strictBlockingDisabled = true;
    });

    if (firstRun) {

      vAPI.tabs.open({
        url: 'firstrun.html',
        index: -1
      });
    }
  }

  /******************************************************************************/

  return { // public API

    adlist: adlist,
    logAdSet: logAdSet,
    clearAds: clearAds,
    exportAds: exportAds,
    importAds: importAds,
    onAllReady: onAllReady,
    registerAd: registerAd,
    adsForPage: adsForPage,
    adsForVault: adsForVault,
    deleteAdSet: deleteAdSet,
    updateBadges: updateBadges,
    contentPrefs: contentPrefs,
    toggleEnabled: toggleEnabled,
    itemInspected: itemInspected,
    fromNetFilterSync: fromNetFilterSync,
    isBlockableRequest: isBlockableRequest,
    verifyListSelection: verifyListSelection,
    domainCosmeticSelectors: domainCosmeticSelectors
  };

})();

/****************************** messaging ********************************/

(function () {

  'use strict';

  vAPI.messaging.listen('adnauseam', function (request, sender, callback) {

    //console.log("MSG: "+request.what);

    switch (request.what) {
      default: break;
    } // Async

    var pageStore, tabId, µb = µBlock;

    if (sender && sender.tab) {

      tabId = sender.tab.id;
      pageStore = µb.pageStoreFromTabId(tabId);
    }

    if (typeof µb.adnauseam[request.what] === 'function') {

      callback(µb.adnauseam[request.what](request, pageStore, tabId));

    } else {

      return vAPI.messaging.UNHANDLED;
    }
  });

})();

/*************************************************************************/
