/*******************************************************************************

    AdNauseam - Fight back against advertising surveillance.
    Copyright (C) 2014-2016 Daniel C. Howe

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

    Home: https://github.com/dhowe/AdNauseam
*/

// functions shared between addon and ui

'use strict';

var requiredList = 'assets/thirdparties/easylist-downloads.adblockplus.org/easylist.txt';

var rand = function (min, max) {

  if (arguments.length == 1) {
    max = min;
    min = 0;
  } else if (!arguments.length) {
    max = 1;
    min = 0;
  }

  return Math.floor(Math.random() * (max - min)) + min;
}

var setCost = function(numVisited) {

  //console.log('setCost: '+numVisited);

  var $west = uDom('#worth-estimate'),
    $cost = uDom('.cost');

  if (numVisited > 0) {
    $cost.removeClass('hidden');
    $west.text('= $'+ (numVisited * 1.58).toFixed(2));
  }
  else {
    $cost.addClass('hidden');
  }
}

var arrayRemove = function (arr, obj) {

  var i = arr.indexOf(obj);
  if (i != -1) {
    arr.splice(i, 1);
    return true;
  }
  return false;
}

var trimChar = function (s, chr) {

  while (s.endsWith(chr)) {
    s = s.substring(0, s.length - chr.length);
  }

  return s;
}

var showAlert = function (msg) {

  if (msg) {

    $("#alert").removeClass('hide');
    $("#alert p").text(msg);

  } else {

    $("#alert").addClass('hide');
  }
}

var type = function (obj) { // from Angus Croll

  return ({}).toString.call(obj).match(/\s([a-zA-Z]+)/)[1].toLowerCase()
}

var getExportFileName = function () {

  return vAPI.i18n('adnExportedAdsFilename')
    .replace('{{datetime}}', new Date().toLocaleString())
    .replace(/[:/,]+/g, '.').replace(/ +/g, '');
}

var computeHash = function (ad) { // DO NOT MODIFY

  if (!ad) return;

  if (!ad.contentData || !ad.pageUrl) {
    console.error("Invalid Ad: no contentData || pageUrl", ad);
    return;
  }

  var hash = ad.pageDomain || ad.pageUrl, // change from pageUrl (4/3/16) ***
  // fall back to pageUrl if pageDomain is undefined for backward compatibility
    keys = Object.keys(ad.contentData).sort();

  for (var i = 0; i < keys.length; i++) {
    hash += '::' + ad.contentData[keys[i]];
  }

  return hash;
}

var byField = function (prop) {

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

var stringNotEmpty = function (s) {

  return typeof s === 'string' && s !== '';
};

/************************ URL utils *****************************/

var parseHostname = function (url) {

  return new URL(url).hostname;
}

// TODO: replace with core::domainFromURI?
var parseDomain = function (url, useLast) {

  var domains = decodeURIComponent(url).match(/https?:\/\/[^?\/]+/g);
  return domains.length ? new URL(
      useLast ? domains[domains.length - 1] : domains[0])
      .hostname : undefined;
}

/*
 * Start with resolvedTargetUrl if available, else use targetUrl
 * Then extract the last domain from the (possibly complex) url
 */
var targetDomain = function (ad) {

  var dom = parseDomain(ad.resolvedTargetUrl || ad.targetUrl, true);

  if (!dom) console.warn("Unable to parse domain: " + url);

  return dom;
}

/*** functions used to export/import/clear ads in vault.js and options.js ***/

var exportToFile = function () {

  vAPI.messaging.send('adnauseam', {
    what: 'exportAds',
    filename: getExportFileName()
  });
};

function handleImportFilePicker(evt) {

  var files = evt.target.files;
  var reader = new FileReader();

  reader.onload = function (e) {

    var adData;
    try {
      adData = JSON.parse(e.target.result);
    }
    catch(e){
      postImportAlert({ count: -1, error: e });
      return;
    }

    vAPI.messaging.send('adnauseam', {
      what: 'importAds',
      data: adData,
      file: files[0].name
    }, postImportAlert);
  }

  reader.readAsText(files[0]);
}

var postImportAlert = function (msg) {

  var text = msg.count > -1 ? msg.count : msg.error;
  vAPI.alert(vAPI.i18n('adnImportAlert')
    .replace('{{count}}', text));
};

var startImportFilePicker = function () {

  var input = document.getElementById('importFilePicker');
  // Reset to empty string, this will ensure an change event is properly
  // triggered if the user pick a file, even if it is the same as the last
  // one picked.
  input.value = '';
  input.click();
};

var clearAds = function () {

  var msg = vAPI.i18n('adnClearConfirm');
  var proceed = vAPI.confirm(msg);
  if (proceed) {
    vAPI.messaging.send('adnauseam', {
      what: 'clearAds'
    });
  }
};
