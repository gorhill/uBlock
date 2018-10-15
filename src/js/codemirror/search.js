// The following code is heavily based on the standard CodeMirror
// search addon found at: https://codemirror.net/addon/search/search.js
// I added/removed and modified code in order to get a closer match to a
// browser's built-in find-in-page feature which are just enough for
// uBlock Origin.


// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

// Define search commands. Depends on dialog.js or another
// implementation of the openDialog method.

// Replace works a little oddly -- it will do the replace on the next
// Ctrl-G (or whatever is bound to findNext) press. You prevent a
// replace by making sure the match is no longer selected when hitting
// Ctrl-G.

/* globals define, require, CodeMirror */

'use strict';

(function(mod) {
  if (typeof exports === "object" && typeof module === "object") // CommonJS
    mod(require("../../lib/codemirror"), require("./searchcursor"), require("../dialog/dialog"));
  else if (typeof define === "function" && define.amd) // AMD
    define(["../../lib/codemirror", "./searchcursor", "../dialog/dialog"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {

    function searchOverlay(query, caseInsensitive) {
        if (typeof query === "string")
            query = new RegExp(query.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), caseInsensitive ? "gi" : "g");
        else if (!query.global)
            query = new RegExp(query.source, query.ignoreCase ? "gi" : "g");

        return {
            token: function(stream) {
                query.lastIndex = stream.pos;
                var match = query.exec(stream.string);
                if (match && match.index === stream.pos) {
                    stream.pos += match[0].length || 1;
                    return "searching";
                } else if (match) {
                    stream.pos = match.index;
                } else {
                    stream.skipToEnd();
                }
            }
        };
    }

    var searchWidgetHtml =
        '<div class="cm-search-widget">' +
            '<span class="fa">&#xf002;</span>&ensp;' +
            '<span class="cm-search-widget-input">' +
                '<input type="text">' +
                '<span class="cm-search-widget-count">' +
                    '<span><!-- future use --></span><span>0</span>' +
                '</span>' +
            '</span>&ensp;' +
            '<span class="cm-search-widget-up cm-search-widget-button fa">&#xf077;</span>&ensp;' +
            '<span class="cm-search-widget-down cm-search-widget-button fa">&#xf078;</span>&ensp;' +
        '</div>';

    function searchWidgetKeydownHandler(cm, ev) {
        var keyName = CodeMirror.keyName(ev);
        if ( !keyName ) { return; }
        CodeMirror.lookupKey(
            keyName,
            cm.getOption('keyMap'),
            function(command) {
                if ( widgetCommandHandler(cm, command) ) {
                    ev.preventDefault();
                    ev.stopPropagation();
                }
            }
        );
    }

    function searchWidgetInputHandler(cm) {
        let state = getSearchState(cm);
        if ( queryTextFromSearchWidget(cm) === state.queryText ) { return; }
        if ( state.queryTimer !== null ) {
            clearTimeout(state.queryTimer);
        }
        state.queryTimer = setTimeout(
            () => {
                state.queryTimer = null;
                findCommit(cm, 0);
            },
            350
        );
    }

    function searchWidgetClickHandler(cm, ev) {
        var tcl = ev.target.classList;
        if ( tcl.contains('cm-search-widget-up') ) {
            findNext(cm, -1);
        } else if ( tcl.contains('cm-search-widget-down') ) {
            findNext(cm, 1);
        }
        if ( ev.target.localName !== 'input' ) {
            ev.preventDefault();
        } else {
            ev.stopImmediatePropagation();
        }
    }

    function queryTextFromSearchWidget(cm) {
        return getSearchState(cm).widget.querySelector('input[type="text"]').value;
    }

    function queryTextToSearchWidget(cm, q) {
        var input = getSearchState(cm).widget.querySelector('input[type="text"]');
        if ( typeof q === 'string' && q !== input.value ) {
            input.value = q;
        }
        input.setSelectionRange(0, input.value.length);
        input.focus();
    }

    function SearchState(cm) {
        this.query = null;
        this.overlay = null;
        this.panel = null;
        this.widget = null;
        var domParser = new DOMParser();
        var doc = domParser.parseFromString(searchWidgetHtml, 'text/html');
        this.widget = document.adoptNode(doc.body.firstElementChild);
        this.widget.addEventListener('keydown', searchWidgetKeydownHandler.bind(null, cm));
        this.widget.addEventListener('input', searchWidgetInputHandler.bind(null, cm));
        this.widget.addEventListener('mousedown', searchWidgetClickHandler.bind(null, cm));
        if ( typeof cm.addPanel === 'function' ) {
            this.panel = cm.addPanel(this.widget);
        }
        this.queryText = '';
        this.queryTimer = null;
    }

    // We want the search widget to behave as if the focus was on the
    // CodeMirror editor.

    var reSearchCommands = /^(?:find|findNext|findPrev|newlineAndIndent)$/;

    function widgetCommandHandler(cm, command) {
        if ( reSearchCommands.test(command) === false ) { return false; }
        var queryText = queryTextFromSearchWidget(cm);
        if ( command === 'find' ) {
            queryTextToSearchWidget(cm);
            return true;
        }
        if ( queryText.length !== 0 ) {
            findNext(cm, command === 'findPrev' ? -1 : 1);
        }
        return true;
    }

    function getSearchState(cm) {
        return cm.state.search || (cm.state.search = new SearchState(cm));
    }

    function queryCaseInsensitive(query) {
        return typeof query === "string" && query === query.toLowerCase();
    }

    function getSearchCursor(cm, query, pos) {
        // Heuristic: if the query string is all lowercase, do a case insensitive search.
        return cm.getSearchCursor(
            query,
            pos,
            {caseFold: queryCaseInsensitive(query), multiline: true}
        );
    }

    function parseString(string) {
        return string.replace(/\\(.)/g, function(_, ch) {
            if (ch === "n") return "\n";
            if (ch === "r") return "\r";
            return ch;
        });
    }

    function parseQuery(query) {
        var isRE = query.match(/^\/(.*)\/([a-z]*)$/);
        if (isRE) {
            try { query = new RegExp(isRE[1], isRE[2].indexOf("i") === -1 ? "" : "i"); }
            catch(e) {} // Not a regular expression after all, do a string search
        } else {
            query = parseString(query);
        }
        if (typeof query === "string" ? query === "" : query.test(""))
            query = /x^/;
        return query;
    }

    function startSearch(cm, state) {
        state.query = parseQuery(state.queryText);
        if ( state.overlay ) {
            cm.removeOverlay(state.overlay, queryCaseInsensitive(state.query));
        }
        state.overlay = searchOverlay(state.query, queryCaseInsensitive(state.query));
        cm.addOverlay(state.overlay);
        if ( cm.showMatchesOnScrollbar ) {
            if ( state.annotate ) {
                state.annotate.clear();
                state.annotate = null;
            }
            state.annotate = cm.showMatchesOnScrollbar(
                state.query,
                queryCaseInsensitive(state.query)
            );
            let count = state.annotate.matches.length;
            state.widget
                 .querySelector('.cm-search-widget-count > span:nth-of-type(2)')
                 .textContent = count > 1000 ? '1000+' : count;
            state.widget.setAttribute('data-query', state.queryText);
            // Ensure the caret is visible
            let input = state.widget.querySelector('.cm-search-widget-input > input');
            input.selectionStart = input.selectionStart;
        }
    }

    function findNext(cm, dir, callback) {
        cm.operation(function() {
            var state = getSearchState(cm);
            if ( !state.query ) { return; }
            var cursor = getSearchCursor(
                cm,
                state.query,
                dir <= 0 ? cm.getCursor('from') : cm.getCursor('to')
            );
            let previous = dir < 0;
            if (!cursor.find(previous)) {
                cursor = getSearchCursor(
                    cm,
                    state.query,
                    previous ? CodeMirror.Pos(cm.lastLine()) : CodeMirror.Pos(cm.firstLine(), 0)
                );
                if (!cursor.find(previous)) return;
            }
            cm.setSelection(cursor.from(), cursor.to());
            cm.scrollIntoView({from: cursor.from(), to: cursor.to()}, 20);
            if (callback) callback(cursor.from(), cursor.to());
        });
    }

    function clearSearch(cm, hard) {
        cm.operation(function() {
            var state = getSearchState(cm);
            if ( state.query ) {
                state.query = state.queryText = null;
            }
            if ( state.overlay ) {
                cm.removeOverlay(state.overlay);
                state.overlay = null;
            }
            if ( state.annotate ) {
                state.annotate.clear();
                state.annotate = null;
            }
            state.widget.removeAttribute('data-query');
            if ( hard ) {
                state.panel.clear();
                state.panel = null;
                state.widget = null;
                cm.state.search = null;
            }
        });
    }

    function findCommit(cm, dir) {
        var state = getSearchState(cm);
        if ( state.queryTimer !== null ) {
            clearTimeout(state.queryTimer);
            state.queryTimer = null;
        }
        var queryText = queryTextFromSearchWidget(cm);
        if ( queryText === state.queryText ) { return; }
        state.queryText = queryText;
        if ( state.queryText === '' ) {
            clearSearch(cm);
        } else {
            cm.operation(function() {
                startSearch(cm, state);
                findNext(cm, dir);
            });
        }
    }

    function findCommand(cm) {
        var queryText = cm.getSelection() || undefined;
        if ( !queryText ) {
            var word = cm.findWordAt(cm.getCursor());
            queryText = cm.getRange(word.anchor, word.head);
            if ( /^\W|\W$/.test(queryText) ) {
                queryText = undefined;
            }
            cm.setCursor(word.anchor);
        }
        queryTextToSearchWidget(cm, queryText);
        findCommit(cm, 1);
    }

    function findNextCommand(cm) {
        var state = getSearchState(cm);
        if ( state.query ) { return findNext(cm, 1); }
    }

    function findPrevCommand(cm) {
        var state = getSearchState(cm);
        if ( state.query ) { return findNext(cm, -1); }
    }

    CodeMirror.commands.find = findCommand;
    CodeMirror.commands.findNext = findNextCommand;
    CodeMirror.commands.findPrev = findPrevCommand;

    CodeMirror.defineInitHook(function(cm) {
        getSearchState(cm);
    });
});
