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


(function () {

  'use strict';

  if (window.location === null || typeof vAPI !== 'object') return;

  // no ad extraction in incognito windows (see #236)
  if (vAPI.chrome && chrome.extension.inIncognitoContext) return;

  if (vAPI.adParser) {
      // console.debug('parser.js > already injected');
      return;
  }



  vAPI.adParser = (function () {

    var ignoreTargets = [
      'http://www.google.com/settings/ads/anonymous',
      'http://choice.microsoft.com'
    ];

    /***************************** Functions ******************************/

    var findImageAds = function (imgs) {

      var target, targetUrl, ad, hits = 0;

      for (var i = 0; i < imgs.length; i++) {

        var imgSrc = imgs[i].src || imgs[i].getAttribute("src");

        if (!imgSrc) {

          vAPI.debugAdParsing && console.log("No ImgSrc(#" + i + ")!", imgs[i]);
          imgs[i].addEventListener('load', processDelayedImage, false);
          continue;
        }

        if (processImage(imgs[i], imgSrc)) {
          hits++;
        }
        // else: we may want to unhide the element here (see #337)
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

      var checkNode = node;

      while (checkNode && checkNode.nodeType ===1) {

        //checkNode && console.log('CHECKING: '+checkNode.tagName, checkNode);
        if (checkNode.tagName === 'A' || checkNode.hasAttribute('onclick')) {
          return checkNode;
        }

        checkNode = checkNode.parentNode;
      }

      return null;
    }

    var clickableParentX = function (node) {

      var checkParent = function (adNode) {

        var hasParent = adNode.parentNode &&
          (adNode.parentNode.tagName == 'A' ||
            adNode.parentNode.tagName == 'OBJECT' ||
            adNode.parentNode.tagName == 'IFRAME' ||
            (adNode.hasAttribute && adNode.hasAttribute('onclick')));

        console.log("check",adNode.tagName,adNode.parentNode);

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
      this.current = false;
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

    var processDelayedImage = function () { // this=img

      //console.log('processDelayedImage Size:', this.naturalWidth, this.naturalHeight, this);
      var src = this.src || this.getAttribute('src');
      if (src) {
        if (processImage(this, src))
          console.log("HIT from processDelayedImage!");
      }
      this.removeEventListener('load', processDelayedImage, false);
    }

    var processImage = function (img, src) {

      var target, targetUrl, ad, hits = 0,
        dbug = vAPI.debugAdParsing && !vAPI.prefs.production;

      target = clickableParent(img);
      if (target) {

        if (target.tagName === 'A' || target.hasAttribute('onclick')) { // if not, need to check for div.onclick?
          
          //onclick possibilities
          if(target.hasAttribute('onclick')) {
            var onclickInfo = target.getAttribute("onclick");
            var hostname = window.location.hostname;
            targetUrl = parseOnClick(onclickInfo, hostname);
          }
          else targetUrl = target.getAttribute("href");

          if (targetUrl) {

            ad = createAd(document.domain, targetUrl, {
              src: src,
              width: img.naturalWidth || -1,
              height: img.naturalHeight || -1
            });

            if (ad) {

              if (!vAPI.prefs.production) console.log('IMG-AD', ad);
              notifyAddon(ad);
              hits++;

            } else if (dbug)
              console.warn("Bail: Unable to create Ad", document.domain, targetUrl, src);

          } else if (dbug)
            console.warn("Bail: No href for anchor", target, img);

        } else if (dbug)
          console.log("Bail: Non-anchor found: " + target.tagName, img);

      } else if (dbug)
        console.log("Bail: No ClickableParent", img, img.parentNode, img.parentNode.parentNode, img.parentNode.parentNode.parentNode);

    }

    // TODO: replace with core::domainFromURI
    var parseDomain = function (url, useLast) { // dup. in shared

      var domains = decodeURIComponent(url).match(/https?:\/\/[^?\/]+/g);
      return domains && domains.length ? new URL(
          useLast ? domains[domains.length - 1] : domains[0])
        .hostname : undefined;
    }

    var isInternal = (function() {  // not used

      var domainRe = /https?:\/\/((?:[\w\d]+\.)+[\w\d]{2,})/i;

      return function(url, pageDomain) {
          function domain(url) {
            var host = domainRe.exec(url)[1];
            var parts = host.split('.');
            var subdomain = parts.shift();
            return parts.join('.');
          }

          console.log("domain: "+domain(url));

          return domain(url) === pageDomain;
      }
    })();

    var injectAutoDiv = function (request) { // not used

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

    /******************************** API *********************************/

    var process = function (elem) {

      vAPI.debugAdParsing && console.log('process('+elem.tagName+')',
        elem.tagName==='IFRAME' ? elem.getAttribute('src') : elem);

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
        if (imgs.length) {
          findImageAds(imgs);
        }

        // and finally check for text ads
        vAPI.textAdParser.process(elem);
      }
    };

    var notifyAddon = function (ad) {

      vAPI.messaging.send('adnauseam', {
        what: 'registerAd',
        ad: ad
      });

      return true;
    }

    var createAd = function (network, target, data) {

      var domain = (parent !== window) ?
        parseDomain(document.referrer) : document.domain;

      //console.log('createAd:', domain, target, typeof target);

      if (target.indexOf('//') === 0) {

        target = 'http:' + target;

      } else if (target.indexOf('/') === 0) {

        target = 'http://' + domain + target;
        //console.log("Fixing absolute domain: " + target);
      }

      if (target.indexOf('http') < 0) {

        console.warn("Ignoring Ad with targetUrl=" + target, arguments);
        return;
      }

      if (ignoreTargets.indexOf(target) > -1) {

        if (!vAPI.prefs.production) console.log("Ignoring choices-image: ", arguments);
        return;
      }

      // only need to do this if we are going to re-hide internal elements
      // otherwise we let core.js handle it using the PSL (#337)
      if (false && isInternal(target, domain)) {

        console.warn("Ignoring Ad with internal target=" + isInternal(target));
        return;
      }

      return new Ad(network, target, data);
    }

    var useShadowDOM = function () {

        return false; // for now
    }



    /**********************************************************************/

    return {
      process: process,
      createAd: createAd,
      notifyAddon: notifyAddon,
      useShadowDOM: useShadowDOM
    };

  })();

})();

  // parse the target link from a js onclick handler
  var  parseOnClick = function(str, hostname) {

      var result,
          matches = /(?:javascript)?window.open\(([^,]+)[,)]/gi.exec(str);

      if (matches && matches.length > 0) {
        result = matches[1].replace(/['"]+/g, "");
      }
      
      // handle relative urls
      if (result && result.startsWith('//')) {
         result = "http:" + result;
      }
      if(result && (!result.startsWith('http'))){ 
        result = "http://" + hostname + "/" + result; 
      }

      return result;
  }
