(function () {

  'use strict';

  if (window.location === null || typeof vAPI !== 'object') {
    console.debug('parser.js > window.location===null || vAPI not found');
    return;
  }

  var AdParser = (function () {

    var useShadowDOM = false;
    var ignoreTargets = [
      'http://www.google.com/settings/ads/anonymous',
      'http://choice.microsoft.com'
    ];

    /***************************** Functions ******************************/
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

          vAPI.debugAdParsing && console.log("No ImgSrc(#" + i + ")!", imgs[i]);
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
      if (vAPI.prefs.automated && window === window.top)
        injectAutoDiv();

      return true;
    }

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

      var target, targetUrl, ad, dbug = vAPI.debugAdParsing, hits = 0;

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

            } else if (dbug) console.warn("Bail: Unable to create Ad", document.domain, targetUrl, src);

          } else if (dbug) console.warn("Bail: No href for anchor", target, img);

        } else if (dbug) console.log("Bail: Non-anchor found: " + target.tagName, img);

      } else if (dbug) console.log("Bail: No ClickableParent", img);

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

      if (ignoreTargets.indexOf(target) > -1) {

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

    /******************************** API *********************************/

    var process = function (elem) {

      //console.log('AdParser.process()', elem);

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

        // and finally check for text ads
        vAPI.textAdParser.process(elem);
      }
    };

    /**********************************************************************/

    return {
      process: process,
      createAd: createAd,
      notifyAddon: notifyAddon
    };

  })();

  vAPI.adParser = AdParser;

})();
