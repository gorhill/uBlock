var dbugDetect = 0; // tmp

// Injected into content pages before contentscript-end.js
// jQuery polyfill: $is, $find, $attr, $text
(function (self) {

  'use strict';

  var prefs, adDetector = self.adDetector = self.adDetector || {};

  if (adDetector.findAds) return;

  vAPI.messaging.send('adnauseam', {
    what: 'getPreferences'
  }, function (req) {
    prefs = req;
    console.log('AdNaauseam.prefs:', req);
  });

  vAPI.messaging.addChannelListener('adnauseam', messageListener);

  adDetector.findAds = function (elem) {

    switch (elem.tagName) {

    case 'IFRAME':
      elem.addEventListener('load', handleIFrame, false);
      break;

    case 'IMG':
      if (findImageAds([elem])) break;
      // fall-through

    default:

      // check the element for child imgs
      var imgs = elem.querySelectorAll('img');
      if (imgs.length && findImageAds(imgs))
        return;

      // else try text
      prefs.parseTextAds && findTextAds(elem);
    }
  }

  var findTextAds = function (elem) {

    var activeFilters = true ? filters : filters.filter(function (f) {
      return f.domain.test(document.domain);
    });

    var ads = checkFilters(activeFilters, elem);
    if (ads && ads.length) {

      for (var i = 0; i < ads.length; i++) {

        if (ads[i]) {

          console.log("TEXT-AD", ads[i]);
          notifyAddon(ads[i]);
        }
      }
    }
  }

  var handleIFrame = function () { // this

    //console.log('handleIFrame', this);
    var html, doc;
    try {
      doc = this.contentDocument;
    } catch (e) {
      console.warn(e);
    }
    try {
      doc = doc || this.contentWindow.document;
    } catch (e) {
      console.warn(e);
    }
    try {
      doc = doc || (window.frames[this.name] && window.frames[this.name].document);
    } catch (e) {
      console.warn(e);
    }

    if (doc) {
      var body = $find(doc, 'body');
      var imgs = body.length && $find(body, 'img');
      console.log("IMGS!!", imgs.length);
      findImageAds(imgs);
    } else {

      console.log("NO-DOC for IFRAME[" + this.name + "]=" + this.src);
    }

    this.removeEventListener('load', handleIFrame, false);
  }

  var findImageAds = function (imgs) {

    var target, targetUrl, ad, hits = 0;

    for (var i = 0; i < imgs.length; i++) {

      var imgSrc = imgs[i].src || imgs[i].getAttribute("src");

      if (!imgSrc) {

        if (dbugDetect) console.log("No ImgSrc(#" + i + ")!", imgs[i]);
        imgs[i].addEventListener('load', processDelayedImage, false);
        continue;
      }

      if (processImage(imgs[i], imgSrc)) hits++;
    }

    return hits > 0;
  }

  var pageCount = function (ads, pageUrl) {

    var num = 0;
    for (var i = 0; i < ads.length; i++) {
      if (ads[i].pageUrl === pageUrl)
        num++;
    }
    return num;
  }

  var clickableParent = function (node) {

    var checkParent = function (adNode) {

      var hasParent = adNode.parentNode &&
        (adNode.parentNode.tagName == 'A' ||
          adNode.parentNode.tagName == 'OBJECT' ||
          adNode.parentNode.tagName == 'IFRAME' ||
          (adNode.hasAttribute && adNode.hasAttribute('onclick')));

      //console.log("check",adNode.tagName,adNode.parentNode);

      return hasParent;
    };

    var adNode = node;

    while (checkParent(adNode))
      adNode = adNode.parentNode;

    // returns adnode if found, or null
    return adNode === node ? null : adNode;
  };

  var Ad = function (network, targetUrl, data) {

    this.id = null;
    this.attempts = 0;
    this.visitedTs = 0; // 0=unattempted, -timestamp=err, +timestamp=ok
    this.attemptedTs = 0;
    this.contentData = data;
    this.contentType = data.src ? 'img' : 'text';
    this.title = data.title || 'Pending';
    this.resolvedTargetUrl = null;
    this.foundTs = +new Date();
    this.targetUrl = targetUrl;
    this.pageTitle = null;
    this.pageUrl = null;
    this.errors = null;
  };

  var notifyAddon = function (ad) {

    vAPI.messaging.send('adnauseam', {
      what: 'registerAd',
      ad: ad
    });
    return true;
  }

  var $is = function (elem, selector) { // jquery shim

    if (selector.nodeType) {
      return elem === selector;
    }

    var qa = (typeof (selector) === 'string' ?
        document.querySelectorAll(selector) : selector),
      length = qa.length,
      returnArr = [];

    while (length--) {
      if (qa[length] === elem) {
        return true;
      }
    }

    return false;
  };

  var $attr = function (ele, attr, val) { // jquery shim

    return val ? (ele.length ? ele[0] : ele).setAttribute(attr, val) :
      (ele.length ? ele[0] : ele).getAttribute(attr);
  };

  var $text = function (ele) { // jquery shim

    if (typeof ele.length === 'undefined')
      return ele.innerText || ele.textContent;

    var text = '';
    for (var i = 0; i < ele.length; i++) {

      text += ele[i].innerText || ele[i].textContent;
    }

    return text;
  };

  var $find = function (ele, selector) { // jquery shim

    return ele && (ele.length ? ele[0] : ele).querySelectorAll(selector);
  };

  var processDelayedImage = function () { // this

    console.log('processDelayedImage Size:', this.naturalWidth, this.naturalHeight, this);
    var src = this.src || this.getAttribute('src');
    if (src) processImage(this, src);
    this.removeEventListener('load', processDelayedImage, false);
  }

  var processImage = function (img, src) {

    var target, targetUrl, ad, hits = 0;

    target = clickableParent(img);
    if (target) {

      if (target.tagName === 'A') {

        targetUrl = target.getAttribute("href");
        if (targetUrl) {

          ad = createAd(document.domain, targetUrl, {
            src: src,
            width: img.naturalWidth || -1,
            height: img.naturalHeight || -1
          });

          if (ad) {

            console.log('IMG-AD', ad);
            notifyAddon(ad);
            hits++;
          }

          // Need to check for div.onclick etc?
        } else if (dbugDetect) console.warn("Bail: Ad / no targetURL! imgSrc: " + imgSrc);

      } else if (dbugDetect) console.log("Bail: Non-anchor found: " + target.tagName);

    } else if (dbugDetect) console.log("Bail: No ClickableParent: " + imgSrc);

  }

  var yahooText = function (e) {

    //console.log('yahooText: ', e);

    var ads = [],
      divs = $find(e, 'div.dd');

    for (var i = 0; i < divs.length; i++) {

      var title, site, text,
        idiv = $find(divs[i], 'div.compTitle');

      if (idiv.length) {
        title = $find(idiv[0], 'h3.title a');
        site = $find(idiv[0], 'div > a');
      }

      text = $find(divs[i], 'div.compText a');

      if (text.length && site.length && title.length) {

        var ad = createAd('yahoo', $attr(title, 'href'), {
          title: $text(title),
          text: $text(text),
          site: $text(site)
        });

        ads.push(ad);

      } else {

        //console.warn('LEN-F: ',title.length,text.length ,site.length);
        console.warn('yahooTextHandler.fail: ', divs[i]); //title, site, text);
      }
    }

    return ads;
  }

  var aolText = function (div) {

    var ad, title = $find(div, '.title span'),
      text = $find(div, '.desc span'),
      site = $find(div, '.durl span'),
      target = $find(div, '.title a');

    if (text.length && site.length && title.length && target.length) {

      ad = createAd('aol', $attr(target, 'href'), {
        title: $text(title),
        text: $text(text),
        site: $text(site)
      });

    } else {

      console.warn('TEXT: aolTextHandler.fail: ', text, site, document.title, document.URL);
    }

    return [ad];
  }

  var askText = function (dom) {

    var title = $find(dom, 'a.test_titleLink.d_'),
      site = $find(dom, 'a.test_domainLink.e_'),
      text1 = $find(dom, 'span.descText'),
      text2 = $find(dom, 'span.v_');

    var text = text(text1) + (stringNotEmpty(text2) ? $text(text2) : '');

    if (text.length && site.length && title.length) {
      var ad = createAd('ask', $attr(title, 'href'), {
        title: $text(title),
        site: $text(site),
        text: text
      });

    } else {

      console.warn('TEXT: askTextHandler.fail: ', text, site, document.URL, document.title);
    }

    return [ad];
  }

  function checkFilters(theFilters, elem) {

    for (var i = 0; i < theFilters.length; i++) {

      var filter = theFilters[i];

      if ($is(elem, filter.selector)) {

        if (filter.name === 'aol' && document.domain.indexOf('aol') < 0) // TMP-REMOVE
          continue;

        var result = filter.handler(elem);

        if (result) {

          if (!filter.domain.test(document.domain))
            console.warn("Text Ad failed filter-test: ", document.URL, filter);

          return result;
        }
      }
    }
  }

  var googleText = function (li) {

    var ad, title = $find(li, 'h3 a'),
      text = $find(li, '.ads-creative'),
      site = $find(li, '.ads-visurl cite');

    if (text.length && site.length && title.length) {

      ad = createAd('google', $attr(title, 'href'), {
        title: $text(title),
        text: $text(text),
        site: $text(site)
      });

    } else {

      console.warn('TEXT: googleTextHandler.fail: ', text, site, document.URL, document.title);
    }

    return [ad];
  }

  var googleRegex = /^(www\.)*google\.((com\.|co\.|it\.)?([a-z]{2})|com)$/i;

  var filters = [{
    selector: 'li.ads-ad',
    handler: googleText,
    name: 'google',
    domain: googleRegex
  }, {
    selector: '.ad.a_',
    handler: askText,
    name: 'ask',
    domain: /^.*\.ask\.com$/i
  }, {
    selector: '.ad',
    handler: aolText,
    name: 'aol',
    domain: /^.*\.aol\.com(\.([a-z]{2}))?$/i
  }, {
    selector: 'ol',
    handler: yahooText,
    name: 'yahoo',
    domain: /^.*\.yahoo\.com/i
  }];

  var createAd = function (network, target, data) {

    if (target.indexOf('//') === 0) { // move to core?

      target = 'http:' + target;

    } else if (target.indexOf('http') < 0) {

      console.warn("Ignoring Ad with targetUrl=" + target, arguments);
      return;
    }

    if (target === 'http://www.google.com/settings/ads/anonymous') { // refactor

      console.log("Ignoring AdChoices: ", img);
      return;
    }

    return new Ad(network, target, data);
  }

  var messageListener = function (request) {

    // this is a temporary means of injecting the adnauseam-count
    // div into top-level frames for checking via automated tests
    if (window === window.top && request.automated) {

      if (request.what === 'adDetected') {

        var count = pageCount(request.data, request.pageUrl),
          adndiv = document.getElementById("adnauseam-count");

        if (!adndiv) {

          adndiv = document.createElement('div');
          $attr(adndiv, 'id', 'adnauseam-count');
          var body = document.getElementsByTagName("body");
          body.length && body[0].appendChild(adndiv);
          //console.log("Injected: #adnauseam-count");
        }

        $attr(adndiv, 'count', count);
        // console.log("adndiv.attr('count', "+json.count+")");
        console.log("INSERT_COUNT=" + count + ")");
        //"=" + $attr(document.getElementById("adnauseam-count"), 'count'));
      }
    }
  }

})(this);
