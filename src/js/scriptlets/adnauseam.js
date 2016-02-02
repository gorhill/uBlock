/******************************************************************************/

(function () {

  'use strict';

  console.log("adnauseam.js running on: " + window.location.href);
  /******************************************************************************/

  if (typeof vAPI !== 'object') {
    return;
  }

  // if ( typeof $ !== 'function' ) {
  //     console.log("NO JQUERY: ", $);
  //     return;
  // }

  /******************************************************************************/
  /* Functions */
  /******************************************************************************/
  var hasClickableParent = function (adNode) {

    var hasParent = adNode.parentNode &&
      (adNode.parentNode.tagName == 'A' ||
        adNode.parentNode.tagName == 'OBJECT' ||
        adNode.parentNode.tagName == 'IFRAME' ||
        (adNode.hasAttribute && adNode.hasAttribute('onclick')));

    //console.log("check",adNode.tagName,adNode.parentNode);

    return hasParent;
  };

  var checkParentClickable = function (node) {

    var adNode = node;

    while (hasClickableParent(adNode))
      adNode = adNode.parentNode;

    // returns adnode if found, or null
    return adNode === node ? null : adNode;
  };

  var adDetectionHandler = function (res) {
    console.log("AdDetectionCallback :: ",res);
  };

  /******************************************************************************/

// Insert all cosmetic filtering-related style tags in the DOM
var doit = function() {
  var injectedSelectors = [];
  var filteredElementCount = 0;

  var localMessager = vAPI.messaging.channel('adnauseam.js');

  var reProperties = /\s*\{[^}]+\}\s*/;
  var styles = vAPI.styles || [];
  var i = styles.length;

  while (i--) {
    injectedSelectors = injectedSelectors.concat(styles[i].textContent.replace(reProperties, '').split(/\s*,\n\s*/));
  }

  console.log("\nFound " + injectedSelectors.length + " total selectors");

  // var url = (window.location != window.parent.location)
  //         ? document.referrer
  //         : document.location;

  if (injectedSelectors.length !== 0) {

    var adNodes = document.querySelectorAll(injectedSelectors.join(','));
    //if (adNodes.length > 0)

    console.log("\nFound " + adNodes.length + " matched selectors");

    for (var i = 0; i < adNodes.length; i++) {
      console.log(i, adNodes[i].tagName, adNodes[i]);
      //var img = checkChildrenFor(adNodes[i], 'IMG');
      //var imgs = $(adNodes[i]).find('img');
      //console.log("Found "+imgs.length+" imgs");

      var imgs = adNodes[i].querySelectorAll('IMG');
      if (imgs.length > 0) {
        console.log("Found " + imgs.length + " imgs");
        for (var i = 0; i < imgs.length; i++) {

          //var anchors = $(imgs2[i]).closest('a');
          var imgSrc = imgs[i].getAttribute("src");
          if (!imgSrc) {
            console.log("No ImgSrc(#"+i+")!", imgs[i]);
            continue;
          }
          var target = checkParentClickable(imgs[i]);
          if (target) {
            if (target.tagName === 'A') {
              var targetUrl = target.getAttribute("href");
              if (targetUrl) {
                localMessager.send({
                  what: 'adDetection',
                  contentData: { src: imgSrc },
                  targetUrl: targetUrl,
                  node: adNodes[i]
                }, adDetectionHandler);
              }
              else {
                // Need to check for div.onclick etc.
                console.warn("AD / no targetURL! imgSrc: "+imgSrc);
              }
            }
            else {
              console.log("NON-ANCHOR found: "+target.tagName);
            }
          }
          else {
            console.log("No ClickableParent: "+imgSrc);
          }
        }
      }
      else {
        var iframes = adNodes[i].querySelectorAll('IFRAME');
        if (iframes.length > 0) {
          console.log("Found " + iframes.length + " iframes");
        } else {
          console.log("Found no imgs/iframes");
        }
      }
    }
  }
};

setTimeout(doit, 10);

  /******************************************************************************/

})();

/******************************************************************************/
