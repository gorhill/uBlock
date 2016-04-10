// functions shared between addon and ui

'use strict';

var log = function () {
  console.log.apply(console, arguments);
}

var warn = function () {
  console.warn.apply(console, arguments);
}

var err = function () {
  console.error.apply(console, arguments);
}

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

var arrayRemove = function (arr, obj) {

  var i = arr.indexOf(obj);
  if (i != -1) {
    arr.splice(i, 1);
    return true;
  }
  return false;
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
    err("Invalid Ad: no contentData || pageUrl", ad);
    return;
  }

  var hash = ad.pageDomain, // change from pageUrl (4/3/16) ***
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

var extractDomains = function (fullUrl, useLast) { // used in targetDomain

  var matches, result = [],
    re = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;

  while ((matches = re.exec(fullUrl))) {
    result.push(useLast ? matches[matches.length-1] : matches[0]);
  }

  return result;
}

var parseDomain = function (url, useLast) {

  var domain, domains = extractDomains(url, useLast);

  if (domains.length)
    domain = new URL(domains.pop()).hostname;

  //log('parsed-domain: ' + domain);

  return domain;
}

/*
 * Start with resolvedTargetUrl if available, else use targetUrl
 * Then extract the last domain from the (possibly complex) url
 */
var targetDomain = function (ad) {

  var dom = parseDomain(ad.resolvedTargetUrl || ad.targetUrl);

  if (!dom)
    warn("Unable to parse domain: " + url);
  else
    dom + ' (#' + ad.id + ')'; // testing-only

  return dom;
}
