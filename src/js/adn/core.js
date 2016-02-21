/* global vAPI, uDom */

/* TODO

*/

µBlock.adnauseam = (function () {

  'use strict';

  var µb = µBlock;

  /******************************************************************************/

  var admap, current,
    count = 0,
    visitmap = {},
    initialized = 0,
    lastActivity = 0,
    pollingDisabled = 0,
    maxAttemptsPerAd = 3,
    pollQueueInterval = 5000,
    repeatVisitInterval = 60000;

  // ignore adchoices
  var imageIgnores = [ 'http://pagead2.googlesyndication.com/pagead/images/ad_choices_en.png' ];

  // block scripts from these page domains (either regex or string)
  var blockablePageDomains = [ ]; //'www.webpronews.com', 'www.tomshardware.com', 'www.zdnet.com', 'www.techrepublic.com'],

  // always block scripts from these domains (either regex or string)
  var blockableScriptDomains = ['partner.googleadservices.com'];

  var initialize = function (settings) {

    admap = settings.admap;

    // compute the highest id in our admap
    count = Math.max(0, (Math.max.apply(Math,
      adlist().map(function (ad) {
        return ad.id;
      }))));

    // modify XMLHttpRequest to store original request
    var XMLHttpRequest_open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.requestUrl = url;
      return XMLHttpRequest_open.apply(this, arguments);
    };

    initialized = +new Date();

    console.log('adnauseam.initialized(' + count + ')', admap);

    if (!pollingDisabled) pollQueue();
  }

  var pollQueue = function (interval) {

    interval = interval || pollQueueInterval;

    markActivity();

    // TODO check options.disabled

    var elapsed = lastActivity - initialized,
      pending = pendingAds();

    console.log('pollQueue(' + elapsed + ') :: ' +
      pending.length + ' / ' + adlist().length);

    if (pending.length) {

      current = pending.sort(byField('-foundTs'))[0];
      visitAd(current);
    }

    var elapsed = millis() - lastActivity;

    if (!pollingDisabled)
      setTimeout(pollQueue, Math.max(1, interval - elapsed)); // next poll
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

  // returns all ads for a page, or all pages, if page arg is null
  var adlist = function (page) {

    var result = [],
      pages = page ? [page] : Object.keys(admap);

    for (var i = 0; i < pages.length; i++) {

      var hashes = Object.keys(admap[pages[i]]);

      for (var j = 0; j < hashes.length; j++)
        result.push(admap[pages[i]][hashes[j]]);
    }

    return result;
  }

/* TODO: remove from here, ref in shared
  function byField(prop) { //

    var sortOrder = 1;

    if (prop[0] === "-") {
      sortOrder = -1;
      prop = prop.substr(1);
    }

    return function (a, b) {
      var result = (a[prop] < b[prop]) ? -1 : (a[prop] > b[prop]) ? 1 : 0;
      return result * sortOrder;
    };
  }
  var computeHash = function (ad) { // TODO: remove from here, ref in shared

    var hash = '';
    for (var key in ad.contentData) {
      hash += ad.contentData[key] + '::';
    }
    hash += ad.title;
    return hash;
  }
  var stringNotEmpty = function (s) {

    return typeof s === 'string' && s !== '';
  };
*/
  var onVisitResponse = function () {

    //console.log('onVisitResponse', this);

    this.onload = this.onerror = this.ontimeout = null;

    var relatedAd = visitmap[this.requestUrl];

    if (!relatedAd) {
      console.error('Request received without Ad: ' + this.responseUrl);
      return;
    }

    // xhr for local files gives status 0, but actually succeeds
    var status = this.status || 200, html = this.responseText;
    if (status < 200 || status >= 300 || !stringNotEmpty(html)) {
      return onVisitError.call(this, relatedAd);
    }

    var title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (title && title.length > 1) {
      relatedAd.title = title[1].trim();
    }
    else {
      console.warn('Unable to parse title from: ' + html);
    }

    relatedAd.resolvedTargetUrl = this.responseURL; // URL after redirects

    relatedAd.visitedTs = millis();       // successful visit time

    delete visitmap[this.requestUrl]; // remove from current visit map

    console.log('VISITED: ' + relatedAd.contentType + 'Ad#' + relatedAd.id, relatedAd, this);

    storeUserData();
  };

  var onVisitError = function (ad, e) {

    console.error('onVisitError()', ad, this);
    this.onload = this.onerror = this.ontimeout = null;

    if (ad) {

      ad.visitedTs = -1 * millis();
      if (!ad.errors) ad.errors = [];
      ad.errors.push(this.status + ' (' + this.statusText + ')' + (e ? ' ' + e : ''));
    }
  };

  var visitAd = function (ad) {

    var url = ad.targetUrl;

    if (ad.attempts == maxAttemptsPerAd) // double-check
      return false;

    //console.log('visitAd("%s"):', url);

    // tell menu/vault we have a new 'current'
    //UIManager.updateOnAdAttempt(next);


    // TODO: check visitmap to see ad is not already in process of being visited (or has timed-out)

    var now = markActivity()
    var xhr = new XMLHttpRequest();

    ad.attempts++;
    ad.attemptedTs = now;
    visitmap[url] = ad; // add to current visits

    try {

      xhr.open('get', url, true);
      xhr.timeout = 5000;
      xhr.onload = onVisitResponse;
      xhr.onerror = onVisitError;
      xhr.ontimeout = onVisitError;
      xhr.responseType = ''; // 'document'?;
      xhr.send();

    } catch (e) {

      onErrorReceived.call(xhr, ad);
    }
  };

  var storeUserData = function(immediate) {

      // TODO: defer if we've recently written and !immediate
      µb.adnSettings.admap = admap;
      vAPI.storage.set(µb.adnSettings);
  }

  var validateTargetUrl = function(next) {

    if (!/^http/.test(next.targetUrl)) {

      // Here we try to extract an obfuscated URL
      //console.log("Ad.targetUrl(malformed): " + next.targetUrl);

      var idx = next.targetUrl.indexOf('http');
      if (idx != -1) {
        next.targetUrl = decodeURIComponent(next.targetUrl.substring(idx));
        //console.log("Ad.targetUrl Updated: " + next.targetUrl);

      } else {

        console.warn("Ad.targetUrl(PARSE-FAIL!!!): " + next.targetUrl);
      }
    }
  }

  /******************************* API ***************************************/

  // var openVault = function (pageStore) {
  //   console.log('adn.openVault()');
  //   //var url = vAPI.getURL('adn-vault.html');
  //   //vAPI.tabs.open('adn-vault.html');
  // }
  //
  // var openLog = function (pageStore) {
  //
  //   console.log('adn.openLog()');
  // }

  var adsForVault = function () {
    var json = {};
    json.data = adlist();
    json.current = current;
    console.log('adn.adsForVault() :: '+json.data.length);
    return json;
  }

  var adsForMenu = function (pageStore) {

    var ads = [],
      mapEntry = admap[pageStore.rawURL];
    if (mapEntry) {
      var keys = Object.keys(mapEntry);
      for (var i = 0; i < keys.length; i++) {
        ads.push(mapEntry[keys[i]]);
      }
    }
    return ads;
  }

  var millis = function () {
    return +new Date();
  }

  var registerAd = function (pageStore, ad) {

    var pageUrl = pageStore.rawURL,
      pageDomain = pageStore.tabHostname;

    validateTargetUrl(ad);

    var adsOnPage = admap[pageUrl];

    if (!adsOnPage)
      admap[pageUrl] = (adsOnPage = {});

    var adhash = computeHash(ad);

    if (adsOnPage[adhash]) { // this is a duplicate

      var orig = adsOnPage[adhash],
        msSinceFound = millis() - orig.foundTs;

      if (msSinceFound < repeatVisitInterval) {
        console.log('DUPLICATE: ' + orig.contentType +
            'Ad#' + orig.id + ' found '+msSinceFound+' ms ago');
        return;
      }
    }

    ad.id = ++count;
    ad.domain = pageDomain;
    ad.pageUrl = pageUrl;

    // this will overwrite an older ad with the same key
    adsOnPage[adhash] = ad;

    console.log('DETECTED: ' + ad.contentType + 'Ad#' + ad.id, ad);

    storeUserData();
    /*vAPI.storage.set(µb.adnSettings, function() {
        vAPI.storage.get(µb.adnSettings, function(result){
            console.log('Settings', result);
            //console output = myVariableKeyName {myTestVar:'my test var'}
        });
    });*/

    return ad;
  };

  vAPI.storage.get(µb.adnSettings, initialize);

  /******************************************************************************/

  return {
    registerAd: registerAd,
    adsForMenu: adsForMenu,
    adsForVault: adsForVault
  };

  /******************************************************************************/

})();
