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
