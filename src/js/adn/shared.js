//(function() {

'use strict';

// functions shared between views
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

var computeHash = function (ad) { // DO NOT MODIFY

  if (!ad) return;

  if (!ad.contentData || !ad.pageUrl)
    throw Error("Invalid Ad: no contentData||pageUrl", ad);

  var hash = ad.pageUrl,
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
var targetDomain = function (ad) {

  var result, url = ad.resolvedTargetUrl || ad.targetUrl,
    domains = extractDomains(url);

  if (domains.length)
    result = new URL(domains.pop()).hostname;
  else
    console.warn("[ERROR] '" + ad.targetUrl + "' url=" + url);

  if (result) result += ' (#' + ad.id + ')'; // testing-only

  return result;
}

var extractDomains = function (fullUrl) { // used in targetDomain()

  var result = [],
    matches,
    regexp = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;

  while ((matches = regexp.exec(fullUrl)))
    result.push(matches[0]);

  return result;
}

var stringNotEmpty = function (s) {

  return typeof s === 'string' && s !== '';
};

//  return exports;
//})();
