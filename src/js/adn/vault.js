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

/* global uDom */

(function () {

  'use strict';

  const States = ['pending', 'visited', 'failed', 'dnt-allowed'],
    Zooms = [200, 150, 100, 75, 50, 25, 12.5, 6.25],
    EnableContextMenu = 1,
    MaxStartNum = 300,
    MaxPerSet = 9;

  const margin = {
    top: 50,
    right: 40,
    bottom: 20,
    left: 20
  };

  var zoomStyle, animatorId,
    resizeId, selectedAdSet,
    showInterface = true,
    animateMs = 2000,
    viewState = {},
    userZoomScale = Zooms[Zooms.indexOf(100)], // determined by mousewheel
    zoomIdx = 0, // determined by zoom in / out buttons
    draggingVault = false;

  var gAds, gAdSets, gMin, gMax, gSliderRight, gSliderLeft, settings; // stateful

  var messager = vAPI.messaging;

  messager.addChannelListener('adnauseam', function (request) {

    //console.log("GOT BROADCAST", request);
    switch (request.what) {

    case 'adAttempt':
      setCurrent(request.ad);
      break;

    case 'adDetected':
      //console.log('ad-detected');
      break;

    case 'adVisited':
      updateAd(request);
      break;

    case 'notifications':
      renderNotifications(request.notifications, 'vault');
      adjustHeight();
      createSlider(true);
      break;
    }
  });

  /********************************************************************/

  function $width(ele) {

    ele = ele ? (ele.length ? ele.nodes[0] : ele) : 0;
    return ele ? ele.offsetWidth || ele.clientWidth : -1;
  }

  function $height(ele) {

    ele = ele ? (ele.length ? ele.nodes[0] : ele) : 0;
    return ele ? ele.offsetHeight || ele.clientHeight : -1;
  }

  var renderAds = function (json) {

    // console.log('renderAds: ', json);
    gAds = json.data; // store
    addInterfaceHandlers();
    settings = json.prefs;
    createSlider(true);
    setCurrent(json.current);

    vAPI.messaging.send(
        'adnauseam', {
            what: 'verifyAdBlockers'
        },function() {
        if (json.notifications && json.notifications.length)
            renderNotifications(json.notifications, 'vault');
            adjustHeight();
    });

  };

  var updateAd = function (json) {

    doUpdate(json.ad);
    computeStats(gAdSets);
  }

  var setAttempting = function (ad) {

    if (!ad) return;

    var groupInfo = findAdById(ad.id),
      $item;

    if (groupInfo) {

      $item = findItemDivByGid(groupInfo.group.gid);

      // update the class for ad being attempted
      $item && $item.addClass('attempting');
    }
  }

  function setCurrent(ad) {

    $('.item').removeClass('attempting just-visited just-failed');
    setAttempting(ad);
  }

  function doLayout(adsets) {

    adsets = adsets || [];

    //console.log('Vault.doLayout: ' + adsets.length + " ad-sets, total=" + numFound(adsets));

    $('.item').remove();

    createDivs(adsets);
    computeStats(adsets);
    enableLightbox();
    repack();
  }

  function createDivs(adsets) {

    function hoverOnDiv(e) { // on

      var $this = $(this);

      if ($this.hasClass('inspected')) {

        // pause animation on mouse-over image
        var inspectedGid = parseInt($this.attr('data-gid'));
        selectedAdSet = findAdSetByGid(inspectedGid); // throws
        bulletIndex($this, selectedAdSet);
        animateInspector(false);
      }

      e.stopPropagation();
    }

    function hoverOffDiv(e) { // off

      if ($(this).hasClass('inspected')) {

        animateInspector($(this));
      }
    }

    for (var i = 0; i < adsets.length; i++) {

      var $div = $('<div/>', {

        'class': 'item dup-count-' + adsets[i].count(),
        'data-gid': adsets[i].gid

      }).appendTo('#container');

      layoutAd($div, adsets[i]);

      $div.hover(hoverOnDiv, hoverOffDiv);
    }
  }

  function layoutAd($div, adset) {

    // append the display
    (adset.child(0).contentType === 'text' ?
      appendTextDisplayTo : appendDisplayTo)($div, adset);

    setItemClass($div, adset.groupState());
  }

  function doUpdate(updated) {

    var groupInfo = findAdById(updated.id),
      adset, itemClass, $item;

    for (var i = 0, j = gAds && gAds.length; i < j; i++)
      if(gAds[i].id === updated.id) gAds[i] = updated;

    if (groupInfo) {

      adset = groupInfo.group;
      $item = findItemDivByGid(groupInfo.group.gid);

      // update the adgroup
      adset.index = groupInfo.index;
      adset.children[adset.index] = updated;
    }

    if (!$item) {

      //console.log("Item not currently visible", $item);
      return;
    }

    $('.item').removeClass('attempting just-visited just-failed');

    // update the ad data
    updateMetaTarget($item.find('.target[data-idx=' + adset.index + ']'), updated);

    // update the class
    $item.addClass(updated.visitedTs > 0 ? 'just-visited' : 'just-failed');

    setItemClass($item, adset.groupState());

    (adset.count() > 1) && bulletIndex($item, adset);
  }

  function setItemClass($item, state) {

    States.map(function (d) {
      $item.removeClass(d);
    }); // remove-all

    $item.addClass(state);
  }

  function appendMetaTo($div, adset) {

    //log('appendMetaTo:' + adset.gid);
    var $meta = $('<div/>', {
      class: 'meta'
    }).appendTo($div);

    var $ul = $('<ul/>', {

      class: 'meta-list',
      style: 'margin-top: 0px'

    }).appendTo($meta);

    for (var i = 0; i < adset.count(); i++) {

      var ad = adset.child(i);

      var $li = $('<li/>', {

        'class': 'meta-item',
        'style': 'margin-top: 0px'

      }).appendTo($ul);

      var $target = $('<div/>', {

        class: 'target',
        'data-idx': i

      }).appendTo($li);

      appendTargetTo($target, ad, adset); // tmp, remove adset

      var $detected = $('<div/>', {
        class: 'detected-on'
      }).appendTo($li);

      appendDetectedTo($detected, ad);
    }
  }

  function appendDetectedTo($detected, ad) {

    $('<h3/>', {
      text: vAPI.i18n('adnFoundOn') + ":"
    }).appendTo($detected);

    $('<a/>', {
      class: 'inspected-title',
      href: ad.pageUrl,
      text: decodeEntities(ad.pageTitle),
      target: '_blank'

    }).appendTo($detected);

    $('<cite/>', {
      text: ad.pageUrl
    }).appendTo($detected);

    $('<span/>', {

      class: 'inspected-date',
      text: formatDate(ad.foundTs)

    }).appendTo($detected);
  }

  function appendTargetTo($target, ad, adset) {

    $('<h3/>', {
      text: vAPI.i18n('adnTarget') + ":"
    }).appendTo($target);

    //log("Creating target #"+ad.id+" title="+ad.title);
    $('<a/>', {

      id: 'target-title',
      class: 'inspected-title',
      href: ad.targetUrl,
      text: decodeEntities(ad.title),
      target: '_blank'

    }).appendTo($target);

    $('<cite/>', {

      id: 'target-domain',
      class: 'target-cite',
      text: targetDomain(ad)

    }).appendTo($target);

    $('<span/>', {

      id: 'target-date',
      class: 'inspected-date',
      html: formatTargetDate(ad)

    }).appendTo($target);
  }

  function updateMetaTarget($target, ad) {

    $target.find('#target-domain').text(targetDomain(ad));
    $target.find('#target-date').text(formatDate(ad.visitedTs));
    var $titleA = $target.find('#target-title').text(ad.title);
    if (ad.resolvedTargetUrl)
      $titleA.attr('href', ad.resolvedTargetUrl);
  }

  /**
   * Resets current bullet class to [active, ad.state]
   * Shifts meta list to show correct item
   * Updates index-counter for the bullet
   */
  function bulletIndex($div, adset) { // adset.index must be updated first

    var $bullet = $div.find('.bullet[data-idx=' + (adset.index) + ']'),
      state = adset.state(),
      $ul;

    if (!state) console.warn('[WARN] undefined state (dont we need an arg here?)');

    //log('bulletIndex: c["+adset.index+"]="+adset.child().id+"-> "+ adset.state());

    // set the state for the bullet
    setItemClass($bullet, state);

    // set the active class for bullet
    $bullet.addClass('active')
      .siblings().removeClass('active');

    // shift the meta-list to show correct info
    $ul = $div.find('.meta-list');
    $ul.css('margin-top', (adset.index * -110) + 'px');

    // update the counter bubble
    $div.find('#index-counter').text(indexCounterText(adset));

    if ($div.hasClass('inspected')) {

      // (temporarily) add the state-class to the div
      setItemClass($div, state);
    }
  }

  function appendDisplayTo($div, adset) {

    var $ad = $('<div/>', {
      class: 'ad'
    }).appendTo($div);

    $('<span/>', {

      class: 'counter',
      text: adset.count()

    }).appendTo($ad);

    $('<span/>', {

      id: 'index-counter',
      class: 'counter counter-index',
      text: indexCounterText(adset)

    }).appendTo($ad).hide();

    var $img = $('<img/>', {

      src: adset.child(0).contentData.src,

    }).appendTo($ad);

    $img.on("error", function() {

        $img.css({ width: 80, height: 40 });
        $img.attr('src', 'img/placeholder.svg');
        $img.attr('alt', 'Unable to load image');
        $img.off("error");
    });

    // fix for #291
    $img.on('load', function() {
      // cache the dimensions of the img-item AFTER load
      var $this = $(this);
      $div.attr('data-width', $this.width());
      $div.attr('data-height', $this.height());
    });
  }

  function appendTextDisplayTo($pdiv, adset) {

    var total = adset.count(),
      ad = adset.child(0);

    $pdiv.addClass('item-text');

    var $div = $('<div/>', {

      class: 'item-text-div',
      width: rand(TEXT_MINW, TEXT_MAXW)

    }).appendTo($pdiv);

    $('<span/>', {

      class: 'counter',
      text: total

    }).appendTo($div);

    $('<span/>', {

      id: 'index-counter',
      class: 'counter counter-index',
      text: indexCounterText(adset)

    }).appendTo($div).hide();

    var $h3 = $('<h3/>', {}).appendTo($div);

    $('<div/>', { // title

      class: 'title',
      text: ad.title,
      target: '_blank'

    }).appendTo($h3);

    $('<cite/>', {
      text: ad.contentData.site
    }).appendTo($div); // site

    $('<div/>', { // text

      class: 'ads-creative',
      text: ad.contentData.text

    }).appendTo($div);

    // cache the dimensions of the text-item
    $pdiv.attr('data-width', $div.width());
    $pdiv.attr('data-height', $div.height());
  }

  function indexCounterText(adset) {

    return (adset.index + 1) + '/' + adset.count();
  }

  function appendBulletsTo($div, adset) {

    //log('appendBulletsTo: ' + adset.gid);

    function hoverOnLi(e) { // on

      e.stopPropagation();

      adset.index = parseInt($(this).attr('data-idx'));
      bulletIndex($div, adset);

      animateInspector(false);
    }

    function hoverOffLi(e) { // off

      animateInspector($div);
    }

    var count = adset.count();

    if (count > 1) {

      var $bullets = $('<div/>', {
        class: 'bullets'
      }).appendTo($div);

      // find the height of the image for bullet layout (#291)
      var adHeight = $div.attr('data-height');

      //log($div.find('img').height(), '?=', adHeight);

      var $ul = $('<ul/>', {
        height: adHeight
      }).appendTo($bullets);

      // add items based on count/state
      for (var i = 0; i < adset.count(); i++) {

        var $li = $('<li/>', {

          'data-idx': i,
          'class': 'bullet ' + adset.state(i)

        }).appendTo($ul);

        $li.hover(hoverOnLi, hoverOffLi);
      }
    }

    appendMetaTo($div, adset)
  }

  function computeStats(adsets) {
    var numVisits = numVisited(gAds);
    $('.since').text(sinceTime(adsets));
    $('#clicked').text(numVisits);
    $('#total').text(numTotal());
    $('#detected').text(numFound(adsets));
    if(numTotal() != numFound(adsets))
      $('.showing').show();
    else
      $('.showing').hide();
    setCost(numVisits);
  }

  function numVisible() {
    return $('.item').length;
  }

  function numVisited(adsets) {
   //TODO: update after visit
    var numv = 0;

    for (var i = 0, j = adsets && adsets.length; i < j; i++)
      numv += (adsets[i].visitedTs > 0);

    return numv;
  }

  function numFound(adsets) {

    var numv = 0;

    for (var i = 0, j = adsets && adsets.length; i < j; i++)
      numv += (adsets[i].count());

    return numv;
  }

  function numTotal() {

    return gAds.length;
  }

  function sinceTime(adsets) {

    var idx = 0,
      oldest = +new Date();

    for (var i = 0, j = adsets && adsets.length; i < j; i++) {

      var foundTs = adsets[i].child(0).foundTs;
      if (foundTs < oldest) {

        oldest = foundTs;
        idx = i;
      }
    }

    return formatDate(oldest);
  }

  function formatTargetDate(ad) {
    var dntNote = vAPI.i18n('adnAllowedByDNT') + "<a class='help-mark dnt' href='https://github.com/dhowe/AdNauseam/wiki/FAQ#what-is-the-effs-do-not-track-standard-and-how-it-is-supported-in-adnauseam'> ? </a>",
        frequencyNote = vAPI.i18n('adnAdClickingStatusSkippedFrequency'),
        userNote = vAPI.i18n('adnAdClickingStatusSkippedUser');

    return ad.noVisit ? (ad.clickedByUser ? userNote : (ad.dntAllowed ? dntNote : frequencyNote)) : formatDate(ad.visitedTs);
  }

  function formatDate(ts) {
    if (!ts) return settings.clickingDisabled ? vAPI.i18n('adnAdClickingStatusSkippedDisabled') : vAPI.i18n('adnNotYetVisited');

    function getLocale() {
      return navigator.languages[0] || navigator.language;
    }

    var date = new Date(Math.abs(ts));
    var options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                    hour: 'numeric', minute: 'numeric' };

    var result = typeof Intl === "object" ? new Intl.DateTimeFormat(getLocale(), options).format(date) : date;
    return result;
  }

  function enableLightbox() {

    $('.item').click(function (e) {

      if(!draggingVault){
        e.stopPropagation();
        lightboxMode($(this));
      }else{
        draggingVault = false;
      }


    });

    if (EnableContextMenu) {

      $('.item').bind("contextmenu", function (e) {

        var $this = $(this);

        if (!$this.hasClass('inspected')) {

          // show normal ff-context menu in inspector for now
          e.stopPropagation();
          e.preventDefault();

          var inspectedGid = parseInt($this.attr('data-gid'));
          selectedAdSet = findAdSetByGid(inspectedGid); // throws

          // show custom contextmenu
          $(".custom-menu").finish().toggle(100).

          // in correct position (according to mouse)
          css({
            top: (e.pageY - 25) + "px",
            left: e.pageX + "px"
          });
        }
      });
    }
  }

  function computeZoom(items) { // autozoom

    setZoom(zoomIdx = Zooms.indexOf(100), true);

    var i = 0,
      percentVis = 0.6,
      winW = $(window).width(),
      winH = $('#svgcon').offset().top;

    while (i < items.length) {

      var $this = $(items[i++]),
        scale = Zooms[zoomIdx] / 100;

      if (!onscreen($this, winW, winH, scale, percentVis)) {

        //log("Too-large @ " + Zooms[zoomIdx] + "%");
        setZoom(++zoomIdx, true);

        if (zoomIdx === Zooms.length - 1)
          break; // at smallest size, done

        i = 0;

        continue; // else try next smaller
      }
    }

    // OK at current size, done
  }

  function itemPosition($ele) {
    // first set zoom back to 100%
    setZoom(Zooms.indexOf(100), true);
    var off = $ele.offset(), // relative to container
      cx = $(window).width() / 2,
      cy = $(window).height() / 2,
      iw = $ele.attr('data-width') || 80,
      ih = $ele.attr('data-height') || 40;

    if (!(iw && ih && iw.length && ih.length)) {
      console.warn('No dimensions for item: gid=' +
        $this.attr('data-gid') + ', using ' + iw + 'x' + ih);
    }

    var $dm = $('#container');

    // compute offset of dragged container
    var dragoffX = -5000 - parseInt($dm.css('margin-left')),
      dragoffY = -5000 - parseInt($dm.css('margin-top'));

    // compute offset of item-center from (dragged) window-center
    var pos = {
      left: (off.left - cx) + (iw / 2) + dragoffX,
      top: (off.top - cy) + (ih / 2) + dragoffY
    };

    // now restore zoom to user-selected level
    setZoom(zoomIdx = viewState.zoomScale, true);

    return pos;
  }

  function centerZoom($ele) {

    if ($ele) {

      storeViewState(true);

      // compute target positions for transform
      var dm, spacing = 10,
        metaOffset = 110,
        center = -5000,
        ww = $(window).width(),
        wh = $(window).height(),
        pos = itemPosition($ele);

      // now compute the centered position based on item-offset
      var mleft = center - pos.left,
        mtop = center - pos.top;

      // can these 2 be removed?
      var iw = parseInt($ele.attr('data-width'));
      var ih = parseInt($ele.attr('data-height'));

      // make sure left/bottom corner of meta-data is onscreen (#180)
      if (iw > ww - (metaOffset * 2 + spacing)) {

        //log('HITX:  iw='+iw+" ww="+ww+" diff="+(iw - ww)  + "  offx="+offx);
        mleft += ((iw - ww) / 2) + (metaOffset + spacing);
      }
      if (ih > wh - (metaOffset * 2 + spacing)) {

        //log('HITY:  ih='+ih+" wh="+wh+" diff="+(ih - wh)  + "  offy="+offy);
        mtop -= ((ih - wh) / 2) + (metaOffset + spacing); // bottom-margin
      }

      // reset zoom to 100%
      setZoom(Zooms.indexOf(100));

      // transition to center
      $('#container').css({
        marginLeft: mleft + 'px',
        marginTop: mtop + 'px'
      });

    } else { // restore zoom-state

      storeViewState(false);
    }
  }

  // stores zoom/drag-offset for container
  function storeViewState(store) {

    var $dm = $('#container');

    if (store) {

      viewState.zoomScale = userZoomScale;
      viewState.left = $dm.css('margin-left');
      viewState.top = $dm.css('margin-top');

    } else { // restore

      // restore zoom scale to userZoomScale
      dynamicZoom(viewState.zoomScale - 100);
      $dm.css('margin-left', viewState.left);
      $dm.css('margin-top', viewState.top);
    }
  }

  function logAdSetInfo() {

    if (selectedAdSet) {

      console.log("Logging JSON for AdSet #" + selectedAdSet.gid);

      messager.send('adnauseam', {
          what: 'logAdSet',
          gid: selectedAdSet.gid,
          ids: selectedAdSet.childIds()
        },
        function (data) {
          location.href = "data:text/plain," +  encodeURI(data);
        });
    }
  }

  var ifs = ['#logo', '#ratio', '#stats', '#svgcon', '#x-close-button', '.zoom', '#bottom-text'];

  function toggleInterface() {

    showInterface = !showInterface;

    if (!showInterface) {

      $("body").css('background-image', 'none')
        .css({
          'background-color': '#fff'
        });

      ifs.forEach(function (s) {
        $(s).hide();
      });

      // remove all duplicate classes (TODO: just hide them)
      $(".item").removeClass(function (i, css) {
        return (css.match(/dup-count-/g) || []).join(' ');
      }).addClass('dup-count-1');

    } else {

      $("body").css('background-image', 'url(../img/gray_grid.png)')
        .css({
          'background-color': '#000'
        });

      ifs.forEach(function (s) {
        $(s).show();
      });
    }
  }

  function lightboxMode($selected) {

    if ($selected && !$selected.hasClass('inspected')) {

      var inspectedGid = parseInt($selected.attr('data-gid'));

      selectedAdSet = findAdSetByGid(inspectedGid); // throws

      // lazy-create the meta data for the adset (#61)
      if (!$selected.children('div.meta').length) {

        appendBulletsTo($selected, selectedAdSet);
      }

      $selected.addClass('inspected').siblings().removeClass('inspected');

      if (selectedAdSet.count() > 1) {

        $selected.find('span.counter-index').show(); // show index-counter
        bulletIndex($selected, selectedAdSet);

        animateInspector($selected);
      }

      var next = selectedAdSet.nextPending(); // tell the addon

      if (next) {

        messager.send('adnauseam', {
          what: 'itemInspected',
          id: next.id
        });
      }

      centerZoom($selected);

      $('#container').addClass('lightbox');

    } else if ($('#container').hasClass('lightbox')) {

      var $item = $('.item.inspected');

      // reset the class to the group class
      setItemClass($item, selectedAdSet.groupState());

      // remove inspected & re-hide index-counter
      $item.removeClass('inspected');
      $item.find('span.counter-index').hide();

      selectedAdSet = null;

      // stop animation and restore view
      animateInspector(false);
      centerZoom(false);

      $('#container').removeClass('lightbox');
    }
  }

  function animateInspector($inspected) {

    animatorId && clearTimeout(animatorId); // stop

    // animate if we have a dup-ad being inspected
    if ($inspected && selectedAdSet && selectedAdSet.count() > 1) {

      animatorId = setInterval(function () {

        //log("selectedAdSet.count():" +selectedAdSet.index, $inspected.length);

        if (++selectedAdSet.index === selectedAdSet.count())
          selectedAdSet.index = 0;

        bulletIndex($inspected, selectedAdSet);

      }, animateMs);
    }
  }

  function findAdById(id) {

    for (var i = 0, j = gAdSets.length; i < j; i++) {

      var childIdx = gAdSets[i].childIdxForId(id);

      if (childIdx > -1) {

        return {

          ad: gAdSets[i].child(childIdx),
          group: gAdSets[i],
          index: childIdx
        };
      }
    }

    //console.error('[ERROR] Vault: No ad for ID#' + id + " gAdSets: ", gAdSets);
  }

  function findItemDivByGid(gid) {

    var $item, items = $('.item');
    for (var i = 0; i < items.length; i++) {

      $item = $(items[i]);
      if (parseInt($item.attr('data-gid')) === gid)
        return $item;
    }

    return null; // item may not be available if filtered
  }

  function findAdSetByGid(gid) {

    for (var i = 0, j = gAdSets.length; i < j; i++) {

      if (gAdSets[i].gid === gid)
        return gAdSets[i];
    }

    throw Error('No group for gid: ' + gid);
  }

  function zoomIn(immediate) {

    // calculate the suitable zoomIdx by userZoomScale
    var previousState = zoomIdx;
    for (var i = 0; zoomIdx === previousState && i < Zooms.length; i++) {

      if (userZoomScale === Zooms[i])
        zoomIdx = i;
      else if (userZoomScale < Zooms[i] && userZoomScale > Zooms[i + 1])
        zoomIdx = i + 1;
    }

    (zoomIdx > 0) && setZoom(--zoomIdx, immediate);
  }

  function zoomOut(immediate) {

    // calculate the suitable zoomIdx by userZoomScale
    var previousState = zoomIdx;
    for (var i = 0; zoomIdx === previousState && i < Zooms.length - 1; i++) {

      if (userZoomScale === Zooms[i])
        zoomIdx = i;
      else if (userZoomScale < Zooms[i] && userZoomScale > Zooms[i + 1])
        zoomIdx = i;
    }

    (zoomIdx < Zooms.length - 1) && setZoom(++zoomIdx, immediate);
  }

  function setScale(scale) {

    $('#container').css({
      transform: 'scale(' + scale/100 + ')'
    });
  }

  function dynamicZoom(scaleInterval) {

    userZoomScale += scaleInterval;
    if (userZoomScale > Zooms[0])
      userZoomScale = Zooms[0];
    else if (userZoomScale < Zooms[Zooms.length - 1])
      userZoomScale = Zooms[Zooms.length - 1];

    setScale(userZoomScale);

    // set zoom-text to 2 decimal places
    $('#ratio').text(Math.round(userZoomScale * 100) / 100 + '%');
  }

  function setZoom(idx, immediate) {

    //log('setZoom('+idx+','+(immediate===true)+')');

    var $container = $('#container');

    // Disable transitions
    immediate && $container.addClass('notransition');

    setScale(Zooms[idx]); // set CSS scale for zooming

    userZoomScale = Zooms[idx]; // update userZoomScale

    $('#ratio').text(Zooms[idx] + '%'); // set zoom-text

    // Trigger reflow, flush cached CSS
    $container[0].offsetHeight;

    // Re-enable transitions
    immediate && $container.removeClass('notransition');
  }

  function onscreen($this, winW, winH, scale, percentVisible) {

    var off = $this.offset(),
      w = $this.width() * scale,
      h = $this.height() * scale,
      minX = (-w * (1 - percentVisible)),
      maxX = (winW - (w * percentVisible)),
      minY = (-h * (1 - percentVisible)),
      maxY = (winH - (h * percentVisible));

    //log('onscreen() :: trying: '+Zooms[zoomIdx]+"%",$this.attr('data-gid'),off.left, minX, maxX);

    return (!(off.left < minX || off.left > maxX || off.top < minY || off.top > maxY));
  }

  function openInNewTab(url) {

    window.open(url, '_blank').focus();
  }

  function asAdArray(adsets) { // remove

    var ads = [];
    for (var i = 0, j = adsets.length; i < j; i++) {
      for (var k = 0, m = adsets[i].children.length; k < m; k++)
        ads.push(adsets[i].children[k]);
    }
    return ads;
  }

  function addInterfaceHandlers(ads) {

    $('#x-close-button').click(function (e) {

      e.preventDefault();
      messager.send('adnauseam', {
        what: 'closeExtPage',
        page: 'vault.html'
      });
    });

    $('#logo').click(function (e) {

      e.preventDefault();
      openInNewTab('http://adnauseam.io');
    });

    $(document).click(function (e) {

      if (e.which === 1) // Left-button only
        lightboxMode(false);
    });

    $(document).keyup(function (e) {

      (e.keyCode === 27) && lightboxMode(false); // esc
      (e.keyCode === 73) && toggleInterface(); // 'i'
      (e.keyCode === 68) && logAdSetInfo(); // 'd'
      //console.log(e);
    });

    /////////// DRAG-STAGE ///////////
    var offsetX = 0;
    var offsetY = 0;
    var container_div = document.getElementById('container');

    container_div.addEventListener('mousedown', mouseDown, false);
    window.addEventListener('mouseup', mouseUp, false);

    function mouseUp()
    {
        window.removeEventListener('mousemove', divMove, true);
    }

    function mouseDown(e){
      window.addEventListener('mousemove', divMove, true);
      offsetX = e.pageX;
      offsetY = e.pageY;

    }

    function mouseOnAd(mouseX, mouseY){
      var ads = $(".ad")
      for(var i = 0; i < ads.length; i++){
        var itemTop = ads[i].getBoundingClientRect().top;
        var itemRight = ads[i].getBoundingClientRect().left + ads[i].getBoundingClientRect().width;
        var itemBottom = ads[i].getBoundingClientRect().top + ads[i].getBoundingClientRect().height;
        var itemLeft = ads[i].getBoundingClientRect().left;
        if(mouseX > itemLeft && mouseX < itemRight && mouseY > itemTop && mouseY < itemBottom) return true;
      }
      return false;
    }


    var divMove = function(e){
        draggingVault = false;
        if(mouseOnAd(e.pageX, e.pageY)){
          draggingVault = true;
        }

        var x_change = e.pageX - offsetX;
        var y_change = e.pageY - offsetY;

        var ml = parseInt(container_div.style.getPropertyValue("margin-left"));
        var mt = parseInt(container_div.style.getPropertyValue("margin-top"));

        container_div.style.marginLeft = (ml+=x_change) + 'px';
        container_div.style.marginTop = (mt+=y_change) + 'px';

        offsetX = e.pageX;
        offsetY = e.pageY;
    }

    /////////// ZOOM-STAGE ///////////

    $('#z-in').click(function (e) {

      e.preventDefault();
      zoomIn();
    });

    $('#z-out').click(function (e) {

      e.preventDefault();
      zoomOut();
    });

    $(window).resize(function () {

        adjustHeight();
        if ($('#container').hasClass('lightbox')) {
            centerZoom($('.inspected'));
            return;
        }

        clearTimeout(resizeId); // only when done
        resizeId = setTimeout(function () {
          createSlider(true);
        }, 100);



    });

    if (EnableContextMenu) {

      // if the document is clicked somewhere
      $(document).bind("mousedown", function (e) {

        // if the clicked element is not the delete-menu
        if ($(e.target).parents(".custom-menu").length < 1) {

          $(".custom-menu").hide(50);
        }
      });

      // if a context-menu element is right-clicked
      $(".custom-menu li").click(function () {

        if (!selectedAdSet) {

          error("No selectedAdSet!");
          return;
        }

        switch ($(this).attr("data-action")) {

        case "delete":

          var ids = selectedAdSet.childIds(),
            $item = findItemDivByGid(selectedAdSet.gid);

          // remove the adset item from the DOM
          $item.remove();

          // remove each ad from the full-adset
          gAds = gAds.filter(function (ad) {
            for (var i = 0, len = ids.length; i < len; i++) {
              if (ad.id === ids[i])
                return false;
            }
            return true;
          });

          // remove the adSet
          arrayRemove(gAdSets, selectedAdSet);

          // tell the addon
          messager.send('adnauseam', {
            what: 'deleteAdSet',
            ids: selectedAdSet.childIds()
          });

          createSlider(false, true);

          break;
        }

        selectedAdSet = null;

        $(".custom-menu").hide(100); // close context-menu
      });
    }

    $("body").mousewheel(function (e) {

      if ($('#container').hasClass('lightbox')) {

        lightboxMode(false);
        return;
      }

      // rawDeltaY denotes how fast the mousewheel got scrolled
      var rawDeltaY = e.deltaY * e.deltaFactor;
      var scale = (Math.abs(rawDeltaY) >= 100) ? rawDeltaY / 100 : rawDeltaY / 10;

      dynamicZoom(scale);
    });
  }

  /********************************************************************/

  // Here is where we group individual ads into AdSets, based on their hash,
  // created from the domain it was found on, and its content-data
  // If we get too many cross-domain duplicate images, we may need to revisit
  // -- called just once per layout
  function createAdSets(ads) {

    //console.log('Vault-Slider.createAdSets: ' + ads.length + '/' + gAds.length + ' ads');

    var key, ad, hash = {},
      adsets = [];

    // set hidden val for each ad
    for (var i = 0, j = ads.length; i < j; i++) {

      ad = ads[i];

      key = computeHash(ad);

      if (!key) continue;

      if (!hash[key]) {

        // new: add a hash entry
        hash[key] = new AdSet(ad);
        adsets.push(hash[key]);

      } else {

        // dup: add as child
        hash[key].add(ad);
      }
    }

    // sort adset children by foundTs

    for (i = 0, j = adsets.length; i < j; i++) {

      adsets[i].children.sort(byField('-foundTs'));
    }

    return adsets;
  }

  function repack() {

    var done = false,
      $items = $(".item"),
      visible = $items.length,
      $container = $('#container');

    setTimeout(function () {
      if (!done) $('#loading-img').show();
    }, 2000);

    showAlert(visible ? false : 'no ads found');

    var loader = imagesLoaded($container, function () {

      if (visible > 1) {

        var p = new Packery('#container', {
          centered: {
            y: 5000
          }, // centered at half min-height
          itemSelector: '.item',
          gutter: 1
        });

        computeZoom($items);
      } else if (visible === 1) {

        $items.css({ // center single

          top: (5000 - $items.height() / 2) + 'px',
          left: (5000 - $items.width() / 2) + 'px'
        });
      }

      done = true;

      $('#loading-img').hide();
    });
  }

  /********************************************************************/

  function createSlider(relayout, fromDelete) {

    // console.log('Vault-Slider.createSlider: '+gAds.length);

    // remember brush if it is fromDelete
    var lastBrush;
    if (fromDelete)  lastBrush = document.getElementsByClassName("brush")[0];

    // clear all the old svg
    d3.select("g.parent").selectAll("*").remove();
    d3.select("svg").remove();


    if (!gAds || !gAds.length) {
      computeStats();
      showAlert('no ads found');
      $('#loading-img').hide();
      return;
    }

    // setting up the position of the chart
    var iconW = 100;

    try {

      var width = parseInt(d3.select("#stage").style("width")) -
        (margin.left + margin.right + iconW);
    } catch (e) {
      throw Error("[D3] NO STAGE (page-not-ready?)");
    }

    // finding the first and last ad
    var minDate = d3.min(gAds, function (d) {
        return d.foundTs;
      }),
      maxDate = d3.max(gAds, function (d) {
        return d.foundTs;
      });

    // mapping the scales
    var xScale = d3.time.scale()
      .domain([minDate, maxDate])
      .range([0, width]);

    // create an array of dates
    var map = gAds.map(function (d) {
      return parseInt(xScale(d.foundTs));
    });

    // setup the histogram layout
    var histogram = d3.layout.histogram()
      .bins(400)(map);

    // setup the x axis
    var xAxis = d3.svg.axis()
      .scale(xScale)
      .tickFormat(d3.time.format.multi([
        [".%L", function (d) {
          return d.getMilliseconds();
        }],
        [":%S", function (d) {
          return d.getSeconds();
        }],
        ["%I:%M", function (d) {
          return d.getMinutes();
        }],
        ["%I %p", function (d) {
          return d.getHours();
        }],
        ["%a %d", function (d) {
          return d.getDay() && d.getDate() != 1;
        }],
        ["%b %d", function (d) {
          return d.getDate() != 1;
        }],
        ["%B", function (d) {
          return d.getMonth();
        }],
        ["%Y", function () {
          return true;
        }]
      ])).ticks(7);

    // position the SVG
    var svg = d3.select("#svgcon")
      .append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", /*height +*/ margin.top + margin.bottom)
      .append("g")
      .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    // append the x axis
    svg.append("g") // [ONCE]
      .attr("class", "x axis")
      .call(xAxis);

    svg.append("rect") // [ONCE]
      .attr("class", "chart-bg")
      .attr("height", 50)
      .attr("width", width)
      .attr("y", -50)
      .attr("fill", "#000")
      .attr("fill-opacity", ".5");

    var barw = histogram[0].dx - 1; //relative width

    // Create groups for the bars
    var bars = svg.selectAll(".bar")
      .data(histogram)
      .enter()
      .append("g");

    // Y scale
    var yScale = d3.scale.linear()
        .domain([0, d3.max(histogram, function(d) { return d.length; })])
        .range([-2, -46]);

    bars.append("line")
      .attr("x1", function (d) {
        return d.x + barw / 2;
      })
      .attr("y1", -2)
      .attr("x2", function (d) {
        return d.x + barw / 2;
      })
      .attr("y2", function (d) {
        return yScale(d.y);
      })
      .attr("style", "stroke-width:" + barw + "; stroke-dasharray: 1,0.5; stroke: #999");

    // setup the brush
     var bExtent = [computeMinDateFor(gAds, minDate), maxDate],
      brush = d3.svg.brush()
      .x(xScale)
      .extent(bExtent)
      .on("brushend", brushend);

    // add the brush
    if (fromDelete) {
      // append the old brus
      document.getElementById("svgcon").getElementsByTagName("svg")[0].firstChild.appendChild(lastBrush);
    }
    else {
    var gBrush = svg.append("g")
      .attr("class", "brush")
      .call(brush);

    // set the height of the brush to that of the chart
    gBrush.selectAll(".brush .extent")
      .attr("height", 49)
      .attr("y", -50)
      .attr("fill", "#0076FF")
      .attr("fill-opacity", ".25");

    // set the height of the brush to that of the chart
    // gBrush.selectAll("rect")
    //   .attr("y", -50);

    // attach handle image
    gBrush.selectAll(".resize").append("image")
      .attr("xlink:href","../img/timeline-handle.svg")
      .attr("width", 5)
      .attr("height", 50)
      .attr("y", -50)
      .attr("x", -3);
    }

    // cases: 1) no-gAdSets=first time, 2) filter+layout, 3) only-slider

    // do filter, then call either doLayout or computeStats
    (relayout ? doLayout : computeStats)(fromDelete ? gAdSets : runFilter(bExtent));
    // ---------------------------- functions ------------------------------

    // this is called on brushend() and createSlider()
    function runFilter(ext) {

      //log('vault.js::runFilter: '+ext[0]+","+ext[1]);
      centerContainer();
      gMin = ext[0], gMax = ext[1];

      gSliderRight = d3.select('.w.resize')[0][0].attributes.transform.value;
      gSliderLeft = d3.select('.e.resize')[0][0].attributes.transform.value;

      if (gAdSets != null && gAds.length !== 1 && gMax - gMin <= 1) {

        //console.log('vault-slider::ignore-micro: ' + ext[0] + "," + ext[1]);
        return; // gAdSets || (gAdSets = createAdSets(gAds)); // fix for gh #100
      }

      if (gAds.length >= MaxStartNum) {
        uDom("a[class=showing-help]").text("?")
        uDom("a[class=showing-help]").addClass("help-mark")
      }

      var filtered = dateFilter(gMin, gMax);


      return gAdSets && gAds.length < MaxStartNum ? filterAdSets(filtered) :
        (gAdSets = createAdSets(filtered));
    }

    function centerContainer() {
      $('#container').addClass('notransition')
        .css({
          marginLeft: '-5000px',
          marginTop: '-5000px'
        })
        .removeClass('notransition');
    }

    function filterAdSets(ads) {

      //console.log('Vault-slider.filterAdSets: ' + ads.length + '/' + gAds.length + ' ads');

      var sets = [];
      for (var i = 0, j = ads.length; i < j; i++) {
        for (var k = 0, l = gAdSets.length; k < l; k++) {

          if (gAdSets[k].childIdxForId(ads[i].id) > -1) {

            if (sets.indexOf(gAdSets[k]) < 0)
              sets.push(gAdSets[k]);
          }
        }
      }
      return sets;
    }

    function computeMinDateFor(ads, min) {

      if (ads && ads.length) {

        ads.sort(byField('-foundTs')); // or slice?
        var subset = ads.slice(0, MaxStartNum);
        return subset[subset.length - 1].foundTs;
      }
      return min;
    }

    function dateFilter(min, max) {

      //log('dateFilter: min='+min+', max='+max);

      var filtered = [];

      // NOTE: always need to start from full-set (all) here
      for (var i = 0, j = gAds.length; i < j; i++) {

        if (!(gAds[i].foundTs < min || gAds[i].foundTs > max)) {

          filtered.push(gAds[i]);
        }
      }

      return filtered;
    }

    function brushend() {
      var lastgSliderRight = gSliderRight;
      var lastgSliderLeft = gSliderLeft;
      gSliderRight = d3.select('.w.resize')[0][0].attributes.transform.value;
      gSliderLeft = d3.select('.e.resize')[0][0].attributes.transform.value;

      if (!lastgSliderRight || !lastgSliderLeft) {
        return;

      }
      if (gSliderRight === lastgSliderRight && gSliderLeft === lastgSliderLeft) {

        return;
      } else {

        var filtered = runFilter(d3.event.target.extent());
        filtered && doLayout(filtered);
      }

    }
  }

  /********************************************************************/

  var TEXT_MINW = 150,
    TEXT_MAXW = 450;

  function AdSet(ad) {

    this.gid = Math.abs(createGid(ad));
    this.children = [];
    this.index = 0;
    this.add(ad);
  }

  AdSet.prototype.id = function (i) {

    return this.child(i).id;
  };

  AdSet.prototype.childIds = function () {

    var ids = [];

    for (var i = 0, j = this.children.length; i < j; i++) {

      this.children[i] && ids.push(this.children[i].id);
    }

    return ids;
  };

  AdSet.prototype.childIdxForId = function (id) {

    for (var i = 0, j = this.children.length; i < j; i++) {

      if (this.children[i].id === id)
        return i;
    }

    return -1;
  };

  AdSet.prototype.child = function (i) {

    return this.children[(typeof i === 'undefined') ? this.index : i];
  };

  AdSet.prototype.state = function (i) {

    var ad = this.child(i) || i;

    if (!ad) console.warn('invalid index!');

    if (ad.dntAllowed) {
      return 'dnt-allowed';
    }

    // ad should not be 'failed' until 3 failed visits (gh #64)
    if (ad.visitedTs === 0 || (ad.attempts < 3 && ad.visitedTs < 0)) {
      return 'pending';
    }

    return ad.visitedTs < 0 ? 'failed' : 'visited';
  };

  AdSet.prototype.type = function () {

    return this.children[0].contentType; // same-for-all
  };

  AdSet.prototype.failedCount = function () {

    var containerObj = this;

    return this.children.filter(function (d) {

      return containerObj.state(d) === 'failed';

    }).length;// === containerObj.children.length;
  };

  AdSet.prototype.dntCount = function () {

    var containerObj = this;

    return this.children.filter(function (d) {

      return containerObj.state(d) === 'dnt-allowed';

    }).length;// === containerObj.children.length;
  };

  AdSet.prototype.visitedCount = function () {

    return this.children.filter(function (d) {

      return d.visitedTs > 0;

    }).length;
  };

  AdSet.prototype.nextPending = function () {

    var ads = this.children.slice();
    ads.sort(byField('-foundTs'));

    for (var i = 0, j = ads.length; i < j; i++) {

      if (ads[i].visitedTs === 0) // pending
        return ads[i];
    }

    return null;
  };

  AdSet.prototype.count = function () {

    return this.children.length;
  };

  AdSet.prototype.add = function (ad) {

    ad && this.children.push(ad);
  };

  function createGid(ad) {

    var hash = 0,
      key = computeHash(ad);

    for (var i = 0; i < key.length; i++) {
      var code = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + code;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }

  function adjustHeight(){
      $("#stage").css('height', String($(window).height() - $("#notifications").height()) + "px" );
  }

  /*
   * returns 'visited' if any are visited,
   *      'dnt-allowed' if all are dnt-allowed
   *      'failed' if all are failed or pending or dnt-allowed,
   *      'pending' if all are pending or dnt-allowed.
   *
   * what about dnt here ?
   */
  AdSet.prototype.groupState = function () {

    var visited = this.visitedCount();

    if (visited) return 'visited';

    var dnts = this.dntCount();

    if (dnts === this.children.length) {
      return 'dnt-allowed';
    }

    var failed = this.failedCount();

    return failed ? 'failed' : 'pending';
  };

  messager.send('adnauseam', {
    what: 'adsForVault'
  }, renderAds);

  $('#export').on('click', exportToFile);
  $('#import').on('click', startImportFilePicker);
  $('#importFilePicker').on('change', handleImportAds);
  $('#reset').on('click', clearAds);

})();
