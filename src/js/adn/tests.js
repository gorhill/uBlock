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

QUnit.test('parseDomain', function (assert) {

  assert.equal(parseDomain("http://google.com"), "google.com");
  assert.equal(parseDomain("https://google.com/page"), "google.com");
  assert.equal(parseDomain("http://google.com/page.html"), "google.com");
  assert.equal(parseDomain("https://play.google.com/page"), "play.google.com");
  assert.equal(parseDomain("http://play.google.com/page.html"), "play.google.com");
  assert.equal(parseDomain("https://google.com/page.html?key=val"), "google.com");
  assert.equal(parseDomain("http://google.com/page.html?key=yahoo.com"), "google.com");
  assert.equal(parseDomain("http://google.com?target=http://renwick.com/page"), "google.com");

  assert.equal(parseDomain("http://google.com?target=http%3A%2F%2F15renwick%2Ecom%2F%3Futm_source%3DNYTimes%2Ecom%26utm_medium%3DBanner%26utm_campaign%3DHomepage%2520Module/"), "google.com");
  assert.equal(parseDomain("http://play.google.com?target=http://renwick.com/page"), "play.google.com");
  assert.equal(parseDomain("http://play.google.com?target=http%3A%2F%2F15renwick%2Ecom%2F%3Futm_source%3DNYTimes%2Ecom%26utm_medium%3DBanner%26utm_campaign%3DHomepage%2520Module/"), "play.google.com");
  assert.equal(parseDomain("http://play.google.com?target=http://play.renwick.com/page"), "play.google.com");

  assert.equal(parseDomain("http://google.com?target=http://15renwick.com/page", true), "15renwick.com");
  assert.equal(parseDomain("http://google.com?target=http%3A%2F%2F15renwick%2Ecom%2F%3Futm_source%3DNYTimes%2Ecom%26utm_medium%3DBanner%26utm_campaign%3DHomepage%2520Module/", true), "15renwick.com");
  assert.equal(parseDomain("http://play.google.com?target=http://15renwick.com/page", true), "15renwick.com");
  assert.equal(parseDomain("http://play.google.com?target=http%3A%2F%2F15renwick%2Ecom%2F%3Futm_source%3DNYTimes%2Ecom%26utm_medium%3DBanner%26utm_campaign%3DHomepage%2520Module/", true), "15renwick.com");
  assert.equal(parseDomain("http://play.google.com?target=http://play.15renwick.com/page", true), "play.15renwick.com");
});

QUnit.test('parseOnClick', function (assert) {


  var host = 'thepage.com';
  var test = '<div onclick=\"window.open(\'http://google.com\',toolbar=no,location = no,status = no,menubar = no,scrollbars = yes,resizable = yes,width = SomeSize,height = SomeSize\');return false;\">link</div>';
  assert.equal(parseOnClick(test, host), 'http://google.com');

  test = '<div onclick=\"javascript:window.open(\'http://google.com\',toolbar=no,location = no,status = no,menubar = no,scrollbars = yes,resizable = yes,width = SomeSize,height = SomeSize\');return false;\">link</div>';
  assert.equal(parseOnClick(test, host), 'http://google.com');

  test = '<div onclick=\"javascript:window.open(\'http://google.com\')\">link</div>';
  assert.equal(parseOnClick(test, host), 'http://google.com');

  test = '<div onClick=\'window.open("http://google.com")\'>link</div>';
  assert.equal(parseOnClick(test, host), 'http://google.com');

  test = '<div onClick=\'window.open(http://google.com)\'>link</div>';
  assert.equal(parseOnClick(test, host), 'http://google.com');

  test = '<div onclick=\"aBunchofRandomJScode();\">link</div>';
  assert.equal(parseOnClick(test, host), undefined);

  test = '<div onClick=\'window.open("relative/link.html")\'>link</div>';
  assert.equal(parseOnClick(test, host), 'http://thepage.com/relative/link.html');

  test = '<div onClick=\'window.open("relative/link.html")\'>link</div>';
  assert.equal(parseOnClick(test, 'https://thepage.com'), 'https://thepage.com/relative/link.html');

});
