//(function() {

'use strict';

// functions shared between views

function extractDomains(fullUrl) { // used in targetDomain

  var matches, result = [],
    re = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;

  while ((matches = re.exec(fullUrl))) {
    result.push(matches[0]);
  }

  return result;
}

function parseDomain(url) {

  var domain, domains = extractDomains(url);

  if (domains.length)
    domain = new URL(domains.pop()).hostname;

  //console.log('parsed-domain: ' + domain);

  return domain;
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

function arrayRemove(arr, obj) {

  var i = arr.indexOf(obj);
  if (i != -1) {
    arr.splice(i, 1);
    return true;
  }
  return false;
}

function showAlert(msg) {

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

var computeHash = function (ad) { // DO NOT MODIFY

  if (!ad) return;

  if (!ad.contentData || !ad.pageUrl) {
    console.error("Invalid Ad: no contentData || pageUrl", ad);
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

/*
 * Start with resolvedTargetUrl if available, else use targetUrl
 * Then extract the last domain from the (possibly complex) url
 */
function targetDomain(ad) {

  var dom = parseDomain(ad.resolvedTargetUrl || ad.targetUrl);

  if (!dom)
    console.warn("Unable to parse domain: " + url);
  else
    dom + ' (#' + ad.id + ')'; // testing-only

  return dom;
}

var stringNotEmpty = function (s) {

  return typeof s === 'string' && s !== '';
};

//  return exports;
//})();
