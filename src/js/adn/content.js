/*******************************************************************************

    µBlock - a browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

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

var dbugDetect = 0; // tmp

console.log("ADN/CONTENT.JS LOADED...");

// Injected into content pages
//
// jQuery functions: is, find, attr, text
//
// (function(self) {
//
// 'use strict';
//
// var adDetector = self.adDetector = self.adDetector || {};
//
// if (typeof adDetector.findAds === 'function') return;
//
// console.log("CREATING AD-DETECTOR");
// /******************************************************************************/

var adDetector = (function() {

  var adMessager = vAPI.messaging.channel('adnauseam');

  var clickableParent = function(node) {

    var checkParent = function(adNode) {

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
  var Ad = function(network, pageTitle, pageUrl, targetUrl, contentType) {

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

  var notifyAddon = function(node, ad) {

    adMessager.send({
        what: 'registerAd',
        ad: ad
      }, function(obj) {
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

  var $attr = function(ele, attr) {    // jquery shim

    return (ele.length ? ele[0] : ele).getAttribute(attr);
  };

  var $text = function(ele) {         // jquery shim

    if (typeof ele.length === 'undefined')
      return ele.innerText || ele.textContent;

    var text = '';
    for (var i = 0; i < ele.length; i++) {
      text += ele[i].innerText || ele[i].textContent;
    }

    return text;
  };

  var $find = function(ele, selector) { // jquery shim

    return ele.querySelectorAll(selector);
  };

  var findAds = function(adNodes) {

    //console.log("findAds("+adNodes.length+")");

    // TODO: enable once all text-ad filters are working
    var activeFilters  = true ? filters : filters.filter(function(f){
        console.log(f, f.domain);
        return f.domain.test(document.domain);
    });

    for (var i = 0; i < adNodes.length; i++) {

      var elem = adNodes[i];

      if (dbugDetect) console.log(i, elem.tagName, elem);

      if (elem.tagName === 'IMG') {
        checkImages(elem, [elem]);
        continue;
      }

      var imgs = elem.querySelectorAll('img');
      if (imgs.length) {

          checkImages(elem, imgs);
      }
      else { // need to check domain/tag here: called way too often

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
    }
  }

  function checkImages(elem, imgs) {

      if (dbugDetect) console.log("Found " + imgs.length + " img(s)");

      for (var i = 0; i < imgs.length; i++) {

        var imgSrc = imgs[i].getAttribute("src");

        if (!imgSrc) {
          if (dbugDetect) console.log("No ImgSrc(#" + i + ")!", imgs[i]);
          continue;
        }

        if (dbugDetect) console.log('imgSrc: ' + imgSrc);

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
            }

            // Need to check for div.onclick etc?
            else if (dbugDetect) console.warn("Bail: Ad / no targetURL! imgSrc: " + imgSrc);
          } else if (dbugDetect) console.log("Bail: Non-anchor found: " + target.tagName);
        } else if (dbugDetect) console.log("Bail: No ClickableParent: " + imgSrc);
      }
  }

  var googleRegex = /^(www\.)*google\.((com\.|co\.|it\.)?([a-z]{2})|com)$/i; // not used now

  var filters = [
  {
        selector: 'li.ads-ad',
        handler: googleText,
        name: 'google',
        domain: googleRegex
  },{
        selector: '.ad',
        handler: aolText,
        name: 'aol',
        domain: /.*\.aol\.com(\.([a-z]{2}))?$/i
  },{
        selector: 'ol',
        handler: yahooText,
        name: 'yahoo',
        domain: /.*\.yahoo\.com$/i
  }];

  function yahooText(e) {

      var ads = [], divs = $find(e, 'div.dd');//#main > div > ol.a947i105t6.v119f
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
        }
        else {
          console.warn('yahooTextHandler.fail: ', divs[i]);//title, site, text);
        }

      }
      return ads;
      //console.log('HIT:: yahooText()', $find(e, 'div.layoutMiddle'));
  }

  function aolText(div) {

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

      return [ ad ];
    }

    var checkFilters = function (filts, elem) {

      for (var i = 0; i < filts.length; i++) {

        if ($is(elem, filts[i].selector)) {

          var result = filts[i].handler(elem);
          if (result) {
              if (!filts[i].domain.test(document.domain))
                console.warn("Text Ad failed filter-test: ", document.URL, filts[i]);
              return result;
          }
        }
      }
    };

    function googleText(li) {

      var ad, title = $find(li, 'h3 a'),
        text = $find(li, '.ads-creative'),
        site = $find(li, '.ads-visurl cite');

      if (text.length && site.length && title.length) {

        ad = createTextAd('google', $attr(title, 'href'),
          $text(title), $text(text), $text(site));

      } else {

        console.warn('TEXT: googleTextHandler.fail: ', text, site, document.URL, document.title);
      }

      return [ ad ];
    }


    function createImgAd(network, target, img) {

      if (target.indexOf('http') < 0) {

        console.warn("Ignoring ImgAd with targetUrl=" + target, arguments);
        return;
      }

      //console.log("createImgAd: ",network, img, target);
      // if (window.self !== window.top) { // see #42
      //     console.log('iFrame: parseTitle: ', window.top.document.title);
      // }
      //
      if (document.title.indexOf('SafeFrame')>-1)
        console.warn("Incorrect page name: ",window.self === window.top, document.title, window.top && window.document && window.top.document.title);

      var ad = new Ad(network, document.title, document.URL, target, 'img');

      if (!/^http/.test(img)) { // relative image url
        if (/^data:image/.test(img)) {
          if (dbugDetect) console.log("Found encoded image: " + img);
        }
        else {
          if (dbugDetect) console.log("Found relative image: " + img);
          img = ad.pageUrl.substring(0, ad.pageUrl.lastIndexOf('/')) + '/' + img;
        }
      }

      ad.contentData = {
        src: img
      };

      return ad;
    }

    function createTextAd(network, target, title, text, site) { // unescapeHTML: fix to #31

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

    return {
      findAds: findAds,
    }

})();

/******************************************************************************/

//})(this);

/******************************************************************************/
