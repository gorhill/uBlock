var dbugDetect = 0; // tmp

// Injected into content pages before contentscipt-end.js
// jQuery polyfill: $is, $find, $attr, $text
(function (self) {

  'use strict';

  var adDetector = self.adDetector = self.adDetector || {};

  if (adDetector.findAds) return;

  adDetector.findAds = function (elem) {

    //console.log("findAds("+adNodes.length+")");

    // TODO: enable once all text-ad filters are working
    var activeFilters = true ? filters : filters.filter(function (f) {
      //console.log(f, f.domain);
      return f.domain.test(document.domain);
    });

    if (elem.tagName === 'IFRAME') return; // Ignore iframes, wait for sub-elements?

    if (dbugDetect) console.log(elem.tagName, elem);
    //elem.style.setProperty('display', 'none', 'important');

    if (elem.tagName === 'IMG') {

      return checkImages(elem, [elem]);
    }

    var imgs = elem.querySelectorAll('img');
    if (imgs.length) {

      return checkImages(elem, imgs);
    }

    //console.log("TRYING: ", elem);
    var ads = checkFilters(activeFilters, elem);
    if (ads && ads.length) {

      for (var i = 0; i < ads.length; i++) {

        if (ads[i]) {
          console.log("TEXT-AD", ads[i]);
          notifyAddon(elem, ads[i]);
        }
      }
    }
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

  /******************************************************************************/
  var Ad = function (network, pageTitle, pageUrl, targetUrl, contentType) {

    this.id = null;
    this.attempts = 0;
    this.visitedTs = 0; // 0=unattempted, -timestamp=err, +timestamp=ok
    this.attemptedTs = 0;
    this.title = 'Pending';
    this.foundTs = +new Date();
    this.resolvedTargetUrl = null;
    this.contentType = contentType;
    this.targetUrl = targetUrl;
    this.pageTitle = pageTitle;
    this.pageUrl = pageUrl;
    this.errors = null;
  };

  var notifyAddon = function (node, ad) {

    vAPI.messaging.send(
      'adnauseam', {
        what: 'registerAd',
        ad: ad
      },
      function (obj) {
        //console.log("AdDetected-callback: ", obj);
      });
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

  var $attr = function (ele, attr) { // jquery shim

    return (ele.length ? ele[0] : ele).getAttribute(attr);
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

    return ele.querySelectorAll(selector);
  };

  var checkImages = function (elem, imgs) {

    //if (dbugDetect) console.log("Found " + imgs.length + " img(s)", elem.classList);

    for (var i = 0; i < imgs.length; i++) {

      var imgSrc = imgs[i].getAttribute("src");

      if (!imgSrc) {
        if (dbugDetect) console.log("No ImgSrc(#" + i + ")!", imgs[i]);
        continue;
      }

      //if (dbugDetect) console.log('imgSrc: ' + imgSrc);

      var target = clickableParent(imgs[i]);
      if (target) {

        if (target.tagName === 'A') {

          var targetUrl = target.getAttribute("href");
          if (targetUrl) {

            if (targetUrl.indexOf('http') >= 0) {

              var ad = createImgAd(document.domain, targetUrl, imgSrc);
              if (ad) {

                console.log("IMG-AD", ad);
                notifyAddon(elem, ad);
              }

            } else {

              console.warn("Ignoring IMG-AD with targetUrl=" + targetUrl + " src=" + imgSrc);
            }

            // Need to check for div.onclick etc?
          } else if (dbugDetect) console.warn("Bail: Ad / no targetURL! imgSrc: " + imgSrc);

        } else if (dbugDetect) console.log("Bail: Non-anchor found: " + target.tagName);

      } else if (dbugDetect) console.log("Bail: No ClickableParent: " + imgSrc);
    }
  }

  var googleRegex = /^(www\.)*google\.((com\.|co\.|it\.)?([a-z]{2})|com)$/i; // not used now

  var yahooText = function (e) {

    var ads = [],
      divs = $find(e, 'div.dd'); //#main > div > ol.a947i105t6.v119f
    //console.log('DL: '+divs.length);
    for (var i = 0; i < divs.length; i++) {

      var title = $find(divs[i], 'a.td-n');
      var site = $find(divs[i], 'a.xh52v4e');
      var text = $find(divs[i], 'a.fc-1st');

      if (text.length && site.length && title.length) {

        var ad = createTextAd('yahoo', $attr(title, 'href'),
          $text(title), $text(text), $text(site));

        ads.push(ad);
        //console.log('CREATED: ',ad);
      } else {
        console.warn('yahooTextHandler.fail: ', divs[i]); //title, site, text);
      }

    }
    return ads;
    //console.log('HIT:: yahooText()', $find(e, 'div.layoutMiddle'));
  }

  var aolText = function (div) {

    var ad, title = $find(div, '.title span'),
      text = $find(div, '.desc span'),
      site = $find(div, '.durl span'),
      target = $find(div, '.title a');

    if (text.length && site.length && title.length && target.length) {

      ad = createTextAd('aol', $attr(target, 'href'),
        $text(title), $text(text), $text(site));

    } else {

      console.warn('TEXT: aolTextHandler.fail: ', text, site, document.title, document.URL);
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

      ad = createTextAd('google', $attr(title, 'href'),
        $text(title), $text(text), $text(site));

    } else {

      console.warn('TEXT: googleTextHandler.fail: ', text, site, document.URL, document.title);
    }

    return [ad];
  }

  var filters = [{
    selector: 'li.ads-ad',
    handler: googleText,
    name: 'google',
    domain: googleRegex
  }, {
    selector: '.ad',
    handler: aolText,
    name: 'aol',
    domain: /.*\.aol\.com(\.([a-z]{2}))?$/i
  }, {
    selector: 'ol',
    handler: yahooText,
    name: 'yahoo',
    domain: /.*\.yahoo\.com$/i
  }];


  var createImgAd = function (network, target, img) {

    if (target.indexOf('http') < 0) {

      console.warn("Ignoring ImgAd with targetUrl=" + target, arguments);
      return;
    }

    //console.log("createImgAd: ",network, img, target);
    // if (window.self !== window.top) { // see #42
    //     console.log('iFrame: parseTitle: ', window.top.document.title);
    // }
    //
    if (document.title.indexOf('SafeFrame') > -1)
      console.warn("Incorrect page name: ", window.self === window.top, document.title, window.top && window.document && window.top.document.title);

    var ad = new Ad(network, document.title, document.URL, target, 'img');

    if (!/^http/.test(img)) { // relative image url
      if (/^data:image/.test(img)) {
        if (dbugDetect) console.log("Found encoded image: " + img);
      } else {
        if (dbugDetect) console.log("Found relative image: " + img);
        img = ad.pageUrl.substring(0, ad.pageUrl.lastIndexOf('/')) + '/' + img;
      }
    }

    ad.contentData = {
      src: img
    };

    return ad;
  }

  var createTextAd = function (network, target, title, text, site) { // unescapeHTML: fix to #31

      if (target.indexOf('http') < 0) {

        console.warn("Ignoring TextAd with targetUrl=" + target, arguments);
        return;
      }

      //console.log("createTextAd: ",network, title, text, site, target);
      var ad = new Ad(network, document.title, document.URL, target, 'text');

      if (title.length) ad.title = title;

      ad.contentData = {
        title: title,
        text: text,
        site: site
      }

      return ad;
    }
    //
    // return {
    //   findAds: findAds,
    // }

})(this);

/******************************************************************************/
