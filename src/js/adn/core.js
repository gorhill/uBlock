/* global vAPI, µBlock */

µBlock.adnauseam = (function () {

  'use strict';

  // for debugging only
  var failAllVisits = 0, // all visits will fail
    clearAdsOnInit = 0, // start with zero ads
    clearVisitData = 0, // reset all ad visit data
    automatedMode = 0, // testing ['selenium' or 'sessbench']
    disableIdler = 0; // don't wait for user to be idle

  var µb = µBlock,
    production = 1,
    lastActivity = 0,
    lastUserActivity = 0,
    listsLoaded = false,
    notifications = [],
    allowedExceptions = [],
    maxAttemptsPerAd = 3,
    visitTimeout = 20000,
    profiler = +new Date(),
    pollQueueInterval = 5000,
    redactMarker = '********',
    repeatVisitInterval = Number.MAX_VALUE;

  var xhr, idgen, admap, inspected, listEntries, visitedURLs = new Set();

  // blocks requests to/from these domains even if the list is not in enabledBlockLists
  var allowAnyBlockOnDomains = ['youtube.com', 'funnyordie.com']; // no dnt in here

  // allow blocks only from this set of lists (recheck this)
  var enabledBlockLists = ['My filters', 'EasyPrivacy',
    'uBlock filters – Badware risks', 'uBlock filters – Unbreak',
    'uBlock filters – Privacy', 'Malware domains', 'Malware Domain List',
    'Anti-ThirdpartySocial', 'AdNauseam filters', 'Fanboy’s Annoyance List‎',
    'CHN: CJX\'s Annoyance List‎', 'Spam404', 'Anti-Adblock Killer | Reek‎',
    'Fanboy’s Social Blocking List', 'Malware domains (long-lived)‎',
    'Adblock Warning Removal List', 'Malware filter list by Disconnect',
    'Basic tracking list by Disconnect', 'EFF DNT Policy Whitelist'
  ];

  var removableBlockLists = [ 'hphosts', 'mvps-0', 'plowe-0' ];

  // targets on these domains are never internal (may need to be regex)
  var internalLinkDomains = ['google.com', 'asiaxpat.com', 'nytimes.com',
    'columbiagreenemedia.com','163.com', 'sohu.com','zol.com.cn','baidu.com',
    'yahoo.com','facebook.com'
  ];

  // mark ad visits as failure if any of these are included in title
  var errorStrings = ['file not found', 'website is currently unavailable', 'not found on this server'];

  var reSpecialChars = /[\*\^\t\v\n]/, remd5 = /[a-fA-F0-9]{32}/;

  /**************************** functions ******************************/

  /* called when the addon is first loaded */
  var initialize = function (settings) {

    // modify XMLHttpRequest to store original request/ad
    var XMLHttpRequest_open = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method, url) {

      this.delegate = null; // store ad here
      this.requestUrl = url; // store original target
      return XMLHttpRequest_open.apply(this, arguments);
    };

    initializeState(settings);

    setTimeout(pollQueue, pollQueueInterval * 2);
  }

  var initializeState = function (settings) {

    admap = (settings && settings.admap) || {};

    validateAdStorage();

    if (production) { // disable all test-modes if production

      failAllVisits = clearVisitData = automatedMode = clearAdsOnInit = disableIdler = 0;

    } else if (automatedMode === 'sessbench') { // using sessbench

      setupTesting();
    }
  }

  var setupTesting = function () {

    warn('AdNauseam/sessbench: eid=' + chrome.runtime.id);

    chrome.runtime.onMessageExternal.addListener(
      function (request, sender, sendResponse) {

        if (request.what === 'getAdCount') {
          var url = request.pageURL,
            count = currentCount(),
            json = {
              url: url,
              count: count
            };

          console.log('TEST-FOUND: ', JSON.stringify(json));

          sendResponse({
            what: 'setPageCount',
            pageURL: url,
            count: count
          });

        } else if (request.what === 'clearAds') {
          clearAds();
        }
      });
  }

  /* make sure we have no bad data in ad storage */
  var validateAdStorage = function () {

    var ads = adlist(), i = ads.length;

    if (clearAdsOnInit) {

      setTimeout(function () {

        warn("[DEBUG] Clearing all ad data!");
        clearAds();

      }, 2000);
    }

    if (clearVisitData) clearAdVisits(ads);

    while (i--) {

      if (!validateFields(ads[i])) {

        warn('Invalid ad in storage', ads[i]);
        ads.splice(i, 1);
      }
    }

    validateHashes();
    computeNextId(ads = adlist());

    log('[INIT] Initialized with ' + ads.length + ' ads');
  }

  var validMD5 = function(s) {

    return remd5.test(s);
  }

  var validateHashes = function () {

    var hashes, ad, pages = Object.keys(admap),
      unhashed = [], orphans = [];

    /* ForEach pageKey in admap
      if (pageKey is not hashed)
        add pageKey to unhashed
        add all its ads to orpans
      if (pageKey is hashed)
        add any non-hashed ads to orphans
    }*/
    var checkHashes = function () {

      for (var i = 0; i < pages.length; i++) {

        var isHashed = validMD5(pages[i]);

        if (!isHashed) {

          unhashed.push(pages[i]);
          hashes = Object.keys(admap[pages[i]]);
          for (var j = 0; j < hashes.length; j++) {

            ad = admap[pages[i]][hashes[j]];
            orphans.push(ad);
          }

        } else {

          hashes = Object.keys(admap[pages[i]]);
          for (var j = hashes.length - 1; j >= 0; j--) {

            if (!validMD5(hashes[j])) {

              ad = admap[pages[i]][hashes[j]];
              delete admap[pages[i]][hashes[j]];
              orphans.push(ad);
            }
          }
        }
      }

      /* if (found unhashed or orphans)
        Delete unhashed entries from admap
        Add each orphan back to admap
      */
      var repairHashes = function () {

        orphans.forEach(function(ad) {
          createAdmapEntry(ad, admap)
        });

        unhashed.forEach(function (k) {
          delete admap[k]
        });

        storeUserData();
      }

      if (unhashed.length || orphans.length) repairHashes();
    }

    checkHashes();
    //log('[CRYPT] '+adCount()+ ' ads hash-verified');
  }

  var clearAdVisits = function (ads) { // for dev-debugging only

    warn("[WARN] Clearing all Ad visit data!");

    ads = ads || adlist();

    ads.forEach(function (ad) {

      delete ad.noVisit; // Note: ignore click-prob & assume all ads should be re-visited
      delete ad.resolvedTargetUrl;
      ad.attemptedTs = 0;
      ad.visitedTs = 0;
      ad.attempts = 0
    });
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

    var next, pending = pendingAds(),
      settings = µb.userSettings;

    if (pending.length && settings.clickingAds && !isAutomated()) { // no visits if automated

      // check whether an idle timeout has been specified
      var idleMs = disableIdler ? 0 : settings.clickOnlyWhenIdleFor;
      if (!idleMs || (millis() - lastUserActivity > idleMs)) {

        //idleMs && log("[IDLER] "+(millis() - lastUserActivity)+"ms, clicking resumed...");

        // if an unvisited ad is being inspected, visit it next
        if (visitPending(inspected)) {

          next = inspected;

        } else {

          // else take the most recent ad needing a visit
          next = pending.sort(byField('-foundTs'))[0];
        }

        visitAd(next);
      }
      else if (idleMs) {

        log('[IDLER] '+(millis() - lastUserActivity)+'ms, waiting until '+ idleMs +'ms...'); // TMP
      }
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

    var pending = ad && ad.attempts < maxAttemptsPerAd &&
      ad.visitedTs <= 0 && !ad.dntAllowed && !ad.noVisit;

    //  DH: moved to registerAd() as part of #1168
    //
    // if (pending && µb.adnauseam.dnt.mustNotVisit(ad)) {
    //
    //   log('[DNT] (NoVisit) ' + adinfo(ad), ad.pageDomain + ' => ' + ad.targetDomain);
    //
    //   ad.noVisit = true; // so we don't recheck it
    //   ad.dntAllowed = true;
    //
    //   // S: why do we need this?
    //   // vAPI.messaging.broadcast({
    //   //   what: 'updateDNT',
    //   //   ad: ad
    //   // });
    //
    //   pending = false;
    // }

    if (pending && visitedURLs.has(ad.targetUrl)) {

      log('[NOVISIT] User has already clicked the ad', ad.targetUrl);
      ad.noVisit = true; // so we don't recheck it
      ad.clickedByUser = true;
      pending = false;
    }

    return pending;
  }

  var isPopupOpen = function () {

    return vAPI.getViews({ type: "popup" }).length;
  }

  var getExtPageTabId = function (htmlPage) {

    var pageUrl = vAPI.getURL(htmlPage);
    for (let e of µb.pageStores) {
      var pageStore = e[1];
      if (pageStore !== null && pageStore.rawURL.startsWith(pageUrl))
        return pageStore.tabId;
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

        log('[FAILED] ' + adinfo(ad), ad); // this);
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

  /* send to vault/menu/dashboard if open */
  var sendNotifications = function(notes) {

    vAPI.messaging.broadcast({
       what: 'notifications',
       notifications: notes
       // TODO: do we need to make these cloneable ? see #1163
     });
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

    var shtml = html.length > 100 ? html.substring(0, 100) + '...' : html;
    //console.log('shtml: ' + shtml);
    warn('[VISIT] No title for ' + xhr.requestUrl, 'Html:\n' + shtml);

    return false;
  }

  var updateAdOnSuccess = function (xhr, ad, title) {

    var ad = xhr.delegate;

    if (ad) {

      if (title) ad.title = title;

      if (ad.title === 'Pending')
        ad.title = parseDomain(xhr.requestUrl, true);

      ad.resolvedTargetUrl = xhr.responseURL; // URL after redirects
      ad.visitedTs = millis(); // successful visit time

      vAPI.tabs.get(null, function (tab) {

        if (tab && tab.id) { // do click animation
          var tabId = tab.id;
          µb.updateBadgeAsync(tabId, true); // click icon
          setTimeout(function () {
            µb.updateBadgeAsync(tabId);
          }, 600); // back to normal icon
        }
        // else warn('Null tab in click animation: ', tab); // not a problem
      });

      vAPI.messaging.broadcast({
        what: 'adVisited',
        ad: ad
      });

      if (ad === inspected) inspected = null;

      log('[VISIT] ' + adinfo(ad), ad.title);
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

      warn('[TIMEOUT] Visiting ' + this.requestUrl); //, e, this);

    } else {

      // or some other error?
      warn('onVisitError()', e, this.requestUrl, this.statusText); // this);
    }

    if (!this.delegate) {

      return err('Request received without Ad: ' + this.responseURL);
    }

    updateAdOnFailure(this, e);

    xhr = null; // end the visit
  };

  var onVisitResponse = function () {

    this.onload = this.onerror = this.ontimeout = null;

    markActivity();

    var ad = this.delegate;

    if (!ad) {

      return err('Request received without Ad: ' + this.responseURL);
    }

    if (!ad.id) {

      return warn("Visit response from deleted ad! ", ad);
    }

    ad.attemptedTs = 0; // reset as visit no longer in progress

    var status = this.status || 200,
      html = this.responseText;

    if (failAllVisits || status < 200 || status >= 300 ) {
      return onVisitError.call(this, {
        status: status,
        responseText: html
      });
    }

    try {

      if (!isFacebookExternal(this, ad)) {

        updateAdOnSuccess(this, ad, parseTitle(this));
      }

    } catch (e) {

      warn(e.message);
    }

    xhr = null; // end the visit
  };

  // Checks for external FB link and if so, parses the true link
  var isFacebookExternal = function (xhr, ad) {

    if (/facebook\.com\/l\.php/.test(xhr.requestUrl)) {

      var url = decodeURIComponent(xhr.responseURL);
      ad.parsedTargetUrl = decodeURIComponent(url.substring(url.lastIndexOf('http')));
      log("[FB-EXT] Parsed: ", ad.parsedTargetUrl);

      return true;
    }
  };

  var visitAd = function (ad) {

    function timeoutError(xhr) {
      return onVisitError.call(xhr, {
        type: 'timeout'
      });
    }

    var url = ad.targetUrl,
      now = markActivity();

    // tell menu/vault we have a new attempt
    vAPI.messaging.broadcast({
      what: 'adAttempt',
      ad: ad
    });

    if (xhr) {

      if (xhr.delegate.attemptedTs) {

        var elapsed = (now - xhr.delegate.attemptedTs);

        // TODO: why does this happen... a redirect?
        warn('[TRYING] Attempt to reuse xhr from ' + elapsed + " ms ago");

        if (elapsed > visitTimeout)
          timeoutError();
      }
      else {

        warn('[TRYING] Attempt to reuse xhr with no attemptedTs!!', xhr);
      }
    }

    ad.attempts++;
    ad.attemptedTs = now;

    if (!validateTarget(ad)) return deleteAd(ad);

    return sendXhr(ad);
  };

  var sendXhr = function (ad) {

    // if we've parsed an obfuscated target, use it
    var target = ad.parsedTargetUrl || ad.targetUrl;

    log('[TRYING] ' + adinfo(ad), ad.targetUrl);

    xhr = new XMLHttpRequest();

    try {

      xhr.open('get', target, true);
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

        return warn("Invalid targetUrl: " + url);
      }
    }

    // ad.targetUrl = trimChar(ad.targetUrl, '/'); #751

    var dInfo = domainInfo(ad.resolvedTargetUrl || ad.targetUrl);

    if (!isValidDomain(dInfo.domain)) {

      return warn("Invalid domain: " + url);
    }

    //console.log(dInfo.domain, isValidDomain(dInfo.domain));

    ad.targetHostname = dInfo.hostname;
    ad.targetDomain = dInfo.domain;

    // Check: a slash at the end of the domain https://github.com/dhowe/AdNauseam/issues/1304
    
    var idx = url.indexOf(ad.targetDomain) + ad.targetDomain.length;
    if (idx < url.length - 1 && url.charAt(idx) != "/") {
      ad.targetUrl = url.substring(0,idx) + "/" + url.substring(idx, url.length);
    }

    return true;
  }

  var domainInfo = function (url) { // via uBlock/psl

    var hostname = µb.URI.hostnameFromURI(url);
    var domain = µb.URI.domainFromHostname(hostname);
    return { hostname: hostname, domain: domain };
  }

  var domainFromURI = function (url) { // TODO: replace all uses with domainInfo()

    return µb.URI.domainFromHostname(µb.URI.hostnameFromURI(url));
  }

  var validateFields = function (ad) {

    if (ad.visitedTs === 0 && ad.attempts > 0) {

      warn('Invalid visitTs/attempts pair', ad);
      ad.attempts = 0; // shouldn't happen
    }

    if (!(ad.pageUrl.startsWith('http') || ad.pageUrl === redactMarker))
      warn('Possibly Invalid PageUrl: ', ad.pageUrl);

    // re-add if stripped in export
    ad.pageDomain = ad.pageDomain || domainFromURI(ad.pageUrl) || ad.pageUrl;
    ad.targetDomain = ad.targetDomain || domainFromURI(ad.resolvedTargetUrl || ad.targetUrl);
    ad.targetHostname = ad.targetHostname || µb.URI.hostnameFromURI(ad.resolvedTargetUrl || ad.targetUrl);

    return ad && type(ad) === 'object' &&
      type(ad.pageUrl) === 'string' &&
      type(ad.contentType) === 'string' &&
      type(ad.contentData) === 'object';
  }

  var validate = function (ad) {

    if (!validateFields(ad)) {

      return warn('Invalid ad-fields: ', ad);
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

  var reloadExtPage = function (htmlPage) {

    var tabId = getExtPageTabId(htmlPage)
    tabId && vAPI.tabs.reload(tabId);
  }

  var deleteAd = function (arg) {

    var ad = type(arg) === 'object' ? arg : adById(arg),
      count = adCount();

    if (!ad) {
      return warn("No Ad to delete", id, admap);
    }

    var pageHash = YaMD5.hashStr(ad.pageUrl);
    if (admap[pageHash]) {

      var hash = computeHash(ad);

      if (admap[pageHash][hash]) {

        delete admap[pageHash][hash];

      } else {

        return warn('Delete failed, no ad: ', ad, admap);
      }
    }
    else {
      return warn('Delete failed, no page key: ', ad, admap);
    }

    if (adCount() < count) {

      log('[DELETE] ' + adinfo(ad));
      updateBadges();

    } else {

      return warn('Unable to delete: ', ad);
    }

    storeUserData();
  }

  var log = function () {
    if (µb.userSettings.eventLogging)
      console.log.apply(console, arguments);
    return true;
  }

  var warn = function () {
    if (µb.userSettings.eventLogging)
      console.warn.apply(console, arguments);
    return false;
  }

  var err = function () {
    console.error.apply(console, arguments);
    return false;
  }

  // return ALL ads, regardless of pageUrl param
  var adsForUI = function (pageUrl) {

    return {

      data: adlist(),
      pageUrl: pageUrl,
      prefs: contentPrefs(),
      current: activeVisit(),
      notifications: notifications
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

      computeNextId();
      var hashes = Object.keys(map[pages[i]]);
      for (var j = 0; j < hashes.length; j++) {

        var hash = hashes[j];
        if (type(hash) !== 'string' || !(validMD5(hash) || hash.includes('::'))) {

          return warn('Bad hash in import: ', hash, ad); // tmp
        }

        var ad = map[pages[i]][hash];
        if (validateFields(ad)) {

          validateTarget(ad); // accept either way
          ad.id = ++idgen; // increment the id so as not to collide

          if (!newmap[pages[i]]) newmap[pages[i]] = {};
          newmap[pages[i]][hash] = ad;

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

      var ad = updateLegacyAd(ads[j]);
      createAdmapEntry(ad, map)
    }

    return map;
  }

  var createAdmapEntry = function (ad, map) {

    if (validateFields(ad)) {

      var pagehash = YaMD5.hashStr(ad.pageUrl);
      if (!map[pagehash]) map[pagehash] = {};
      map[pagehash][computeHash(ad)] = ad;
      return true;
    }

    warn('Unable to validate ad', ad);
  }

  var validateLegacyImport = function (map) {

    if (type(map) !== 'object') {

      return (type(map) === 'array') ? validateAdArray(map) :
        warn('Import-fail: not object or array', type(map), map);
    }

    var ad, ads, hash, newmap = {},
      pages = Object.keys(map);

    if (!pages || !pages.length) {

      return warn('no pages: ', pages);
    }

    for (var i = 0; i < pages.length; i++) {

      ads = map[pages[i]];

      if (type(ads) !== 'array') {

        //warn('not array', type(ads), ads);
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
    ad.pageDomain = domainFromURI(ad.pageUrl) || ad.pageUrl; // DCH: 8/10
    if (!ad.errors || !ad.errors.length)
      delete ad.errors;
    delete ad.hashkey;
    delete ad.path;

    return ad;
  }

  var postRegister = function (ad, tabId) {

    log('[FOUND] ' + adinfo(ad), ad);

    var vaultOpen = typeof getExtPageTabId('vault.html') !== 'undefined';
    if (vaultOpen || isPopupOpen()) {

      // if vault/menu is open, send the new ad
      var json = adsForUI(ad.pageUrl);
      json.what = 'adDetected';
      json.ad = ad;

      //if (automatedMode) json.automated = true; // not used ?

      vAPI.messaging.broadcast(json);
    }
    // else console.log('[FOUND] !Broadcast: no menu or vault');

    if (µb.userSettings.showIconBadge)
      µb.updateBadgeAsync(tabId);

    storeUserData();
  }

  var activeBlockList = function (test) {

    return enabledBlockLists.contains(test);
  }

  // check target domain against page-domain #337
  var internalTarget = function (ad) {

    if (ad.contentType === 'text') return false;

    // if an image ad's page/target domains match, it's internal
    return (ad.pageDomain === ad.targetDomain);
  };

  var listsForFilter = function (compiledFilter) {

    var entry, content, pos, c, lists = [];
    for (var path in listEntries) {

      entry = listEntries[path];
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
      lists.push(entry.title); // only need titles
      /*{ title: entry.title
      supportURL: entry.supportURL }*/
    }
    return lists;
  };

  var isBlockableDomain = function (context) {

    //console.log('isBlockableDomain',context.rootDomain, context);

    var domain = context.rootDomain,
      host = context.requestHostname;

    for (var i = 0; i < allowAnyBlockOnDomains.length; i++) {

      var dom = allowAnyBlockOnDomains[i];
      if (dom === domain || host.indexOf(dom) > -1) {
        return true;
      }
    }
    return false;
  };

  /**
   *  This is called AFTER our DNT rules, and checks the following cases:
   *
   *  1) whether we are blocking at all (blockingMalware == false)
   *  		if not, return false
   *
   *  2) Whether we are have finished loading rules (listsLoaded == true)
   *      if not, return false
   *
   *  3) whether *any* block on the domain is valid (domain in allowAnyBlockOnDomains)
   *  		if so, return true;
   *
   *  4) if any list that it was found on allows blocks
   *  		if so, return true;
   */
  var isBlockableRequest = function (context) {

    if (µb.userSettings.blockingMalware === false) {

      logNetAllow('NoBlock', context.rootDomain + ' => ' + context.requestURL);
      return false;
    }

    if (!listsLoaded) {

      logNetAllow('Loading', context.rootDomain  + ' => ' + context.requestURL);
      return false;
    }

    if (isBlockableDomain(context)) {

      logNetBlock('Domains', context.rootDomain + ' => ' + context.requestURL);
      return true;
    }

    // always allow redirect blocks from lists (?)
    if (µb.redirectEngine.toURL(context)) {

      logNetBlock('*Redirect*', context.rootDomain + ' => ' + context.requestURL, context);
      return true;
    }

    var snfe = µb.staticNetFilteringEngine,
      compiled = snfe.toLogData().compiled,
      raw = snfe.toLogData().raw,
      url = context.requestURL;

    /*
      Check active rule(s) to see if we should block or allow

      Cases:
        A) user list:      allow
        B) exception hit:  allow
        C) block hit:      block
        D) no valid hits:  allow, but no cookies later
     */
    var lists = listsForFilter(compiled);

    if (lists.length === 0) {                                // case A
      logNetBlock('User List', raw + ': ', url); // always block
      return true;
    }

    for (var i = 0; i < lists.length; i++) {

      var name = lists[0];

      if (activeBlockList(name)) {

        if (raw.indexOf('@@') === 0) {                       // case B

          logNetAllow(name, raw + ': ', url);
          return false;
        }

        logNetBlock(name, raw + ': ', url);                  // case C
        return true; // blocked, no need to continue
      }
      else {

        if (!misses) var misses = [];
        if (!misses.contains(name)) misses.push(name);
      }
    }

    return allowRequest(misses.join(','), raw + ': ', url);  // case D
  }

  var adCount = function () {

    return adlist().length;
  }

  var dntAllowsRequest = function(url, hostname) {

    //if (!url) throw Error("No URL!",hostname);

    var us = µb.userSettings,
      dntHides = us.hidingAds && us.disableHidingForDNT,
      dntClicks = us.clickingAds && us.disableClickingForDNT;

    // 1st-party: only check original-request per EFF spec
    return ((dntHides || dntClicks) && us.dntDomains.contains(hostname));
  }

  var allowRequest = function (msg, raw, url) {

    // Note: need to store allowed requests here so that we can
    // block any incoming cookies later (see #301)
    allowedExceptions[url] = +new Date();

    if (true || msg !== 'EasyList') {  // avoid excessive logging
      logNetEvent('[ALLOW!]', msg, raw + ': ', url);
    }

    return false;
  }

  var isAutomated = function () {

    return (automatedMode && automatedMode.length);
  }

  var saveVaultImages = function (jsonName) {

    // Note(not-in-use): crashes over approx. 725 image or 70MB

    var imgURLs = [];
    adlist().forEach(function (ad) {
      if (ad.contentType === 'img')
        imgURLs.push(ad.contentData.src);
    });

    // #639: download to a folder next to the export file (with same name -json)

    var files = [], lastFilesLength = 0, zipNameParts = jsonName.split("."),
      zipName = zipNameParts.splice(0, zipNameParts.length - 2).join('_');

    var processUrl = function (url) {

      var parts = url.split("/"),
        filename = parts[parts.length - 1];

      filename = "image_" + i + ".jpg"; // tmp

      var img = new Image();
      img.onload = function () {

        //better image handling
        if ('naturalHeight' in this) {
          if (this.naturalHeight + this.naturalWidth === 0) {
            this.onerror();
            return;
          }
        } else if (this.width + this.height === 0) {
          this.onerror();
          return;
        }

        var a = document.createElement('a');
        a.href = this.src;
        files.push({
          name: filename,
          data: toBase64Image(img)
        });
      }

      img.onerror = function () {
        log("Error");
        var index = imgURLs.indexOf(url);
        if (index > -1) {
          imgURLs.splice(index, 1);
        }
      }

      img.src = url;
    }

    imgURLs.forEach(processUrl);

    var check = setInterval(function () {

      log("checking", files.length, imgURLs.length, lastFilesLength);

      if (files.length === imgURLs.length || files.length === lastFilesLength) {

        clearInterval(check);

        var zip = new JSZip(),
          img = zip.folder(zipName),
          zipcount = 0;

        for (var i = 0; i < files.length; i++) {
          img.file(files[i].name, files[i].data, {
            base64: true
          });
        }

        // type base64 or blob???
        zip.generateAsync({
          type: "base64"
        }).then(function (content) {

          var blob = b64toBlob(content, 'image'),
            blobUrl = URL.createObjectURL(blob);

          //use vAPI.download, convert base64 to blob
          vAPI.download({
            'url': blobUrl,
            'filename': zipName + ".zip"
          });
        });
      }
      lastFilesLength = files.length;
    }, 1000);
  };

  var admapToJSON = function(sanitize) {

    var map = JSON.parse(JSON.stringify(admap)), // deep clone
      pages = Object.keys(map);

    for (var i = 0; i < pages.length; i++) {

      if (map[pages[i]]) {
        var hashes = Object.keys(map[pages[i]]);
        for (var j = 0; j < hashes.length; j++) {

          var ad = map[pages[i]][hashes[j]];

          delete ad.current;
          delete ad.pageDomain;
          delete ad.targetDomain;
          delete ad.targetHostname;

          if (ad.resolvedTargetUrl === ad.targetUrl)
            delete ad.resolvedTargetUrl;

          if (sanitize) { // #643: remove page info for privacy

            ad.pageUrl = redactMarker;  // YaMD5.hashStr(ad.pageUrl);
            ad.pageTitle = redactMarker; // YaMD5.hashStr(ad.pageTitle);
          }
        }
      }
    }
    return JSON.stringify(map, null, 2);
  }

  // start by grabbing user-settings, then calling initialize()
  vAPI.storage.get(µb.userSettings, function (settings) {

    // this for backwards compatibility only ---------------------
    var mapSz = Object.keys(settings.admap).length;
    if (!mapSz && µb.adnSettings && µb.adnSettings.admap) {

      settings.admap = µb.adnSettings.admap;

      log("[IMPORT] Using legacy admap...");

      setTimeout(function () {
        storeUserData(true);
      }, 2000);
    }

    initialize(settings);
  });


  /********************************** API *************************************/

  var exports = { log: log };

  exports.removeBlockingLists = function (lists) {

    removableBlockLists.forEach(function(l) {
      delete lists[l];
    });
  };

  exports.adsForVault = function (request, pageStore, tabId) {

    return adsForUI();
  };

  exports.mustAllowRequest = function (result, context) {

    return result !== 0 && !isBlockableRequest(context);
  };

  exports.itemInspected = function (request, pageStore, tabId) {

    if (request.id) {
      var ad = adById(request.id)
      inspected = ad;
    }
  };

  var contentPrefs = exports.contentPrefs = function (hostname) {

    // preferences relevant to our ui/content-scripts
    var us = µb.userSettings,
      showDnt = (us.disableHidingForDNT && us.dntDomains.contains(hostname));

    //console.log('contentPrefs: '+hostname, "VISIBLE: "+showDnt);
    return {
      hidingDisabled: !us.hidingAds || showDnt,
      clickingDisabled: !us.clickingAds,
      textAdsDisabled: !us.parseTextAds,
      logEvents: us.eventLogging
    };
  };

  exports.toggleEnabled = function (request, pageStore, tabId) {

    var store = µb.pageStoreFromTabId(request.tabId);
    if (store) {

      store.toggleNetFilteringSwitch(request.url, request.scope, request.state);
      updateBadges();

      // close whitelist if open (see gh #113)
      var wlId = getExtPageTabId("dashboard.html#whitelist.html")
      wlId && vAPI.tabs.replace(wlId, vAPI.getURL("dashboard.html"));
    }
  };

  // Called when new top-level page is loaded
  exports.onPageLoad = function (tabId, requestURL) {

    var ads = adlist(requestURL); // all ads for url

    //console.log('PAGE: ', requestURL, ads.length);
    visitedURLs.add(requestURL);

    ads.forEach(function (ad) {
      ad.current = false;
    });

    if (automatedMode === 'selenium' && requestURL === 'http://rednoise.org/ad-auto-export') {
      exportAds();
    }

    markUserAction();
  };

  // called each time a single list is updated
  exports.onListUpdated = function (path, content) {

    listEntries[path].content = content;
  }

  exports.onListsLoaded = function (firstRun) {

    µb.staticFilteringReverseLookup.initWorker(function (entries) {

      listEntries = entries;
      //console.log('listEntries:', listEntries);
      var keys = Object.keys(entries);
      log("[LOAD] Compiled " + keys.length +
        " 3rd-party lists in " + (+new Date() - profiler) + "ms");
      listsLoaded = true;

      verifyAdBlockers();
      verifySettings();
      verifyLists();

      µb.adnauseam.dnt.updateFilters();
    });

    if (firstRun && !isAutomated()) {

      vAPI.tabs.open({
        url: 'firstrun.html',
        index: -1
      });

      // collapses 'languages' group in dashboard:3rd-party
      vAPI.localStorage.setItem('collapseGroup5', 'y');
    }
  };

  var markUserAction = exports.markUserAction = function () {

    return (lastUserActivity = millis());
  }

  var logNetAllow = exports.logNetAllow = function () {

    var args = Array.prototype.slice.call(arguments);
    args.unshift('[ALLOW]')
    logNetEvent.apply(this, args);
  };

  var logNetBlock = exports.logNetBlock = function () {

    var args = Array.prototype.slice.call(arguments);
    args.unshift('[BLOCK]');
    logNetEvent.apply(this, args);
  };

  var logRedirect = exports.logRedirect = function (from, to) {

    if (µb.userSettings.eventLogging && arguments.length)
      log('[REDIRECT] ' + from + ' => ' + to);
  };

  var logNetEvent = exports.logNetEvent = function () {

    if (µb.userSettings.eventLogging && arguments.length) {

      var args = Array.prototype.slice.call(arguments);
      var action = args.shift();
      args[0] = action + ' (' + args[0] + ')';
      log.apply(this, args);
    }
  }

  exports.lookupAd = function (url, requestId) {

    //url = trimChar(url, '/'); // no trailing slash

    var ads = adlist();

    for (var i = 0; i < ads.length; i++) {

      if (ads[i].attemptedTs) {
        //console.log('check: '+ads[i].requestId+'/'+ads[i].targetUrl+' ?= '+requestId+'/'+url);
        if (ads[i].requestId === requestId || ads[i].targetUrl === url) {
          return ads[i];
        }
      }
    }
  };

  exports.registerAd = function (request, pageStore, tabId) {

    if (!request.ad) return;

    var json, adhash, pageHash, msSinceFound, orig, ad = request.ad;

    ad.current = true;
    ad.attemptedTs = 0;
    ad.pageUrl = pageStore.rawURL;
    ad.pageTitle = pageStore.title;
    ad.pageDomain = µb.URI.domainFromHostname(pageStore.tabHostname); // DCH: 8/10
    ad.version = vAPI.app.version;

    //console.log('registerAd: '+pageStore.tabHostname+' -> '+ad.pageDomain);

    if (!validate(ad)) {

      return warn(ad);
    }

    if (!internalLinkDomains.contains(ad.pageDomain) && internalTarget(ad)) {

      return warn('[INTERN] Ignoring Ad on '+ad.pageDomain+', target: '+ad.targetUrl);
    }

    pageHash = YaMD5.hashStr(ad.pageUrl);

    if (!admap[pageHash]) admap[pageHash] = {};

    adhash = computeHash(ad);

    if (admap[pageHash][adhash]) { // may be a duplicate

      orig = admap[pageHash][adhash];
      msSinceFound = millis() - orig.foundTs;

      if (msSinceFound < repeatVisitInterval) {

        log('[EXISTS] ' + adinfo(ad) + ' found ' + msSinceFound + ' ms ago');
        return;
      }
    }

    ad.id = ++idgen; // gets an id only if its not a duplicate

    if (µb.adnauseam.dnt.mustNotVisit(ad)) { // see #1168
      ad.noVisit = true;
      ad.dntAllowed = true;
    }
    else {
      ad.noVisit = Math.random() > µb.userSettings.clickProbability; // if true, ad will never be visited
    }

    // this will overwrite an older ad with the same key
    // admap[pageStore.rawURL][adhash] = ad;
    admap[pageHash][adhash] = ad;

    postRegister(ad, tabId);
  };

  // update tab badges if we're showing them
  var updateBadges = exports.updateBadges = function () {

    var optionsUrl = vAPI.getURL('options.html');

    for (var tabId in µb.pageStores) {

      var store = µb.pageStoreFromTabId(tabId);
      if (store !== null && !store.rawURL.startsWith(optionsUrl)) {
        µb.updateBadgeAsync(tabId);
      }
    }
  };

  exports.injectContentScripts = function (request, pageStore, tabId, frameId) {

    console.log('[INJECT] IFrame: ' + request.parentUrl, frameId + '/' + tabId);

    // Firefox already handles this correctly
    vAPI.chrome && vAPI.onLoadAllCompleted(tabId, frameId);
  };

  exports.isBlockableException = function (requestUrl, originalUrl) {

    if (typeof allowedExceptions[requestUrl] !== 'undefined') {

      var originalHostname = µb.URI.hostnameFromURI(originalUrl);
      return !dntAllowsRequest(requestUrl, originalUrl);
    }
  };

  exports.checkAllowedException = function (headers, requestUrl, originalUrl) {

    if (typeof allowedExceptions[requestUrl] !== 'undefined')
      return blockIncomingCookies(headers, requestUrl, originalUrl);

    return false;
  };

  var blockIncomingCookies = exports.blockIncomingCookies = function (headers, requestUrl, originalUrl) {

    var modified = false, dbug = 0, hostname, us = µb.userSettings;

    var cookieAttr = function(cookie, name) {

      var parts = cookie.split(';');
      for (var i = 0; i < parts.length; i++) {
        var keyval = parts[i].trim().split('=');
        var key = keyval[0]
        if (keyval[0].toLowerCase() === name)
          return keyval[1];
      }
    }

    dbug && console.log('[HEADERS] (Incoming' + (requestUrl===originalUrl ? ')' : '-redirect)'), requestUrl);

    var originalHostname = µb.URI.hostnameFromURI(originalUrl);

    if (dntAllowsRequest(originalUrl, originalHostname)) {

      log('[DNT] (AllowCookie1p)', originalUrl);
      return false;
    }

    //console.log("1pDomain: '"+µb.URI.hostnameFromURI(originalUrl)+"' / '" +
      //µb.URI.hostnameFromURI(requestUrl)+"'", " original='"+originalUrl+"'");

    for (var i = headers.length - 1; i >= 0; i--) {

      var name = headers[i].name.toLowerCase();

      dbug && console.log(i + ') '+name, headers[i].value);

      if (name === 'set-cookie' || name === 'set-cookie2') {

        if (1) { // don't block incoming cookies for 3rd party-requests coming from DNT-pages? [needs checking]

          var cval = headers[i].value.trim();
          var domain = cookieAttr(cval, 'domain');

          if (domain && us.dntDomains.contains(domain)) {
            log('[DNT] (AllowCookie3p) \'', cval + '\' dnt-domain: '+domain);
            continue;
          }
        }

        var requestHostname = requestUrl && µb.URI.hostnameFromURI(requestUrl);

        log('[COOKIE] (Block)', headers[i].value, "1pDomain: "+ originalHostname +
            (requestHostname && requestHostname !== originalHostname ? ' / ' + requestHostname: ''),
            (domain ? " 3pDomain: " + domain : ''));

        headers.splice(i, 1);
        modified = true;
      }
    }

    return modified;
  };

  exports.shutdown = function () {

    this.dnt.shutdown();
  };

  exports.deleteAdSet = function (request, pageStore, tabId) {

    request.ids.forEach(function (id) {
      deleteAd(id);
    });
  };

  exports.logAdSet = function (request, pageStore, tabId) {

    var data = '';
    request.ids.forEach(function (id) {
      data += JSON.stringify(adById(id), null, 2);
    });

    log('ADSET #' + request.gid + '\n', data);

    vAPI.messaging.broadcast({
      what: 'logJSON',
      data: data
    });

    return data;
  };

  /*
   * Returns all ads for a page, or all pages, if 'pageUrl' arg is null
   * If 'currentOnly' is true, returns only current-marked ads
   *
   * Omits text-ads if specified in preferences
   * Called also from tab.js::µb.updateBadgeAsync()
   */
  var adlist = exports.adlist = function (pageUrl, currentOnly) {

    admap = admap || µb.userSettings.admap;

    var result = [], pages = pageUrl ? [ YaMD5.hashStr(pageUrl) ]
      : Object.keys(admap);

    for (var i = 0; admap && i < pages.length; i++) {

      if (admap[pages[i]]) {

        var hashes = Object.keys(admap[pages[i]]);

        for (var j = 0; j < hashes.length; j++) {

          var ad = admap[pages[i]][hashes[j]];

          // ignore text-ads according to parseTextAds prefe
          if (ad && (µb.userSettings.parseTextAds || ad.contentType !== 'text')) {

            if (!currentOnly || ad.current) {
              result.push(ad);
            }
          }
        }
      }
    }

    return result;
  };

  /*
   * Verify if other ad blockers are already installed/enabled
   * If yes, don't enable our features(hide,click,block) until disabled
   *
   * TODO: Shall be handled differently on different browser (?)
   */
  var verifyAdBlockers = exports.verifyAdBlockers = function () {

    var notes = notifications,
      modified = false;

    vAPI.getAddonInfo(function (UBlockConflict, AdBlockConflict) {

      if (UBlockConflict || AdBlockConflict) {
        modified = addNotification(notes, AdBlockerEnabled);
      }
      else {
        modified = removeNotification(notes, AdBlockerEnabled);
      }

      modified && sendNotifications(notes);
    });
  };

  exports.verifyAdBlockersAndDNT = function (request) {

    verifyDNT(request);
    verifyAdBlockers();
  };

  var verifySettings = exports.verifySettings = function () {

    verifySetting(HidingDisabled, !µb.userSettings.hidingAds);
    verifySetting(ClickingDisabled, !µb.userSettings.clickingAds);
    verifySetting(BlockingDisabled, !µb.userSettings.blockingMalware);
  };

  var verifyLists = exports.verifyLists = function () {
    var lists = µb.selectedFilterLists;
    verifyList(EasyList, lists);
    verifyList(AdNauseamTxt, lists);
  };

  var verifyList = exports.verifyList = function (note, lists) {

    var notes = notifications,
      modified = false,
      path, entry;

      for (var i = 0; i < lists.length; i++) {
        if (lists[i] === note.listName) {
            entry = lists[i];
        } else if (note.listName === "easylist" && lists[i] === "fanboy-ultimate") {
            //Fanboy's Ultimate Merged List
            entry = note.listName;
        }
      }

    if (entry) {
      modified = removeNotification(notes, note);
    }
    else {
      modified = addNotification(notes, note);
    }

    if (modified) sendNotifications(notes);
  };

  var verifyDNT = exports.verifyDNT = function (request) {

    var notes = notifications,
      prefs = µb.userSettings,
      domain = µb.URI.domainFromHostname(µb.URI.hostnameFromURI(request.url)),
      target = hasDNTNotification(notifications);

    //console.log("verifyDNT: " + domain, request.url, prefs.dntDomains);

    // if the domain is not in the EFF DNT list, remove DNT notification and return
    if (!domain || !prefs.dntDomains.contains(domain)) {

      // if notifications contains any DNT notification, remove
      if (target) {

        removeNotification(notifications, target);
        sendNotifications(notifications);
      }

      return;
    }

    // continue if the domain is in EFF DNT list

    var disableClicking = (prefs.clickingAds && prefs.disableClickingForDNT),
      disableHiding = (prefs.hidingAds && prefs.disableHidingForDNT);

    var note = DNTNotify; // neither clicking nor hiding
    if ((disableClicking && disableHiding) || (!prefs.clickingAds && disableHiding) || (!prefs.hidingAds && disableClicking))
      note = DNTAllowed;
    else if (disableClicking && prefs.hidingAds && !prefs.disableHidingForDNT)
      note = DNTHideNotClick;
    else if (prefs.clickingAds && !prefs.disableClickingForDNT && disableHiding)
      note = DNTClickNotHide;

    if (!notifications.contains(note)) {

      addNotification(notifications, note);

      if (target && target != note) {

        removeNotification(notifications, target);
      }

      sendNotifications(notifications);
    }
  };

  var verifySetting = exports.verifySetting = function (note, state) {

    //console.log('verifySetting', note, state, notifications);

    var notes = notifications, modified = false;

    if (state && !notes.contains(note)) {

      modified = addNotification(notes, note);
    }
    else if (!state) {

      modified = removeNotification(notes, note);
    }

    if (modified) {

      // check whether DNT list state needs updating
      if (note === ClickingDisabled || note === HidingDisabled) {

        //console.log('clicking: ', state, µb.userSettings.clickingAds || µb.userSettings.clickingAds);
        var off = !(µb.userSettings.clickingAds || µb.userSettings.hidingAds);

        // ADN/TODO: need a new way to check this (broken in merge1.13.2)************************
        // µb.selectFilterLists({ location: µb.adnauseam.dnt.effList, off: off })
      }

      sendNotifications(notes);
    }
  };

  // Returns the count for current-marked ads for the url
  // or if none exists, then all ads stored for the url
  var currentCount = exports.currentCount = function (url) {

    return adlist(url, true).length || adlist(url).length;
  };

  var clearAds = exports.clearAds = function () {

    var pre = adCount();

    clearAdmap();
    reloadExtPage('vault.html');
    updateBadges();
    storeUserData();
    computeNextId();

    visitedURLs.clear(); // user visits #1214

    log('[CLEAR] ' + pre + ' ads cleared');
  };

  exports.importAds = function (request) {

    // try to parse imported ads in current format
    var importedCount = 0,
      count = adCount(),
      map = validateImport(request.data);

    // no good, try to parse in legacy-format
    if (!map) {

      map = validateLegacyImport(request.data);

      if (map) {

        // check that legacy ads were converted ok
        map = validateImport(map);
        if (map) {

          // ok, legacy ads converted and verified
          log('[IMPORT] Updating legacy ads');
        }
        else
          warn('[IMPORT] Unable to parse as legacy-ads:', request.data);
      }
    }

    // no good, try to parse as a single-ad
    if (!map) {

      if (type(request.data) === 'object' && type(request.data.contentData) === 'object') {

        if (createAdmapEntry(request.data, map = {})) {
          importedCount = 1;
          log('[IMPORT] Found single Ad', request.data, map);
        }
        else
          warn('[IMPORT] Unable to parse as single-ad:', request.data);
      }
    }

    if (!map) {

      warn('[IMPORT] Unable to parse import-format:', request.data);
      return { // give up and show 0 ads imported
        what: 'importConfirm',
        count: 0
      };
    }

    admap = map;
    computeNextId();
    if (clearVisitData) clearAdVisits();
    storeUserData();

    importedCount = adCount() - count;
    log('[IMPORT] ' + importedCount + ' ads from ' + request.file);
    reloadExtPage('vault.html'); // reload Vault page if open

    validateHashes();

    return {
      what: 'importConfirm',
      count: importedCount
    };
  };

  exports.getNotifications = function () {

    return notifications;
  };

  var exportAds = exports.exportAds = function (request) {

    var count = adCount(),
      jsonData = admapToJSON(request.sanitize);

    if (!production && request.includeImages) saveVaultImages();

    log('[EXPORT] ' + count + ' ads');

    return jsonData;
  };

  /*var downloadAds = exports.downloadAds = function (request) {

    var count = adCount(),
      jsonData = admapToJSON(request.sanitize);

    if (!production && request.includeImages) saveVaultImages();

    log('[EXPORT] ' + count + ' ads');

    console.log('core.downloadAds', jsonData);

    var filename = getExportFileName(),
      url = URL.createObjectURL(new Blob([ jsonData ], { type: "text/plain" }));

    chrome.downloads.download({
      url : url,
      filename : filename
    });
  };*/

  exports.closeExtPage = function (request) {

    var tabId = getExtPageTabId(request.page);
    tabId && vAPI.tabs.remove(tabId, true);
  }

  exports.adsForPage = function (request, pageStore, tabId) {

    var reqPageStore = request.tabId &&
      µb.pageStoreFromTabId(request.tabId) || pageStore;

    if (!reqPageStore) {
        warn('No pageStore', request, pageStore, tabId);
        return;
    } else if (!reqPageStore.hasOwnProperty('rawURL')) {
        warn('No rawURL', reqPageStore, request, tabId);
        return;
    }

    return adsForUI(reqPageStore.rawURL);
  };

  return exports;

})();

/****************************** messaging ********************************/

(function () { // pass all incoming messages directly to exported functions

  'use strict';

  vAPI.messaging.listen('adnauseam', function (request, sender, callback) {

    //console.log("adnauseam.MSG: "+request.what, sender.frameId);

    switch (request.what) {
      default: break;
    } // Async

    var pageStore, tabId, frameId, µb = µBlock;

    if (sender && sender.tab) {

      tabId = sender.tab.id;
      frameId = sender.frameId;
      pageStore = µb.pageStoreFromTabId(tabId);
    }

    if (typeof µb.adnauseam[request.what] === 'function') {

      request.url && (request.url = trimChar(request.url, '/')); // no trailing slash
      callback(µb.adnauseam[request.what](request, pageStore, tabId, frameId));
      µb.adnauseam.markUserAction(); // assume user-initiated and thus no longer 'idle'

    } else {

      return vAPI.messaging.UNHANDLED;
    }
  });

})();

/*************************************************************************/
