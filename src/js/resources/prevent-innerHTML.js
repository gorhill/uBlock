/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2025-present Raymond Hill

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

import { registerScriptlet } from './base.js';
import { safeSelf } from './safe-self.js';

/**
 * @scriptlet freeze-element-property
 * 
 * @description
 * Conditionally prevent assignment to an element property.
 * 
 * @param property
 * The name of the property to freeze.
 * 
 * @param [selector]
 * Optional. The element must match `selector` for the prevention to take
 * place.
 * 
 * @param [pattern]
 * Optional. A pattern to match against the stringified assigned value. The
 * pattern can be a plain string, or a regex. Prepend with `!` to reverse the
 * match condition.
 * 
 * */

function freezeElementProperty(
    property = '',
    selector = '',
    pattern = ''
) {
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('freeze-element-property', property, selector, pattern);
    const matcher = safe.initPattern(pattern, { canNegate: true });
    const owner = (( ) => {
        if ( Object.hasOwn(Element.prototype, property) ) {
            return Element.prototype;
        }
        if ( Object.hasOwn(HTMLElement.prototype, property) ) {
            return HTMLElement.prototype;
        }
        if ( Object.hasOwn(Node.prototype, property) ) {
            return Node.prototype;
        }
        return null;
    })();
    if ( owner === null ) { return; }
    const current = safe.Object_getOwnPropertyDescriptor(owner, property);
    if ( current === undefined ) { return; }
    const shouldPreventSet = (elem, a) => {
        if ( selector !== '' ) {
            if ( typeof elem.matches !== 'function' ) { return false; }
            if ( elem.matches(selector) === false ) { return false; }
        }
        return safe.testPattern(matcher, `${a}`);
    };
    Object.defineProperty(owner, property, {
        get: function() {
            return current.get
                ? current.get.call(this)
                : current.value;
        },
        set: function(a) {
            if ( shouldPreventSet(this, a) ) {
                safe.uboLog(logPrefix, 'Assignment prevented');
            } else if ( current.set ) {
                current.set.call(this, a);
            }
            if ( safe.logLevel > 1 ) {
                safe.uboLog(logPrefix, `Assigned:\n${a}`);
            }
            current.value = a;
        },
    });
}
registerScriptlet(freezeElementProperty, {
    name: 'freeze-element-property.js',
    dependencies: [
        safeSelf,
    ],
});

/**
 * @scriptlet prevent-innerHTML
 * 
 * @description
 * Conditionally prevent assignment to `innerHTML` property.
 * 
 * @param [selector]
 * Optional. The element must match `selector` for the prevention to take
 * place.
 * 
 * @param [pattern]
 * Optional. A pattern to match against the assigned value. The pattern can be
 * a plain string, or a regex. Prepend with `!` to reverse the match condition.
 * 
 * */

function preventInnerHTML(
    selector = '',
    pattern = ''
) {
    freezeElementProperty('innerHTML', selector, pattern);
}
registerScriptlet(preventInnerHTML, {
    name: 'prevent-innerHTML.js',
    dependencies: [
        freezeElementProperty,
    ],
});
