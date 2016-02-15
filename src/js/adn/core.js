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
      // result.push.apply(result, ads); // TODO
  }
  return result;
}

var initialize = function() {

  var adlist = flatten(admap);

  count = Math.max(0, 1 + (Math.max.apply(Math,
    adlist.map(function(ad) {
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
  //console.log(hash);
  return hash;
}

var adsForPage = function(pageUrl) {

  var ads = [];
  var mapEntry = admap[pageUrl];
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

  // var existing = adsOnPage[computeHash(ad)];
  // if (existing) console.log("overwriting: "+existing.id);

  // this will overwrite an older ad with the same key
  adsOnPage[ computeHash(ad) ] = ad;

  console.log('adnauseam.registerAd: #'+ad.id+'/'+Object.keys(adsOnPage).length);
};

initialize();

/******************************************************************************/

return {
  registerAd: registerAd,
  adsForPage: adsForPage
};

/******************************************************************************/

})();
