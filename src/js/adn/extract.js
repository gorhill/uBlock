var dbugDetect = 1; // tmp

// Injected into content pages before contentscript-end.js
// jQuery polyfill: $is, $find, $attr, $text

(function (self) {

  'use strict';

  if (typeof vAPI !== 'object' ||
    (vAPI.chrome && chrome.extension.inIncognitoContext)) // #194
  {
    return;
  }

  var adDetector = self.adDetector = self.adDetector || {};

  if (adDetector.findAds) {
    //console.log('skipping extract: ',typeof vAPI);
    return;
  }

  // vAPI.messaging.send('adnauseam', {
  //   what: 'getPreferences'
  // }, function (req) {
  //   prefs = req;
  // });

  adDetector.prefs = {};
  adDetector.useShadowDOM = false;
  adDetector.ignoreTargets = [
    'http://www.google.com/settings/ads/anonymous',
    'http://choice.microsoft.com'
  ];

  adDetector.findAds = function (elem) {

    switch (elem.tagName) {

    case 'IFRAME':
      //elem.addEventListener('load', handleIFrame, false);
      break;

    case 'IMG':
      findImageAds([elem]);
      break;

    default: // other tag-types

      // check the element for child imgs
      var imgs = elem.querySelectorAll('img');
      if (imgs.length) findImageAds(imgs);

      // Question: if we find images, do we want to still try text?

      // and finally check for text ads
      adDetector.prefs.parseTextAds && findTextAds(elem);
    }
  }

  var findTextAds = function (elem) {

    var activeFilters = filters.filter(function (f) {
      var domain = (parent !== window) ? parseDomain(document.referrer) : document.domain;
      var matched = f.domain.test(domain);
      //if (!matched) console.warn('Domain mismatch: ' + domain + ' != ' + f.domain);
      return matched;
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

    // for automated testing
    if (adDetector.prefs.automated && window === window.top)
        injectAutoDiv();

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

    //console.log('processDelayedImage Size:', this.naturalWidth, this.naturalHeight, this);
    var src = this.src || this.getAttribute('src');
    if (src) {
      if (processImage(this, src))
        console.log("HIT from processDelayedImage!");
    }
    this.removeEventListener('load', processDelayedImage, false);
  }

  var processImage = function (img, src) {

    var target, targetUrl, ad, hits = 0;

    target = clickableParent(img);
    if (target) {

      if (target.tagName === 'A') { // if not, need to check for div.onclick?

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

          } else if (dbugDetect) console.warn("Bail: Unable to create Ad", document.domain, targetUrl, src);

        } else if (dbugDetect) console.warn("Bail: No href for anchor", target, img);

      } else if (dbugDetect) console.log("Bail: Non-anchor found: " + target.tagName, img);

    } else if (dbugDetect) console.log("Bail: No ClickableParent", img);

  }

  var bingText = function (dom) {

    var ad, title = $find(dom, 'h2 a'),
      text = $find(dom, 'div.b_caption p'),
      site = $find(dom, 'div.b_attribution cite');

    if (text.length && site.length && title.length) {

      ad = createAd('bing', $attr(title, 'href'), {
        title: $text(title),
        text: $text(text),
        site: $text(site)
      });

    } else {

      console.warn('TEXT: bingTextHandler.fail: ',
        text, site, document.URL, document.title);
    }

    return [ad];
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

  var askText = function (dom) { // TODO: not working

    var title = $find(dom, 'a.test_titleLink.d_'),
      site = $find(dom, 'a.test_domainLink.e_'),
      text1 = $find(dom, 'span.descText'),
      text2 = $find(dom, 'span.v_'),
      text;

    text = $text(text1) + (text2 && text2.length ? $text(text2) : '');

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

  var ddgText = function (div) { // not-working, perhaps due to shadow dom

    // console.log('ddgText-', div.shadowRoot.querySelectorAll('h2.result__title'), div);
    //return;
    var ad, title = $find(div, 'h2.result__title'),
      text = $find(div, 'div.result__snippet > a'),
      site = $find(div, 'a.result__a');

    if (text.length && site.length && title.length) {

      ad = createAd('google', $attr(title, 'href'), {
        title: $text(title),
        text: $text(text),
        site: $attr(site, 'href')
      });

    } else {

      console.warn('TEXT: ddgTextHandler.fail: ', text, site, title, div);
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
    handler: askText, // not working
    name: 'ask',
    domain: /^.*\.ask\.com$/i
  }, {
    selector: '.ad',
    handler: aolText,
    name: 'aol',
    domain: /^.*\.aol\.com(\.([a-z]{2}))?$/i
  }, {
    selector: 'div#ads',
    handler: ddgText,
    name: 'ddg',
    domain: /^(.*\.)?duckduckgo\.com/i
  }, {
    selector: 'ol',
    handler: yahooText,
    name: 'yahoo',
    domain: /^.*\.yahoo\.com/i
  }, {
    selector: 'li.b_ad',
    handler: bingText,
    name: 'bing',
    domain: /^.*\.bing\.com/i
  }];

  function checkFilters(theFilters, elem) {

    for (var i = 0; i < theFilters.length; i++) {

      if ($is(elem, theFilters[i].selector)) {

        return theFilters[i].handler(elem);
      }
    }
  }

  var parseDomain = function (url, useLast) { // dup. in shared

    var domains = decodeURIComponent(url).match(/https?:\/\/[^?\/]+/g);
    return domains && domains.length ? new URL(
        useLast ? domains[domains.length - 1] : domains[0])
      .hostname : undefined;
  }

  var createAd = function (network, target, data) {

    if (target.indexOf('//') === 0) { // move to core?

      target = 'http:' + target;
    } else if (target.indexOf('/') === 0) {

      var domain = (parent !== window) ?
        parseDomain(document.referrer) : document.domain;
      target = 'http://' + domain + target;
      //console.log("Fixing absolute domain: " + target);
    }

    if (target.indexOf('http') < 0) {

      console.warn("Ignoring Ad with targetUrl=" + target, arguments);
      return;
    }

    if (adDetector.ignoreTargets.indexOf(target) > -1) {

      console.log("Ignoring choices-image: ", arguments);
      return;
    }

    return new Ad(network, target, data);
  }

  var injectAutoDiv = function (request) {

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
  }

})(this);
