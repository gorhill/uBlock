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

// functions shared between addon and ui

'use strict';

/**************************** Notifications *********************************/

var WARNING = 'warning', ERROR = 'error', INFO = 'info', SUCCESS = 'success',
  FAQ = 'https://github.com/dhowe/AdNauseam/wiki/FAQ';

// TODO: set as properties of Notifications obj
var ClickingDisabled = new Notification({
  name: 'ClickingDisabled',
  text: 'Activate Ad clicking'
});

var HidingDisabled = new Notification({
  name: 'HidingDisabled',
  text: 'Activate Ad hiding'
});

var BlockingDisabled = new Notification({
  name: 'BlockingDisabled',
  text: 'Activate malware blocking',
  type: ERROR
});

var EasyList = new Notification({
  name: 'EasyListDisabled',
  text: 'Activate the EasyList filter',
  buttonLink: '3p-filters.html',
  listUrl: 'assets/thirdparties/easylist-downloads.adblockplus.org/easylist.txt',
});

var Notifications = [HidingDisabled, ClickingDisabled, BlockingDisabled, EasyList];

function Notification(m) {

  this.name = m && m.hasOwnProperty('name') ? m.name : '';
  this.text = m && m.hasOwnProperty('text') ? m.text : '';
  this.link = m && m.hasOwnProperty('link') ? m.link : FAQ;
  this.type = m && m.hasOwnProperty('type') ? m.type : WARNING;
  this.listUrl = m && m.hasOwnProperty('listUrl') ? m.listUrl : '';
  this.button = m && m.hasOwnProperty('button') ? m.button : 'Reactivate';
  this.buttonLink = m && m.hasOwnProperty('buttonLink') ? m.buttonLink : 'dashboard.html';

  if ([WARNING, ERROR, INFO, SUCCESS].indexOf(this.type) < 0)
    throw Error('Bad type: ' + m.type);
}

var addNotification = function (notes, note) {

  for (var i = 0; i < notes.length; i++) {
    if (notes[i].name === note.name)
      return false;
  }
  notes.push(note);
  return true;
};

var removeNotification = function (notes, note) {

  for (var i = 0; i < notes.length; i++) {
    if (notes[i].name === note.name) {
      notes.splice(i, 1);
      return true;
    }
  }
  return false;
};

var renderNotifications = function (visibleNotes) {

  //console.log('renderNotifications', visibleNotes);

  var origUdom = uDom; // this may be called from a frame or not
  if (window.self != window.top) uDom = window.top.uDom;

  var template = uDom('#notify-template');

  if (!template.length) throw Error('no template');

  for (var i = 0; i < Notifications.length; i++) {

    var notify = Notifications[i];

    //var showing = (notes.indexOf(notify) > -1);
    var match = visibleNotes && visibleNotes.filter(function (n) {
      return notify.name === n.name;
    });

    var note = uDom('#' + notify.name),
      exists = note.length;

    if (match && match.length) {
      //console.log("MATCH: "+notify.name, match);
      if (exists)
        note.toggleClass('hide', false);
      else
        appendNotifyDiv(notify, template, uDom);

    } else {

      exists && note.toggleClass('hide', true);
    }
  }

  uDom = origUdom; // reset uDom
}

var appendNotifyDiv = function (notify, template) {//}, uDom) {

  var node = template.clone(false);

  node.addClass(notify.type);
  node.attr('id', notify.name);
  uDom('#notify-text', node.nodes[0]).text(notify.text);
  uDom('#notify-button', node.nodes[0]).text(notify.button);
  uDom('#notify-link', node.nodes[0]).attr('href', notify.link);

  uDom('#notifications').append(node);
}

/******************************* Polyfill ***********************************/

if (Array.prototype.contains instanceof Function === false) {

  Array.prototype.contains = function (a) {
    var b = this.length;
    while (b--) {
      if (this[b] === a) {
        return true;
      }
    }
    return false;
  };
}

if (String.prototype.startsWith instanceof Function === false) {
  String.prototype.startsWith = function (needle, pos) {
    if (typeof pos !== 'number') {
      pos = 0;
    }
    return this.lastIndexOf(needle, pos) === pos;
  };
}

if (String.prototype.endsWith instanceof Function === false) {
  String.prototype.endsWith = function (needle, pos) {
    if (typeof pos !== 'number') {
      pos = this.length;
    }
    pos -= needle.length;
    return this.indexOf(needle, pos) === pos;
  };
}

/****************************************************************************/

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

var setCost = function (numVisited) {

  //console.log('setCost: '+numVisited);

  var $west = uDom('#worth-estimate'),
    $cost = uDom('.cost');

  if (numVisited > 0) {
    $cost.removeClass('hidden');
    $west.text('= $' + (numVisited * 1.58).toFixed(2));
  } else {
    $cost.addClass('hidden');
  }
}

var arrayRemove = function (arr, obj) {

  var i = arr.indexOf(obj);
  if (i != -1) {
    arr.splice(i, 1);
    return true;
  }
  return false;
}

var trimChar = function (s, chr) {

  while (s.endsWith(chr)) {
    s = s.substring(0, s.length - chr.length);
  }

  return s;
}

var showAlert = function (msg) {

  if (msg) {

    $("#alert").removeClass('hide');
    $("#alert p").text(msg);

  } else {

    $("#alert").addClass('hide');
  }
}

var type = function (obj) { // from Angus Croll

  return ({}).toString.call(obj).match(/\s([a-zA-Z]+)/)[1].toLowerCase()
}

var getExportFileName = function () {

  return vAPI.i18n('adnExportedAdsFilename')
    .replace('{{datetime}}', new Date().toLocaleString())
    .replace(/[:/,]+/g, '.').replace(/ +/g, '');
}

var computeHash = function (ad) { // DO NOT MODIFY

  if (!ad) return;

  if (!ad.contentData || !ad.pageUrl) {
    console.error("Invalid Ad: no contentData || pageUrl", ad);
    return;
  }

  var hash = ad.pageDomain || ad.pageUrl, // change from pageUrl (4/3/16) ***
    // fall back to pageUrl if pageDomain is undefined for backward compatibility
    keys = Object.keys(ad.contentData).sort();

  for (var i = 0; i < keys.length; i++) {
    hash += '::' + ad.contentData[keys[i]];
  }

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

var stringNotEmpty = function (s) {

  return typeof s === 'string' && s !== '';
};

/************************ URL utils *****************************/

var parseHostname = function (url) {

  return new URL(url).hostname;
}

// TODO: replace with core::domainFromURI?
var parseDomain = function (url, useLast) {

  var domains = decodeURIComponent(url).match(/https?:\/\/[^?\/]+/g);
  return domains.length ? new URL(
      useLast ? domains[domains.length - 1] : domains[0])
    .hostname : undefined;
}

/*
 * Start with resolvedTargetUrl if available, else use targetUrl
 * Then extract the last domain from the (possibly complex) url
 */
var targetDomain = function (ad) {

  var dom = parseDomain(ad.resolvedTargetUrl || ad.targetUrl, true);

  if (!dom) console.warn("Unable to parse domain: " + url);

  return dom;
}

/*** functions used to export/import/clear ads in vault.js and options.js ***/

var exportToFile = function () {

  vAPI.messaging.send('adnauseam', {
    what: 'exportAds',
    filename: getExportFileName()
  });
};

function handleImportFilePicker(evt) {

  var files = evt.target.files;
  var reader = new FileReader();

  reader.onload = function (e) {

    var adData;
    try {
      adData = JSON.parse(e.target.result);
    } catch (e) {
      postImportAlert({
        count: -1,
        error: e
      });
      return;
    }

    vAPI.messaging.send('adnauseam', {
      what: 'importAds',
      data: adData,
      file: files[0].name
    }, postImportAlert);
  }

  reader.readAsText(files[0]);
}

var postImportAlert = function (msg) {

  var text = msg.count > -1 ? msg.count : msg.error;
  vAPI.alert(vAPI.i18n('adnImportAlert')
    .replace('{{count}}', text));
};

var startImportFilePicker = function () {

  var input = document.getElementById('importFilePicker');
  // Reset to empty string, this will ensure an change event is properly
  // triggered if the user pick a file, even if it is the same as the last
  // one picked.
  input.value = '';
  input.click();
};

var clearAds = function () {

  var msg = vAPI.i18n('adnClearConfirm');
  var proceed = vAPI.confirm(msg);
  if (proceed) {
    vAPI.messaging.send('adnauseam', {
      what: 'clearAds'
    });
  }
};
