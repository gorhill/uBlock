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

  var computeHash = function (ad) {

    var hash = '';
    for (var key in ad.contentData) {
      hash += ad.contentData[key] + '::';
    }
    //hash += ad.title; // this can change
    //hash += ad.targetUrl;
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
