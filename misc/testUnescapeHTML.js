var unescapeHTML = function (s) { // hack

  var entities = [
  '#0*32', ' ',
  '#0*33', '!',
  '#0*34', '"',
  '#0*35', '#',
  '#0*36', '$',
  '#0*37', '%',
  '#0*38', '&',
  '#0*39', '\'',

  'apos', '\'',
  'amp', '&',
  'lt', '<',
  'gt', '>',
  'quot', '"',
  '#x27', '\'',
  '#x60', '`'
  ];

  for (var i = 0; i < entities.length; i += 2) {
    var zz = '\&' + entities[i] + ';';
    console.log(zz);
    s = s.replace(new RegExp(zz,'g'), entities[i + 1]);
  }

  return s;
}


var test = 'Why &#39;The Walking Dead&#039; Is About To Kill Off Half Its Cast - ZergNet';
console.log(unescapeHTML(test));
