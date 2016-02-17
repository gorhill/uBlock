/* global vAPI, uDom, $ */
/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var adsonpage = self.adsonpage = {};
var adnmessager = adsonpage.messager = vAPI.messaging.channel('adnauseam');

var renderPage = function(ads) {

  console.log('renderPage() :: ', ads.length);

  var $items = $('#ad-list-items');
  $items.removeClass().empty();

  if (!ads) return;

  for (var i = 0, j = ads.length; i < j; i++) {

    if (ads[i].contentType === 'img') {

      appendImageAd(ads[i], $items);

    } else if (ads[i].contentType === 'text') {

      appendTextAd(ads[i], $items);
    }
  }

  //if (!json.pageCount) showRecentAds(ads, json.emptyMessage);

  setCounts(ads);
};

function setCounts(ads) {

    // var found = (json && json.pageCount) || 0,
    //     total = (json && json.totalCount) || '?',
    //     visited = (json && found && visitedCount(json.data)) || 0;

    //console.log('setCounts: '+visited+"/"+found+' of '+total+' total');

    $('#visited-count').text(visitedCount(ads));
    $('#found-count').text(ads.length);
    $('#vault-count').text('?');
}

function appendImageAd(ad, $items) {

    var $a, $span, $li = $( '<li/>', {

        'id': 'ad' + ad.id,
        'class': 'ad-item' + visitedClass(ad)
    });

    $a = $( '<a/>', {

        'target': 'new',
        'href': ad.targetUrl
    });

    $span = $( '<span/>', { 'class': 'thumb' });

    $( '<img/>', {

        'src': (ad.contentData.src || ad.contentData),
        'class': 'ad-item-img',
        'onerror': "this.onerror=null; this.width=50; this.height=45; this.src='img/placeholder.svg'",

    }).appendTo( $span );

    $span.appendTo( $a );

    $( '<span/>', {

        'class': 'title',
        'text': ( ad.title ? ad.title : "#" + ad.id )

    }).appendTo( $a );

    $( '<cite/>', { 'text': targetDomain(ad) }).appendTo( $a );

    $a.appendTo( $li );
    $li.appendTo( $items );
}

function appendTextAd(ad, $items) {

    var $cite, $h3, $li = $('<li/>', {

        'id': 'ad' + ad.id,
        'class': 'ad-item-text' + visitedClass(ad)
    });

    $('<span/>', {

        'class': 'thumb',
        'text': 'Text Ad'

    }).appendTo($li);

    $h3 = $('<h3/>');

    $('<a/>', {

        'target': 'new',
        'class': 'title',
        'href': ad.targetUrl,
        'text': ad.title

    }).appendTo($h3);

    $h3.appendTo($li);

    $cite = $('<cite/>', { 'text': ad.contentData.site });

    $cite.text($cite.text() + ' (#' + ad.id + ')'); // testing-only

    $cite.appendTo($li);

    $('<div/>', {

        'class': 'ads-creative',
        'text': ad.contentData.text

    }).appendTo($li);

    $li.appendTo( $items );
}

function visitedClass(ad) {

    return ad.visitedTs > 0 ? ' visited' :
        (ad.visitedTs < 0 ? ' failed' : '');
}

function visitedCount(arr) {

    return (!(arr && arr.length)) ? 0 : arr.filter
      (function(ad) { return ad.visitedTs > 0; }).length;
}

function extractDomains(fullUrl) { // used in targetDomain

  var result = [], matches,
    regexp = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;

  while ((matches = regexp.exec(fullUrl)))
    result.push(matches[0]);

  return result;
}

function targetDomain(ad) {

  var result, url = ad.resolvedTargetUrl || ad.targetUrl,
    domains = extractDomains(url);

  if (domains.length)
    result = new URL(domains.pop()).hostname;
  else
    warn("[ERROR] '" + ad.targetUrl + "' url=" + url);

  if (result) result += ' (#' + ad.id + ')'; // testing-only

  return result;
}

var getPopupData = function(tabId) {
    var onDataReceived = function(response) {
        cachePopupData(response);
        //renderPopup();
        //renderPopupLazy(); // low priority rendering
        //hashFromPopupData(true);
        //pollForContentChange();
        console.log("tabId: ", popupData.tabId);
        adnmessager.send({ what: 'adsForMenu', tabId: popupData.tabId }, renderPage);
    };
    messager.send({ what: 'getPopupData', tabId: tabId }, onDataReceived);
};
var messager = vAPI.messaging.channel('popup.js');

/******************************************************************************/
var cachedPopupHash = '';
var hostnameToSortableTokenMap = {};
var popupData = {};
var scopeToSrcHostnameMap = {
    '/': '*',
    '.': ''
};
var cachePopupData = function(data) {
    console.log("DATA",data);
    popupData = {};
    scopeToSrcHostnameMap['.'] = '';
    hostnameToSortableTokenMap = {};

    if ( typeof data !== 'object' ) {
        return popupData;
    }
    popupData = data;
    scopeToSrcHostnameMap['.'] = popupData.pageHostname || '';
    var hostnameDict = popupData.hostnameDict;
    if ( typeof hostnameDict !== 'object' ) {
        return popupData;
    }
    var domain, prefix;
    for ( var hostname in hostnameDict ) {
        if ( hostnameDict.hasOwnProperty(hostname) === false ) {
            continue;
        }
        domain = hostnameDict[hostname].domain;
        prefix = hostname.slice(0, 0 - domain.length);
        // Prefix with space char for 1st-party hostnames: this ensure these
        // will come first in list.
        if ( domain === popupData.pageDomain ) {
            domain = '\u0020';
        }
        hostnameToSortableTokenMap[hostname] = domain + prefix.split('.').reverse().join('.');
    }
    return popupData;
};

/******************************************************************************/

var hashFromPopupData = function(reset) {
    // It makes no sense to offer to refresh the behind-the-scene scope
    if ( popupData.pageHostname === 'behind-the-scene' ) {
        uDom('body').toggleClass('dirty', false);
        return;
    }

    var hasher = [];
    var rules = popupData.firewallRules;
    var rule;
    for ( var key in rules ) {
        if ( rules.hasOwnProperty(key) === false ) {
            continue;
        }
        rule = rules[key];
        if ( rule !== '' ) {
            hasher.push(rule);
        }
    }
    hasher.sort();
    hasher.push(uDom('body').hasClass('off'));
    hasher.push(uDom.nodeFromId('no-large-media').classList.contains('on'));
    hasher.push(uDom.nodeFromId('no-cosmetic-filtering').classList.contains('on'));
    hasher.push(uDom.nodeFromId('no-remote-fonts').classList.contains('on'));

    var hash = hasher.join('');
    if ( reset ) {
        cachedPopupHash = hash;
    }
    uDom('body').toggleClass('dirty', hash !== cachedPopupHash);
};

    $('#log-button').click(function() {

        window.open("./adn-log.html");
    });
    
    $('#vault-button').click(function() {

        window.open("./adn-vault.html");
    });
    
    $('#pause-button').click(function() {
        
        
    });
    
    $('#settings-open').click(function() {

        $('.page').toggleClass('hide');
        $('.settings').toggleClass('hide');
    });

    $('#settings-close').click(function () {

        $('.page').toggleClass('hide');
        $('.settings').toggleClass('hide');
    });

    var AboutURL = "https://github.com/dhowe/AdNauseam/wiki/FAQ";
    // cannot declare as const on Safari platform in strict mode
    $('#about-button').click(function () {

        window.open(AboutURL);
    });

(function() {
/*
    // If there's no tab id specified in the query string,
    // it will default to current tab.
    tabId = null;

    // Extract the tab id of the page this popup is for
    var matches = window.location.hash.match(/#tab_([^&]+)/);

    //var matches = window.location.search.match(/[\?&]tabId=([^&]+)/);

    if ( matches && matches.length === 2 ) {
        tabId = matches[1];
    }
*/
    // chrome.tabs.getCurrent(function(tab) {
    //   console.log(tab.id, tab.url);
    //
    // });

    // chrome.tabs.getSelected(null, function(tab) {
    //     var tabId = tab.id;
    //     //tabUrl = tab.url;
    //
    //     console.log(tab.id, tab.url);
    //     messager.send({
    //
    //         what: 'adsForMenu',
    //         tabId: tabId
    //
    //     }, renderPage);
    // });

  var tabId = null;
  // Extract the tab id of the page this popup is for
  var matches = window.location.search.match(/[\?&]tabId=([^&]+)/);
  if ( matches && matches.length === 2 ) {
      tabId = matches[1];
  }
  getPopupData(tabId);

  //console.log('loading menu',popupData.tabId,popupData);


})();

/********************************************************************/

})();
