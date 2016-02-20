/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2015 Raymond Hill

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

    Home: https://github.com/gorhill/uBlock
*/

/******************************************************************************/

µBlock.adnauseam = (function () {

  'use strict';

  var µb = µBlock;

  /******************************************************************************/

  var lastActivity, count, initialized, admap = {},
    pollQueueInterval = 5000, pollingDisabled = true;

  // ignore adchoices
  var imageIgnores = ['http://pagead2.googlesyndication.com/pagead/images/ad_choices_en.png'];

  // block scripts from these page domains (either regex or string)
  var blockablePageDomains = []; //'www.webpronews.com', 'www.tomshardware.com', 'www.zdnet.com', 'www.techrepublic.com'],

  // always block scripts from these domains (either regex or string)
  var blockableScriptDomains = ['partner.googleadservices.com'];

  var initialize = function () {

    // compute the highest id in our admap
    count = Math.max(0, (Math.max.apply(Math,
      adlist().map(function (ad) {
        return ad.id;
      }))));

    initialized = +new Date();

    if (!pollingDisabled) pollQueue();

    console.log('adnauseam.initialized(' + count + ')');
  };

  function byField(prop) {

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

  var pollQueue = function (interval) {

    interval = interval || pollQueueInterval;

    markActivity();

    // 1. check options.disabled
    // 2. check for non-visited ads
    // 3.

    var pending = pendingAds();

    console.log('pollQueue(' + (lastActivity - initialized) + ') :: ' +
      adlist().length + ' / ' + pending.length);

    if (pending.length) {

      var mostRecentAd = pending.sort(byField('-foundTs'))[0];
      visitAd(mostRecentAd);
    }

    var elapsed = +new Date() - lastActivity;

    setTimeout(pollQueue, Math.max(1, interval - elapsed)); // next poll
  }

  var visitAd = function (next) {

    if (/^http/.test(next.targetUrl)) {

      console.log("TRYING(#" + next.id + "): " + next.targetUrl);

      // tell menu/vault we have a new 'current'
      //UIManager.updateOnAdAttempt(next);

      visitUrl(next.targetUrl);

    } else {

      // Here we try to extract an obfuscated URL, see issue #394
      console.warn("Visitor(MALFORMED-URL): " + next.targetUrl, next);

      var idx = next.targetUrl.indexOf('http');
      if (idx != -1) {

        next.targetUrl = decodeURIComponent(next.targetUrl.substring(idx));
        console.log("Visitor(PARSED): " + next.targetUrl);
      }
      else {
        console.log("Visitor(PARSED-FAIL): " + next.targetUrl);
      }
    }
  }

  var markActivity = function () {

    return (lastActivity = +new Date());
  }

  var pendingAds = function () {

    return adlist().filter(function (a) {
      return a.visitedTs === 0;
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

  var computeHash = function (ad) {

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

  var visitUrl = function (url) {

    // WORKING HERE

    console.log('adnauseam.visitUrl("%s"):', url);

    markActivity();

    var onResponseReceived = function () {

      console.log('adnauseam.onResponseReceived()');

      this.onload = this.onerror = this.ontimeout = null;

      // xhr for local files gives status 0, but actually succeeds
      var status = this.status || 200;
      if (status < 200 || status >= 300) {
        return onErrorReceived.call(this);
      }

      // consider an empty result to be an error
      if (stringNotEmpty(this.responseText) === false) {
        return onErrorReceived.call(this);
      }
    };

    var onErrorReceived = function () {

      console.log('adnauseam.onErrorReceived()');
      this.onload = this.onerror = this.ontimeout = null;
    };

    var xhr = new XMLHttpRequest();
    try {
      xhr.open('get', url, true);
      xhr.timeout = xhrTimeout;
      xhr.onload = onResponseReceived;
      xhr.onerror = onErrorReceived;
      xhr.ontimeout = onErrorReceived;
      xhr.responseType = 'text';
      xhr.send();
    } catch (e) {
      onErrorReceived.call(xhr);
    }
  };

  var onVisitSuccess = function () {

    markActivity();

    if (!stringNotEmpty(this.responseText)) {
      console.log('onVisitSuccess -> ' + responseText.length);
      // console.error('µBlock> readRepoCopyAsset("%s") / onRepoFileLoaded("%s"): error', path, repositoryURL);
      // cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
      // return;
    } else {
      console.log('onVisitSuccess FAIL: ' + this.responseText);
    }
    // update ad
    // update global stats
    // send message to menu/vault (if open)
  };

  var onVisitError = function () {
    markActivity();
    console.error(errorCantConnectTo.replace('{{url}}', this.url));
    // update ad
    // if 3rd failure, give-up and update global stats
  };

  /******************************* API ***************************************/

  var openVault = function(pageStore) {
      console.log('adn.openVault()');
      //var url = vAPI.getURL('adn-vault.html');
      //vAPI.tabs.open('adn-vault.html');
  }

  var openLog = function(pageStore) {
      console.log('adn.openVault()');
  }

  var adsForVault = function(pageStore) {

    var ads = [],
      mapEntry = admap[pageStore.rawURL];
    return ads;
  }

  var adsForMenu = function(pageStore) {

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

  var registerAd = function(pageStore, ad) {

    var pageUrl = pageStore.rawURL,
      pageDomain = pageStore.tabHostname;

    ad.id = ++count;
    ad.domain = pageDomain;
    ad.pageUrl = pageUrl;

    var adsOnPage = admap[pageUrl];

    if (!adsOnPage) {
      adsOnPage = {};
      admap[pageUrl] = adsOnPage;
    }

    // this will overwrite an older ad with the same key
    adsOnPage[computeHash(ad)] = ad;
    //admap[pageUrl] = adsOnPage;

    console.log('adnauseam.registerAd: #' + ad.id + '/' + adlist().length);

    return ad;
  };

  initialize();

  /******************************************************************************/

  return {
    openLog: openLog,
    openVault: openVault,
    registerAd: registerAd,
    adsForMenu: adsForMenu,
    adsForVault: adsForVault
  };

  /******************************************************************************/

})();
