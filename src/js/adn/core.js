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

µBlock.adnauseam = (function() {

'use strict';

var µb = µBlock;

/******************************************************************************/

var admap = {}, count;

// ignore adchoices
var imageIgnores = [ 'http://pagead2.googlesyndication.com/pagead/images/ad_choices_en.png' ];

// block scripts from these page domains (either regex or string)
var blockablePageDomains = []; //'www.webpronews.com', 'www.tomshardware.com', 'www.zdnet.com', 'www.techrepublic.com'],

// always block scripts from these domains (either regex or string)
var blockableScriptDomains = [ 'partner.googleadservices.com' ];

var flatten = function(map) {

  var ads, result = [], pages = Object.keys(map);
  for (var i = 0; i < pages.length; i++) {
    ads = map[pages[i]];
    for (var j = 0; j < ads.length; j++)
      result.push(ads[j]);
  }
  return result;
}

var initialize = function() {

  // compute the highest id in our admap
  count = Math.max(0, (Math.max.apply(Math,
    flatten(admap).map(function(ad) {
      return ad.id;
    }))));

  console.log('adnauseam.initialized('+count+')');
};

var computeHash = function(ad) {

  var hash = '';
  for (var key in ad.contentData) {
    hash += ad.contentData[key] + '::';
  }
  hash += ad.title;
  return hash;
}

var stringNotEmpty = function(s) {
    return typeof s === 'string' && s !== '';
};

var visitURL = function(url, onLoad, onError) {

    console.log('adnauseam.visitURL("%s"):', url);

    if ( typeof onError !== 'function' ) {
        onError = onLoad;
    }

    var onResponseReceived = function() {

        this.onload = this.onerror = this.ontimeout = null;

        // xhr for local files gives status 0, but actually succeeds
        var status = this.status || 200;
        if ( status < 200 || status >= 300 ) {
            return onError.call(this);
        }

        // consider an empty result to be an error
        if (stringNotEmpty(this.responseText) === false) {
            return onError.call(this);
        }

        return onLoad.call(this);
    };

    var onErrorReceived = function() {
        this.onload = this.onerror = this.ontimeout = null;
        onError.call(this);
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
    }
    catch (e) {
        onErrorReceived.call(xhr);
    }
};

var onVisitSuccess = function() {
    if (!stringNotEmpty(this.responseText)) {
        console.error('µBlock> readRepoCopyAsset("%s") / onRepoFileLoaded("%s"): error', path, repositoryURL);
        cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
        return;
    }
    // update ad
    // update global stats
    // send message to menu/vault (if open)
};

var onVisitError = function() {
    console.error(errorCantConnectTo.replace('{{url}}', repositoryURL));
    // update ad
    // if 3rd failure, give-up and update global stats
};

/******************************* API ***************************************/

var visitAd = function(url, onLoad, onError) {
}

var adsForVault = function(pageUrl) {
}

var adsForMenu = function(pageUrl) {

  var ads = [], mapEntry = admap[pageUrl];
  if (mapEntry) {
    var keys = Object.keys(mapEntry);
    for (var i = 0; i < keys.length; i++) {
      ads.push(mapEntry[keys[i]]);
    }
  }
  return ads;
}

var registerAd = function(ad, pageUrl, pageDomain) {

  ad.id = ++count;
  ad.domain = pageDomain;
  ad.pageUrl = pageUrl;

  var adsOnPage = admap[pageUrl];

  if (!adsOnPage) {
    adsOnPage = {};
    admap[pageUrl] = adsOnPage;
  }

  // this will overwrite an older ad with the same key
  adsOnPage[ computeHash(ad) ] = ad;

  console.log('adnauseam.registerAd: #'+ad.id+'/'+Object.keys(adsOnPage).length);
};

initialize();

/******************************************************************************/

return {
  visitAd: visitAd,
  registerAd: registerAd,
  adsForMenu: adsForMenu,
  adsForVault: adsForVault
};

/******************************************************************************/

})();
