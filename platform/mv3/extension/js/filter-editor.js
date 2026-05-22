/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2026-present Raymond Hill

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

    Home: https://github.com/gorhill/uBlock
*/

import * as sfp from './static-filtering-parser.js';
import { dom } from './dom.js';
import { faIconsInit } from './fa-icons.js';
import { i18n } from './i18n.js';

/******************************************************************************/

const streamParser = (( ) => {
    const nodeHasError = (mode, node) => {
        return mode.astParser.getNodeFlags(
            node || mode.currentWalkerNode, sfp.NODE_FLAG_ERROR
        ) !== 0;
    };

    const colorFromAstNode = mode => {
        if ( mode.astParser.nodeIsEmptyString(mode.currentWalkerNode) ) { return '+'; }
        if ( nodeHasError(mode) ) { return 'sfp_error'; }
        const nodeType = mode.astParser.getNodeType(mode.currentWalkerNode);
        switch ( nodeType ) {
        case sfp.NODE_TYPE_WHITESPACE:
            return '';
        case sfp.NODE_TYPE_COMMENT:
            if ( mode.astWalker.canGoDown() ) { break; }
            return 'sfp_comment';
        case sfp.NODE_TYPE_COMMENT_URL:
            return 'sfp_comment sfp_link';
        case sfp.NODE_TYPE_IGNORE:
            return 'sfp_comment';
        case sfp.NODE_TYPE_PREPARSE_DIRECTIVE:
        case sfp.NODE_TYPE_PREPARSE_DIRECTIVE_VALUE:
            return 'sfp_directive';
        case sfp.NODE_TYPE_PREPARSE_DIRECTIVE_IF_VALUE: {
            return 'sfp_def sfp_strong';
        }
        case sfp.NODE_TYPE_EXT_OPTIONS_ANCHOR:
            return mode.astParser.getFlags(sfp.AST_FLAG_IS_EXCEPTION)
                ? 'sfp_tag sfp_strong'
                : 'sfp_def sfp_strong';
        case sfp.NODE_TYPE_EXT_DECORATION:
            return 'sfp_def';
        case sfp.NODE_TYPE_EXT_PATTERN_RAW:
            if ( mode.astWalker.canGoDown() ) { break; }
            return 'sfp_variable';
        case sfp.NODE_TYPE_EXT_PATTERN_COSMETIC:
        case sfp.NODE_TYPE_EXT_PATTERN_HTML:
            return 'sfp_variable';
        case sfp.NODE_TYPE_EXT_PATTERN_RESPONSEHEADER:
        case sfp.NODE_TYPE_EXT_PATTERN_SCRIPTLET:
            if ( mode.astWalker.canGoDown() ) { break; }
            return 'sfp_variable';
        case sfp.NODE_TYPE_EXT_PATTERN_SCRIPTLET_TOKEN: {
            return 'sfp_variable';
        }
        case sfp.NODE_TYPE_EXT_PATTERN_SCRIPTLET_ARG:
            return 'sfp_variable';
        case sfp.NODE_TYPE_NET_EXCEPTION:
            return 'sfp_tag sfp_strong';
        case sfp.NODE_TYPE_NET_PATTERN:
            if ( mode.astWalker.canGoDown() ) { break; }
            if ( mode.astParser.isRegexPattern() ) {
                return 'sfp_variable sfp_notice';
            }
            return 'sfp_variable';
        case sfp.NODE_TYPE_NET_PATTERN_PART:
            return 'sfp_variable';
        case sfp.NODE_TYPE_NET_PATTERN_PART_SPECIAL:
            return 'sfp_keyword sfp_strong';
        case sfp.NODE_TYPE_NET_PATTERN_PART_UNICODE:
            return 'sfp_variable sfp_unicode';
        case sfp.NODE_TYPE_NET_PATTERN_LEFT_HNANCHOR:
        case sfp.NODE_TYPE_NET_PATTERN_LEFT_ANCHOR:
        case sfp.NODE_TYPE_NET_PATTERN_RIGHT_ANCHOR:
        case sfp.NODE_TYPE_NET_OPTION_NAME_NOT:
            return 'sfp_keyword sfp_strong';
        case sfp.NODE_TYPE_NET_OPTIONS_ANCHOR:
        case sfp.NODE_TYPE_NET_OPTION_SEPARATOR:
            mode.lastNetOptionType = 0;
            return 'sfp_def sfp_strong';
        case sfp.NODE_TYPE_NET_OPTION_NAME_UNKNOWN:
            mode.lastNetOptionType = 0;
            return 'sfp_error';
        case sfp.NODE_TYPE_NET_OPTION_NAME_1P:
        case sfp.NODE_TYPE_NET_OPTION_NAME_STRICT1P:
        case sfp.NODE_TYPE_NET_OPTION_NAME_3P:
        case sfp.NODE_TYPE_NET_OPTION_NAME_STRICT3P:
        case sfp.NODE_TYPE_NET_OPTION_NAME_ALL:
        case sfp.NODE_TYPE_NET_OPTION_NAME_BADFILTER:
        case sfp.NODE_TYPE_NET_OPTION_NAME_CNAME:
        case sfp.NODE_TYPE_NET_OPTION_NAME_CSP:
        case sfp.NODE_TYPE_NET_OPTION_NAME_CSS:
        case sfp.NODE_TYPE_NET_OPTION_NAME_DENYALLOW:
        case sfp.NODE_TYPE_NET_OPTION_NAME_DOC:
        case sfp.NODE_TYPE_NET_OPTION_NAME_EHIDE:
        case sfp.NODE_TYPE_NET_OPTION_NAME_EMPTY:
        case sfp.NODE_TYPE_NET_OPTION_NAME_FONT:
        case sfp.NODE_TYPE_NET_OPTION_NAME_FRAME:
        case sfp.NODE_TYPE_NET_OPTION_NAME_FROM:
        case sfp.NODE_TYPE_NET_OPTION_NAME_GENERICBLOCK:
        case sfp.NODE_TYPE_NET_OPTION_NAME_GHIDE:
        case sfp.NODE_TYPE_NET_OPTION_NAME_IMAGE:
        case sfp.NODE_TYPE_NET_OPTION_NAME_IMPORTANT:
        case sfp.NODE_TYPE_NET_OPTION_NAME_INLINEFONT:
        case sfp.NODE_TYPE_NET_OPTION_NAME_INLINESCRIPT:
        case sfp.NODE_TYPE_NET_OPTION_NAME_MATCHCASE:
        case sfp.NODE_TYPE_NET_OPTION_NAME_MEDIA:
        case sfp.NODE_TYPE_NET_OPTION_NAME_METHOD:
        case sfp.NODE_TYPE_NET_OPTION_NAME_MP4:
        case sfp.NODE_TYPE_NET_OPTION_NAME_NOOP:
        case sfp.NODE_TYPE_NET_OPTION_NAME_OBJECT:
        case sfp.NODE_TYPE_NET_OPTION_NAME_OTHER:
        case sfp.NODE_TYPE_NET_OPTION_NAME_PING:
        case sfp.NODE_TYPE_NET_OPTION_NAME_POPUNDER:
        case sfp.NODE_TYPE_NET_OPTION_NAME_POPUP:
        case sfp.NODE_TYPE_NET_OPTION_NAME_REDIRECT:
        case sfp.NODE_TYPE_NET_OPTION_NAME_REDIRECTRULE:
        case sfp.NODE_TYPE_NET_OPTION_NAME_REMOVEPARAM:
        case sfp.NODE_TYPE_NET_OPTION_NAME_RESPONSEHEADER:
        case sfp.NODE_TYPE_NET_OPTION_NAME_REQUESTHEADER:
        case sfp.NODE_TYPE_NET_OPTION_NAME_SCRIPT:
        case sfp.NODE_TYPE_NET_OPTION_NAME_SHIDE:
        case sfp.NODE_TYPE_NET_OPTION_NAME_TO:
        case sfp.NODE_TYPE_NET_OPTION_NAME_TOP:
        case sfp.NODE_TYPE_NET_OPTION_NAME_URLTRANSFORM:
        case sfp.NODE_TYPE_NET_OPTION_NAME_XHR:
        case sfp.NODE_TYPE_NET_OPTION_NAME_WEBRTC:
        case sfp.NODE_TYPE_NET_OPTION_NAME_WEBSOCKET:
            mode.lastNetOptionType = nodeType;
            return 'sfp_def';
        case sfp.NODE_TYPE_NET_OPTION_ASSIGN:
        case sfp.NODE_TYPE_NET_OPTION_QUOTE:
            return 'sfp_def';
        case sfp.NODE_TYPE_NET_OPTION_VALUE:
            if ( mode.astWalker.canGoDown() ) { break; }
            switch ( mode.lastNetOptionType ) {
            case sfp.NODE_TYPE_NET_OPTION_NAME_REDIRECT:
            case sfp.NODE_TYPE_NET_OPTION_NAME_REDIRECTRULE:
                return 'sfp_value';
            default:
                break;
            }
            return 'sfp_value';
        case sfp.NODE_TYPE_OPTION_VALUE_NOT:
            return 'sfp_keyword sfp_strong';
        case sfp.NODE_TYPE_OPTION_VALUE_DOMAIN:
            return 'sfp_value';
        case sfp.NODE_TYPE_OPTION_VALUE_SEPARATOR:
            return 'sfp_def';
        default:
            break;
        }
        return '+';
    };

    class ModeState {
        constructor() {
            this.astParser = new sfp.AstFilterParser({
                interactive: true,
                localSource: true,
                nativeCssHas: true,
                trustedSource: true,
            });
            this.astWalker = this.astParser.getWalker();
            this.currentWalkerNode = 0;
            this.lastNetOptionType = 0;
        }
    }

    return {
        languageData: {
            commentTokens: { line: '!' },
        },
        tokenTable: [
            'sfp_comment',
            'sfp_def',
            'sfp_directive',
            'sfp_error',
            'sfp_ext-dom',
            'sfp_ext-html',
            'sfp_ext-js',
            'sfp_keyword',
            'sfp_link',
            'sfp_net',
            'sfp_notice',
            'sfp_strong',
            'sfp_tag',
            'sfp_unicode',
            'sfp_value',
            'sfp_variable',
        ],
        startState() {
            return new ModeState();
        },
        copyState(other) {
            return other;
        },
        token(stream, state) {
            if ( stream.sol() ) {
                state.astParser.parse(stream.string);
                if ( state.astParser.getFlags(sfp.AST_FLAG_UNSUPPORTED) !== 0 ) {
                    stream.skipToEnd();
                    return 'sfp_error';
                }
                if ( state.astParser.getType() === sfp.AST_TYPE_NONE ) {
                    stream.skipToEnd();
                    return 'sfp_comment';
                }
                state.currentWalkerNode = state.astWalker.reset();
            } else if ( nodeHasError(state) ) {
                state.currentWalkerNode = state.astWalker.right();
            } else {
                state.currentWalkerNode = state.astWalker.next();
            }
            let style = '';
            while ( state.currentWalkerNode !== 0 ) {
                style = colorFromAstNode(state, stream);
                if ( style !== '+' ) { break; }
                state.currentWalkerNode = state.astWalker.next();
            }
            if ( style === '+' ) {
                stream.skipToEnd();
                return null;
            }
            stream.pos = state.astParser.getNodeStringEnd(state.currentWalkerNode);
            if ( state.astParser.isNetworkFilter() ) {
                return style ? `sfp_net ${style}` : 'sfp_net';
            }
            if ( state.astParser.isExtendedFilter() ) {
                let flavor = '';
                if ( state.astParser.isCosmeticFilter() ) {
                    flavor = 'sfp_ext-dom';
                } else if ( state.astParser.isScriptletFilter() ) {
                    flavor = 'sfp_ext-js';
                } else if ( state.astParser.isHtmlFilter() ) {
                    flavor = 'sfp_ext-html';
                }
                if ( flavor !== '' ) {
                    style = `${flavor} ${style}`;
                }
            }
            style = style.trim();
            return style !== '' ? style : null;
        },
    };
})();

/******************************************************************************/

export class FilterEditor {
    constructor(parent, text = '') {
        this.ioPanel = self.cm6.createViewPanel();
        const viewConfig = {
            text,
            oneDark: dom.cl.has(':root', 'dark'),
            lineWrapping: true,
            updateListener: info => { this.updateListener(info); },
            saveListener: ( ) => { this.saveContent(); },
            lineError: true,
            spanError: true,
            streamParser,
            panels: [ this.ioPanel ],
        };
        this.view = self.cm6.createEditorView(viewConfig, parent);
        this.lastSavedText = text;
        self.cm6.resetUndoRedo(this.view);
        this.updateIOPanel();
    }

    getContent() {
        return this.normalizeContent(this.view.state.doc.toString());
    }

    setContent(text, saved = false) {
        text = this.normalizeContent(text);
        if ( saved ) {
            this.lastSavedText = text;
        }
        this.view.dispatch({
            changes: {
                from: 0, to: this.view.state.doc.length,
                insert: text,
            },
        });
        this.view.focus();
    }

    normalizeContent(text) {
        text ||= '';
        text = text.trim();
        if ( text !== '' ) { text += '\n'; }
        return text;
    }

    contentChanged() {
        const text = this.normalizeContent(this.getContent());
        return text !== this.lastSavedText;
    }

    async loadContent(text) {
        this.setContent(text, true);
        self.cm6.resetUndoRedo(this.view);
        this.updateView();
    }

    async saveContent() {
        this.lastSavedText = this.getContent();
        this.updateView();
    }

    revertContent() {
        if ( this.contentChanged() === false ) { return; }
        this.setContent(this.lastSavedText);
    }

    updateListener(info) {
        if ( info.docChanged === false ) { return; }
        this.updateView();
    }


    updateView() {
        const changed = this.contentChanged();
        dom.attr('#apply', 'disabled', changed ? null : '');
        dom.attr('#revert', 'disabled', changed ? null : '');
    }

    updateIOPanel() {
        const ioButtons = [ 'apply', 'revert' ];
        const template = document.querySelector('template.io-panel');
        const fragment = template.content.cloneNode(true);
        const root = fragment.querySelector('.io-panel');
        i18n.render(root);
        faIconsInit(root);
        root.dataset.io = ioButtons.join(' ');
        const config = {
            dom: root,
            mount: ( ) => {
                dom.on('#apply', 'click', ( ) => {
                    this.saveContent();
                });
                dom.on('#revert', 'click', ( ) => {
                    this.revertContent();
                });
            },
        };
        this.ioPanel.render(this.view, config);
    }
}
