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
    notifications = [],
    allowedExceptions = [],
    maxAttemptsPerAd = 3,
    visitTimeout = 20000,
    pollQueueInterval = 5000,
    profiler = +new Date(),
    strictBlockingDisabled = false,
    repeatVisitInterval = Number.MAX_VALUE;

  var xhr, idgen, admap, inspected, listEntries;

  // blocks requests to/from these domains even if the list is not in enabledBlockLists
  var allowAnyBlockOnDomains = ['youtube.com', 'funnyordie.com']; // no dnt in here

  // rules from EasyPrivacy we need to ignore (TODO: move to adnauseam.txt as exceptions)
  var disabledBlockingRules = ['||googletagservices.com/tag/js/gpt.js$script',
    '||amazon-adsystem.com/aax2/amzn_ads.js$script', '||stats.g.doubleclick.net^',
    '||googleadservices.com^$third-party', '||pixanalytics.com^$third-party'
  ];

  // allow blocks only from this set of lists
  var enabledBlockLists = ['My filters', 'EasyPrivacy',
    'uBlock filters – Badware risks', 'uBlock filters – Unbreak',
    'uBlock filters – Privacy', 'Malware domains', 'Malware Domain List',
    'Anti-ThirdpartySocial', 'AdNauseam filters', 'Fanboy’s Annoyance List‎',
    'CHN: CJX\'s Annoyance List‎', 'Spam404', 'Anti-Adblock Killer | Reek‎',
    'Fanboy’s Social Blocking List', 'Malware domains (long-lived)‎',
    'Adblock Warning Removal List', 'Malware filter list by Disconnect',
    'Basic tracking list by Disconnect', 'EFF DNT Policy Whitelist'
  ];

  // targets on these domains are never internal (may need to be regex)
  var internalLinkDomains = ['google.com', 'asiaxpat.com', 'nytimes.com',
    'columbiagreenemedia.com','163.com', 'sohu.com','zol.com.cn','baidu.com',
    'yahoo.com','facebook.com'
  ];

  // mark ad visits as failure if any of these are included in title
  var errorStrings = ['file not found', 'website is currently unavailable'];

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

    clearVisitData && clearAdVisits(ads);

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

  var clearAdVisits = function (ads) {

    warn("[WARN] Clearing all Ad visit data!");

    ads = ads || adlist();

    ads.forEach(function (ad) {

      ad.resolvedTargetUrl = null;
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

    var pending = ad && ad.attempts < maxAttemptsPerAd
      && ad.visitedTs <= 0 && !ad.dntAllowed;

    if (pending && µb.adnauseam.dnt.mustNotVisit(ad)) {

      log('[DNT] Not visiting '+ adinfo(ad), ad.pageDomain+'->'+ad.targetDomain);
      ad.dntAllowed = true; // so we don't recheck it
      pending = false;
    }

    return pending;
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

       vAPI.tabs.get(null, function(tab) {
           var tabId = tab.id;
           µb.updateBadgeAsync(tabId, true); //click Icon
           setTimeout(function() {
               µb.updateBadgeAsync(tabId);
           }, 600);//back to normal
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

      err('Request received without Ad: ' + this.responseURL);
      return;
    }

    updateAdOnFailure(this, e);

    xhr = null; // end the visit
  };

  var onVisitResponse = function () {

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
      ad.parsedTargetUrl = url.substring(url.lastIndexOf('http'));

      log("[FB-EXT] Parsed: ", ad.parsedTargetUrl);

      return true;
    }
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

      var elapsed = (now - xhr.delegate.attemptedTs);

      // TODO: why does this happen... a redirect?
      warn('[TRYING] Attempt to reuse xhr from ' + elapsed + " ms ago");

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

        warn("Invalid TargetUrl: " + url);
        return false;
      }
    }

    ad.targetUrl = trimChar(ad.targetUrl, '/');
    ad.targetDomain = domainFromURI(ad.resolvedTargetUrl || ad.targetUrl);
    ad.targetHostname = µb.URI.hostnameFromURI(ad.resolvedTargetUrl || ad.targetUrl);

    return true;
  }

  var domainFromURI = function (url) { // via uBlock/psl

    return µb.URI.domainFromHostname(µb.URI.hostnameFromURI(url));
  }

  var validateFields = function (ad) { // no side-effects

    if (ad.visitedTs === 0 && ad.attempts > 0) {

      warn('Invalid visitTs/attempts pair', ad);
      ad.attempts = 0; // shouldn't happen
    }

    if (!ad.pageUrl.startsWith('http'))
      warn('Possbly Invalid PageURL! '+ad.pageUrl);

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
      count = adCount();

    if (!ad) warn("No Ad to delete", id, admap);

    if (admap[ad.pageUrl]) {

      var hash = computeHash(ad);

      if (admap[ad.pageUrl][hash]) {

        delete admap[ad.pageUrl][hash];

      } else {

        warn('Unable to find ad: ', ad, admap);
      }
    }

    if (adCount() < count) {

      log('[DELETE] ' + adinfo(ad));
      updateBadges();

    } else {

      warn('Unable to delete: ', ad);
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

    //console.log('adsForUI.notes: ',notifications);
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

      var hashes = Object.keys(map[pages[i]]);
      for (var j = 0; j < hashes.length; j++) {

        var hash = hashes[j];
        if (type(hash) !== 'string' || !(validMD5(hash) || hash.includes('::'))) {

          warn('Bad hash in import: ', hash, ad); // tmp
          return false;
        }

        var ad = map[pages[i]][hash];
        if (validateFields(ad)) {

          validateTarget(ad); // accept either way

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

      warn('no pages: ', pages);
      return false;
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

    // if vault/menu is open, send the new ad
    var json = adsForUI(ad.pageUrl);
    json.what = 'adDetected';
    json.ad = ad;

    //if (automatedMode) json.automated = true; // not used ?

    vAPI.messaging.broadcast(json);

    if (µb.userSettings.showIconBadge)
      µb.updateBadgeAsync(tabId);

    storeUserData();
  }

  var activeBlockList = function (test) {

    return enabledBlockLists.contains(test);
  }

  // check that the rule is not disabled in 'disabledBlockingRules'
  var ruleDisabled = function (test) {

    return disabledBlockingRules.contains(test);
  };

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
   *  NOTE: this is called AFTER our dnt rules, and checks the following:
   *  1) whether we are blocking at all
   *  		if not, return false
   *  2) whether domain is blockable (allowAnyBlockOnDomains)
   *  		if so, return true;
   *  3) if it is in the globally disabled rules (disabledBlockingRules)
   *  		if so return false
   *  4) if any list it was found on allows blocks
   *  		if so, return true;
   */
  var isBlockableRequest = function (context) {

    if (µb.userSettings.blockingMalware === false) {

      logNetAllow('NoBlock', context.rootDomain + ' => ' + context.requestURL);
      return false;
    }

    if (!strictBlockingDisabled) {

      logNetAllow('Loading', context.rootDomain  + ' => ' + context.requestURL);
      return false;
    }

    if (isBlockableDomain(context)) {

      logNetBlock('Domains', context.rootDomain + ' => ' + context.requestURL);
      return true;
    }

    var snfe = µb.staticNetFilteringEngine,
      compiled = snfe.toResultString(1).slice(3),
      raw = snfe.filterStringFromCompiled(compiled),
      url = context.requestURL;

    if (ruleDisabled(raw)) {

      // TODO: check that the rule hasn't been added in 'My filters' ?
      //console.log(JSON.stringify(context,null,2));
      return allowRequest('RuleOff', raw, url);
    }

    // always allow redirect blocks from lists (?)
    if (µb.redirectEngine.toURL(context)) {

      logNetBlock('*Redirect*', context.rootDomain + ' => ' + context.requestURL, context);
      return true;
    }

    /*
      Check active rule(s) to see if we should block or allow
      Cases:
        A) no lists:      allow
        B) exception hit: allow
        C) block hit:     block
        D) no valid hits: allow, but no cookies later

        Note: not sure why case A) ever happens, but appears to
        only soon after an update to MyRules, perhaps before rule is compiled
     */
    var lists = listsForFilter(compiled);

    if (lists.length === 0) {                                // case A

      logNetAllow('NoList', raw, url);
      return false;
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

  var allowRequest = function (msg, raw, url) {

    // Note: need to store allowed requests here so that we can
    // block any incoming cookies later (see #301)
    allowedExceptions[url] = +new Date();
    if (msg !== 'EasyList')
      logNetEvent('[ALLOW!]', msg, raw + ': ', url);
    return false;
  }

  var isAutomated = function () {

    return (automatedMode && automatedMode.length);
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

  exports.adsForVault = function (request, pageStore, tabId) {

    return adsForUI();
  }

  exports.mustAllowRequest = function (result, context) {

    return result && result.length && !isBlockableRequest(context);
  }

  exports.itemInspected = function (request, pageStore, tabId) {

    if (request.id) {
      var ad = adById(request.id)
      inspected = ad;
    }
  };

  var contentPrefs = exports.contentPrefs = function (hostname) {

    // preferences relevant to our ui/content-scripts
    var us = µb.userSettings;
    var showDnt = /*hostname &&*/ (us.disableHidingForDNT && us.dntDomains.contains(hostname));

    //console.log('contentPrefs: '+hostname, "VISIBLE: "+showDnt);

    return {
        hidingDisabled: !us.hidingAds || showDnt,
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

    ads.forEach(function (ad) {
      ad.current = false;
    });

    if (automatedMode === 'selenium' && requestURL === 'http://rednoise.org/ad-auto-export')
      exportAds();

    markUserAction();
  };

  exports.onListsLoaded = function (firstRun) {

    console.log('onListsLoaded:', firstRun);
    µb.staticFilteringReverseLookup.initWorker(function (entries) {

      listEntries = entries;
      //console.log('listEntries:', listEntries);
      var keys = Object.keys(entries);
      log("[LOAD] Compiled " + keys.length +
        " 3rd-party lists in " + (+new Date() - profiler) + "ms");
      strictBlockingDisabled = true;
      verifyAdBlockers();
      verifySettings();
      verifyLists(µb.remoteBlacklists);
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

    url = trimChar(url, '/'); // no trailing slash

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

      warn("Invalid Ad: ", ad);
      return;
    }

    if (!internalLinkDomains.contains(ad.pageDomain) && internalTarget(ad)) {

      warn('[INTERN] Ignoring Ad on '+ad.pageDomain+', target: '+ad.targetUrl);
      return; // testing this
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

    if (µb.userSettings.eventLogging)
      log('[INJECT] Dynamic-iFrame: ' + request.parentUrl, request, tabId + '/' + frameId);

    // Firefox already handles this correctly
    vAPI.chrome && vAPI.onLoadAllCompleted(tabId, frameId);
  };

  exports.checkAllowedException = function (url, headers) {

    if (typeof allowedExceptions[url] !== 'undefined')
      return blockIncomingCookies(headers, url);
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

    var dntEnabled = (us.clickingAds && us.disableClickingForDNT) || (us.hidingAds && us.disableHidingForDNT);
    if (dntEnabled) {

      var originalHostname = µb.URI.hostnameFromURI(originalUrl);
      if (us.dntDomains.contains(originalHostname)) { // 1st-party: only check original-request per EFF spec

        log('[DNT] (AllowCookie1p)', originalUrl);
        return false;
      }
    }

    //console.log("1pDomain: '"+µb.URI.hostnameFromURI(originalUrl)+"' / '" +
      //µb.URI.hostnameFromURI(requestUrl)+"'", " original='"+originalUrl+"'");

    for (var i = headers.length - 1; i >= 0; i--) {

      var name = headers[i].name.toLowerCase();

      dbug && console.log(i + ') '+name, headers[i].value);

      if (name === 'set-cookie' || name === 'set-cookie2') {

        if (0) { // TODO: do we block 3rd party-requests to DNT-domains? disabled for now

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
      data += JSON.stringify(adById(id));
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

    var result = [], pages = pageUrl ? [ YaMD5.hashStr(pageUrl) ]
      : Object.keys(admap || µb.userSettings.admap);

    for (var i = 0; i < pages.length; i++) {

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

    vAPI.getAddonInfo(function (UBlockConflict, AdBlockPlusConflict) {

      if (AdBlockPlusConflict) {

        modified = addNotification(notes, AdBlockPlusEnabled);

      } else {

        modified = removeNotification(notes, AdBlockPlusEnabled);
      }

      if (UBlockConflict) {

        modified = addNotification(notes, UBlockEnabled);

      } else {

        modified = removeNotification(notes, UBlockEnabled);
      }

      modified && sendNotifications(notes);
    });
  }

  exports.verifyAdBlockersAndDNT = function (request) {

    verifyDNT(request);
    verifyAdBlockers();
  }

  var verifySettings = exports.verifySettings = function () {

    verifySetting(HidingDisabled, !µb.userSettings.hidingAds);
    verifySetting(ClickingDisabled, !µb.userSettings.clickingAds);
    verifySetting(BlockingDisabled, !µb.userSettings.blockingMalware);
  }

  var verifyLists = exports.verifyLists = function (lists) {

    verifyList(EasyList, lists);
    verifyList(AdNauseamTxt, lists);
  }

  var verifyList = exports.verifyList = function (note, lists) {

    var notes = notifications,
      modified = false,
      path, entry;

    for (path in lists) {
      if (lists.hasOwnProperty(path) === false) {
        continue;
      }
      entry = lists[path];
      if (path === note.listUrl) {

        if (entry.off === true && notes.contains(note)) {

          modified = addNotification(notes, note);
        }
        else if (entry.off === false) {

          modified = removeNotification(notes, note);
        }
      }
    }

    if (modified) sendNotifications(notes);
  }

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
    if (disableClicking && disableHiding)
      note = DNTAllowed;
    else if (disableClicking && !disableHiding)
      note = DNTHideNotClick;
    else if (!disableClicking && disableHiding)
      note = DNTClickNotHide;

    if (!notifications.contains(note)) {

      addNotification(notifications, note);

      if (target && target != note) {

        removeNotification(notifications, target);
      }

      sendNotifications(notifications);
    }
  }
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

        //console.log('clicking: ', state, µb.userSettings.clickingAds || µb.userSettings.clickingAds
        var off = !(µb.userSettings.clickingAds || µb.userSettings.hidingAds);
        µb.selectFilterLists({ location: µb.adnauseam.dnt.effList, off: off })
      }

      sendNotifications(notes);
    }
  }

  // Returns the count for current-marked ads for the url
  // or if none exists, then all ads stored for the url
  var currentCount = exports.currentCount = function (url) {

    return adlist(url, true).length || adlist(url).length;
  }

  var clearAds = exports.clearAds = function () {

    var pre = adCount();

    clearAdmap();
    reloadExtPage('vault.html');
    updateBadges();
    storeUserData();
    computeNextId();

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
    clearVisitData && clearAdVisits();
    storeUserData();

    importedCount = adCount() - count;
    log('[IMPORT] ' + importedCount + ' ads from ' + request.file);
    reloadExtPage('vault.html'); // reload Vault page if open

    validateHashes();

    return {
      what: 'importConfirm',
      count: importedCount
    };
  }

  exports.getNotifications = function () {

    return notifications;
  }

  var exportAds = exports.exportAds = function (request) {

    var count = adCount(),
        filename = (request && request.filename) || getExportFileName(),
        blob = new Blob([JSON.stringify(admap)], {type : "text/plain"}),
        url = URL.createObjectURL(blob);

    vAPI.download({
      'url': url,
      'filename': filename
    });

    if (!production && request.includeImages) saveVaultImages();

    log('[EXPORT] ' + count + ' ads to ' + filename);
  };

   //Crashes over approx. 725 image/70MB
   var saveVaultImages = function (jsonName) {

    var imgURLs = []; // extract image urls
    adlist().forEach(function (ad) {
      if (ad.contentType === 'img')
        imgURLs.push(ad.contentData.src);
    });

    // download them to a folder next to the export file (with same name -json)
    // handle #639 here

    var zipNameParts = jsonName.split(".");
    var zipName = zipNameParts.splice(0, zipNameParts.length - 2).join('_');


    var files = [], lastFilesLength = 0;

    for (var i = 0; i < imgURLs.length; i++) {
        var url = imgURLs[i];

    (function(url){
            var parts = url.split("/"),
                filename = parts[parts.length - 1];

            // for now:
            filename = "image_"+i+".jpg"

            var img = new Image();
            img.onload = function() {
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

                // Add to file array [{name, data}]
                files.push({ name: filename, data: getBase64Image(img) });
            }

            img.onerror = function() {
                log("Error");
                var index = imgURLs.indexOf(url);
                if (index > -1) {
                    imgURLs.splice(index, 1);
                }
            }
      img.src = url;
    })(url);

  }


  var check = setInterval(function(){

    log("checking", files.length, imgURLs.length, lastFilesLength);

    if (files.length === imgURLs.length || files.length === lastFilesLength) {

            clearInterval(check);

            var zip = new JSZip(),
                img = zip.folder(zipName),
                zipcount = 0;

            for (var i = 0; i < files.length; i++) {
                img.file(files[i].name, files[i].data, {base64: true});
            }
            //type base64 or blob???
            zip.generateAsync({
                type:"base64"
            }).then(function(content) {
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

  function getBase64Image(img) {

     // Create an empty canvas element
     var canvas = document.createElement("canvas");
     canvas.width = img.width;
     canvas.height = img.height;

     // Copy the image contents to the canvas
     var ctx = canvas.getContext("2d");
     ctx.drawImage(img, 0, 0);

     // Get the data-URL formatted image
     // Firefox supports PNG and JPEG. You could check img.src to
     // guess the original format, but be aware the using "image/jpg"
     // will re-encode the image.
     try {
         var dataURL = canvas.toDataURL("image/png");
         return dataURL.replace(/^data:image\/(png|jpg);base64,/, "");
     } catch (err) {
         log(err);
         return '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';
     }

 }


//Src: http://stackoverflow.com/questions/16245767/creating-a-blob-from-a-base64-string-in-javascript
 function b64toBlob(b64Data, contentType, sliceSize) {
     contentType = contentType || '';
     sliceSize = sliceSize || 512;

     var byteCharacters = atob(b64Data);
     var byteArrays = [];

     for (var offset = 0; offset < byteCharacters.length; offset += sliceSize) {
         var slice = byteCharacters.slice(offset, offset + sliceSize);

         var byteNumbers = new Array(slice.length);
         for (var i = 0; i < slice.length; i++) {
             byteNumbers[i] = slice.charCodeAt(i);
         }

         var byteArray = new Uint8Array(byteNumbers);

         byteArrays.push(byteArray);
     }

     var blob = new Blob(byteArrays, { type: contentType });
     return blob;
 }

  exports.adsForPage = function (request, pageStore, tabId) {

    var reqPageStore = request.tabId &&
      µb.pageStoreFromTabId(request.tabId) || pageStore;

    if (!reqPageStore)
      warn('No pageStore', request, pageStore, tabId);

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
