import { JSONPath } from '../src/js/jsonpath.js';

const jsonpathTests = [ {
    // https://www.rfc-editor.org/rfc/rfc9535.html#section-2.3.1.3
    json: `{
      "o": {"j j": {"k.k": 3}},
      "'": {"@": 2}
    }`,
    queries: [
        { q: `$.o['j j']`, r: [
            ['o','j j'],
        ] },
        { q: `$.o['j j']['k.k']`, r: [
            ['o','j j','k.k'],
        ] },
        { q: `$.o["j j"]["k.k"]`, r: [
            ['o','j j','k.k'],
        ] },
        { q: `$["'"]["@"]`, r: [
            ["'",'@'],
        ] },
    ],
},{
    // https://www.rfc-editor.org/rfc/rfc9535.html#section-2.3.2.3
    json: `{
      "o": {"j": 1, "k": 2},
      "a": [5, 3]
    }`,
    queries: [
        { q: `$[*]`, r: [
            ['o'],
            ['a'],
        ] },
        { q: `$.o[*]`, r: [
            ['o','j'],
            ['o','k'],
        ] },
        { q: `$.o[*, *]`, r: [
            ['o','j'],
            ['o','k'],
            ['o','j'],
            ['o','k'],
        ] },
        { q: `$.a[*]`, r: [
            ['a',0],
            ['a',1],
        ] },
    ],
},{
    // https://www.rfc-editor.org/rfc/rfc9535.html#section-2.3.3.3
    json: `["a","b"]`,
    queries: [
        { q: `$[1]`, r: [
            [1],
        ] },
        { q: `$[-2]`, r: [
            [0],
        ] },
    ],
},{
    // https://www.rfc-editor.org/rfc/rfc9535.html#section-2.3.4.3
    json: `["a", "b", "c", "d", "e", "f", "g"]`,
    queries: [
        { q: `$[1:3]`, r: [
            [1],
            [2],
        ] },
        { q: `$[5:]`, r: [
            [5],
            [6],
        ] },
        { q: `$[1:5:2]`, r: [
            [1],
            [3],
        ] },
        { q: `$[5:1:-2]`, r: [
            [5],
            [3],
        ] },
        { q: `$[::-1]`, r: [
            [6],
            [5],
            [4],
            [3],
            [2],
            [1],
            [0],
        ] },
    ],
},{
    // https://www.rfc-editor.org/rfc/rfc9535.html#section-2.3.5.3-7
    json: `{
      "a": [3, 5, 1, 2, 4, 6,
            {"b": "j"},
            {"b": "k"},
            {"b": {}},
            {"b": "kilo"}
           ],
      "o": {"p": 1, "q": 2, "r": 3, "s": 5, "t": {"u": 6}},
      "e": "f"
    }`,
    queries: [
        { q: `$.a[?@.b == 'kilo']`, r: [
            ['a', 9],
        ] },
        { q: `$.a[?(@.b == 'kilo')]`, r: [
            ['a', 9],
        ] },
        { q: `$.a[?@>3.5]`, r: [
            ['a', 1],
            ['a', 4],
            ['a', 5],
        ] },
        { q: `$.a[?@.b]`, r: [
            ['a', 6],
            ['a', 7],
            ['a', 8],
            ['a', 9],
        ] },
        { q: `$[?@.*]`, r: [
            ['a'],
            ['o'],
        ] },
        { q: `$[?@[?@.b]]`, r: [
            ['a'],
        ] },
        { q: `$.o[?@<3, ?@<3]`, r: [
            ['o', 'p'],
            ['o', 'q'],
            ['o', 'q'],
            ['o', 'p'],
        ] },
        { q: `$.a[?@<2 || @.b == "k"]`, r: [
            ['a', 2],
            ['a', 7],
        ] },
        { q: `$.a[?match(@.b, "[jk]")]`, r: [
            ['a', 6],
            ['a', 7],
        ] },
        { q: `$.a[?search(@.b, "[jk]")]`, r: [
            ['a', 6],
            ['a', 7],
            ['a', 9],
        ] },
        { q: `$.o[?@>1 && @<4]`, r: [
            ['o', 'q'],
            ['o', 'r'],
        ] },
        { q: `$.o[?@.u || @.x]`, r: [
            ['o', 't'],
        ] },
        { q: `$.a[?@.b == $.x]`, r: [
            ['a', 0],
            ['a', 1],
            ['a', 2],
            ['a', 3],
            ['a', 4],
            ['a', 5],
        ] },
        { q: `$.a[?@ == @]`, r: [
            ['a', 0],
            ['a', 1],
            ['a', 2],
            ['a', 3],
            ['a', 4],
            ['a', 5],
            ['a', 6],
            ['a', 7],
            ['a', 8],
        ] },
    ],
},{
    // https://www.rfc-editor.org/rfc/rfc9535.html#section-2.5.1.3
    json: `["a", "b", "c", "d", "e", "f", "g"]`,
    queries: [
        { q: `$[0, 3]`, r: [
            [0],
            [3],
        ] },
        { q: `$[0:2, 5]`, r: [
            [0],
            [1],
            [5],
        ] },
        { q: `$[0, 0]`, r: [
            [0],
            [0],
        ] },
    ],
},{
    // https://www.rfc-editor.org/rfc/rfc9535.html#section-2.5.2.3
    json: `{
      "o": {"j": 1, "k": 2},
      "a": [5, 3, [{"j": 4}, {"k": 6}]]
    }`,
    queries: [
        { q: `$..j`, r: [
            ['o', 'j'],
            ['a', 2, 0, 'j'],
        ] },
        { q: `$..[0]`, r: [
            ['a', 0],
            ['a', 2, 0],
        ] },
        { q: `$..*`, r: [
            ['o'],
            ['a'],
            ['o', 'j'],
            ['o', 'k'],
            ['a', 0],
            ['a', 1],
            ['a', 2],
            ['a', 2, 0],
            ['a', 2, 1],
            ['a', 2, 0, 'j'],
            ['a', 2, 1, 'k'],
        ] },
        { q: `$..o`, r: [
            ['o'],
        ] },
        { q: `$.o..[*, *]`, r: [
            ['o', 'j'],
            ['o', 'k'],
            ['o', 'k'],
            ['o', 'j'],
        ] },
        { q: `$.a..[0, 1]`, r: [
            ['a', 0],
            ['a', 1],
            ['a', 2, 0],
            ['a', 2, 1],
        ] },
    ],
},{
    // https://www.rfc-editor.org/rfc/rfc9535.html#section-2.6.1
    json: `{"a": null, "b": [null], "c": [{}], "null": 1}`,
    queries: [
        { q: `$.a`, r: [
            ['a'],
        ] },
        { q: `$.a[0]`, r: [
        ] },
        { q: `$.a.d`, r: [
        ] },
        { q: `$.b[0]`, r: [
            ['b', 0],
        ] },
        { q: `$.b[*]`, r: [
            ['b', 0],
        ] },
        { q: `$.b[?@]`, r: [
            ['b', 0],
        ] },
        { q: `$.b[?@==null]`, r: [
            ['b', 0],
        ] },
        { q: `$.c[?@.d==null]`, r: [
        ] },
        { q: `$.null`, r: [
            ['null'],
        ] },
    ],
},{
    // https://www.rfc-editor.org/rfc/rfc9535.html#section-1.5
    json: `{ "store": {
        "book": [ 
          { "category": "reference",
            "author": "Nigel Rees",
            "title": "Sayings of the Century",
            "price": 8.95
          },
          { "category": "fiction",
            "author": "Evelyn Waugh",
            "title": "Sword of Honour",
            "price": 12.99
          },
          { "category": "fiction",
            "author": "Herman Melville",
            "title": "Moby Dick",
            "isbn": "0-553-21311-3",
            "price": 8.99
          },
          { "category": "fiction",
            "author": "J. R. R. Tolkien",
            "title": "The Lord of the Rings",
            "isbn": "0-395-19395-8",
            "price": 22.99
          }
        ],
        "bicycle": {
          "color": "red",
          "price": 19.95
        }
      }
    }`,
    queries: [
        { q: `$.store.book[*].author`, r: [
            ['store', 'book', 0, 'author'],
            ['store', 'book', 1, 'author'],
            ['store', 'book', 2, 'author'],
            ['store', 'book', 3, 'author'],
        ] },
        { q: `$..author`, r: [
            ['store', 'book', 0, 'author'],
            ['store', 'book', 1, 'author'],
            ['store', 'book', 2, 'author'],
            ['store', 'book', 3, 'author'],
        ] },
        { q: `$.store.*`, r: [
            ['store', 'book'],
            ['store', 'bicycle'],
        ] },
        { q: `$.store..price`, r: [
            ['store', 'book', 0, 'price'],
            ['store', 'book', 1, 'price'],
            ['store', 'book', 2, 'price'],
            ['store', 'book', 3, 'price'],
            ['store', 'bicycle', 'price'],
        ] },
        { q: `$..book[2]`, r: [
            ['store', 'book', 2],
        ] },
        { q: `$..book[-1]`, r: [
            ['store', 'book', 3],
        ] },
        { q: `$..book[-1:]`, r: [
            ['store', 'book', 3],
        ] },
        { q: `$..book[0,1]`, r: [
            ['store', 'book', 0],
            ['store', 'book', 1],
        ] },
        { q: `$..book[:2]`, r: [
            ['store', 'book', 0],
            ['store', 'book', 1],
        ] },
        { q: `$..book[?@.isbn]`, r: [
            ['store', 'book', 2],
            ['store', 'book', 3],
        ] },
        { q: `$..book[?@.price<10]`, r: [
            ['store', 'book', 0],
            ['store', 'book', 2],
        ] },
        { q: `$..*`, r: [
            ['store'],
            ['store', 'book'],
            ['store', 'book', 0],
            ['store', 'book', 0, 'category'],
            ['store', 'book', 0, 'author'],
            ['store', 'book', 0, 'title'],
            ['store', 'book', 0, 'price'],
            ['store', 'book', 1],
            ['store', 'book', 1, 'category'],
            ['store', 'book', 1, 'author'],
            ['store', 'book', 1, 'title'],
            ['store', 'book', 1, 'price'],
            ['store', 'book', 2],
            ['store', 'book', 2, 'category'],
            ['store', 'book', 2, 'author'],
            ['store', 'book', 2, 'title'],
            ['store', 'book', 2, 'isbn'],
            ['store', 'book', 2, 'price'],
            ['store', 'book', 3],
            ['store', 'book', 3, 'category'],
            ['store', 'book', 3, 'author'],
            ['store', 'book', 3, 'title'],
            ['store', 'book', 3, 'isbn'],
            ['store', 'book', 3, 'price'],
            ['store', 'bicycle'],
            ['store', 'bicycle', 'color'],
            ['store', 'bicycle', 'price'],
        ] },
    ],
} ];

const jsonp = new JSONPath();
const arrayCompare = (a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b));
const formatResult = a => {
    return a.sort(arrayCompare).map(a => JSON.stringify(a)).join('\n');
};

for ( const tests of jsonpathTests ) {
    const obj = JSON.parse(tests.json);
    for ( const { q, r } of tests.queries ) {
        jsonp.compile(`v2:${q}`);
        const actual = formatResult(jsonp.evaluate(obj)?.map(a => a.slice(1)));
        const expected = formatResult(r);
        console.log(`${q}\n${expected}\n${actual}`);
        const fragment = document.querySelector('#test-result').content.cloneNode(true);
        const div = fragment.children[0];
        div.children[0].textContent = q;
        if ( expected !== '' ) {
            div.children[1].textContent = expected;
        }
        if ( actual !== expected ) {
            if ( actual !== '' ) {
                div.children[2].textContent = actual;
            }
            div.children[2].classList.add('fail');
        } else {
            div.children[2].textContent = '';
        }
        document.querySelector('main').append(fragment);
    }
}
