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

/**
 * Implement the parsing of uBO-flavored JSON path syntax
 * 
 * Reference to original JSON path syntax:
 * https://goessner.net/articles/JsonPath/index.html
 * 
 * uBO-flavored JSON path implementation differs as follow:
 * 
 * - Both $ and @ are implicit. Though you can use them, you do not have to.
 *   Use $ only when the implicit context is not that of root. Example:
 *   -     Official: $..book[?(@.isbn)]
 *   - uBO-flavored: ..book[?(.isbn)]
 * 
 * - uBO-flavor syntax do not (yet) support:
 *   - Union (,) operator.
 *   - Array slice operator
 * 
 * - Regarding filter expressions, uBO-flavored JSON path supports a limited
 *   set of expressions since unlike the official implementation, uBO can't use
 *   JS eval() to evaluate arbitrary JS expressions. The operand MUST be valid
 *   JSON. The currently supported expressions are:
 *   - ==: strict equality
 *   - !=: strict inequality
 *   -  <: less than
 *   - <=: less than or equal to
 *   -  >: greater than
 *   - >=: greater than or equal to
 *   - ^=: stringified value starts with 
 *   - $=: stringified value ends with
 *   - *=: stringified value includes
 * 
 * - Examples (from "JSONPath examples" at reference link)
 *   - .store.book[*].author
 *   - ..author
 *   - .store.*
 *   - .store..price
 *   - ..book[2]
 *   - ..book[?(.isbn)]
 *   - ..book[?(.price<10)]
 *   - ..*
 * 
 * uBO-flavored syntax supports assigning a value to a resolved JSON path by
 * appending `=[value]` to the JSON path. The assigned value MUST be valid JSON.
 * Examples:
 * - .store..price=0
 * - .store.book[*].author="redacted"
 *
 * A JSONPath instance can be use to compile a JSON path query, and the result
 * of the compilation can be applied to different objects. When a JSON path
 * query does not assign a value, the resolved property will be removed.
 * 
 * More capabilities can be added in the future as needed.
 * 
 * */

export class JSONPath {
    static create(query) {
        const jsonp = new JSONPath();
        jsonp.compile(query);
        return jsonp;
    }
    static toJSON(obj, stringifier, ...args) {
        return (stringifier || JSON.stringify)(obj, ...args)
            .replace(/\//g, '\\/');
    }
    get value() {
        return this.#compiled && this.#compiled.rval;
    }
    set value(v) {
        if ( this.#compiled === undefined ) { return; }
        this.#compiled.rval = v;
    }
    get valid() {
        return this.#compiled !== undefined;
    }
    compile(query) {
        const r = this.#compile(query, 0);
        if ( r === undefined ) { return; }
        if ( r.i !== query.length ) {
            if ( query.startsWith('=', r.i) === false ) { return; }
            try { r.rval = JSON.parse(query.slice(r.i+1)); }
            catch { return; }
        }
        this.#compiled = r;
    }
    evaluate(root) {
        if ( this.valid === false ) { return []; }
        this.#root = root;
        const paths = this.#evaluate(this.#compiled.steps, []);
        this.#root = null;
        return paths;
    }
    apply(root) {
        if ( this.valid === false ) { return 0; }
        const { rval } = this.#compiled;
        this.#root = root;
        const paths = this.#evaluate(this.#compiled.steps, []);
        const n = paths.length;
        let i = n;
        while ( i-- ) {
            const { obj, key } = this.#resolvePath(paths[i]);
            if ( rval !== undefined ) {
                obj[key] = rval;
            } else if ( Array.isArray(obj) && typeof key === 'number' ) {
                obj.splice(key, 1);
            } else {
                delete obj[key];
            }
        }
        this.#root = null;
        return n;
    }
    toJSON(obj, ...args) {
        return JSONPath.toJSON(obj, null, ...args)
    }
    get [Symbol.toStringTag]() {
        return 'JSONPath';
    }
    #UNDEFINED = 0;
    #ROOT = 1;
    #CURRENT = 2;
    #CHILDREN = 3;
    #DESCENDANTS = 4;
    #reUnquotedIdentifier = /^[A-Za-z_][\w]*|^\*/;
    #reExpr = /^([!=^$*]=|[<>]=?)(.+?)\)\]/;
    #reIndice = /^\[-?\d+\]/;
    #root;
    #compiled;
    #compile(query, i) {
        if ( query.length === 0 ) { return; }
        const steps = [];
        let c = query.charCodeAt(i);
        steps.push({ mv: c === 0x24 /* $ */ ? this.#ROOT : this.#CURRENT });
        if ( c === 0x24 /* $ */ || c === 0x40 /* @ */ ) { i += 1; }
        let mv = this.#UNDEFINED;
        for (;;) {
            if ( i === query.length ) { break; }
            c = query.charCodeAt(i);
            if ( c === 0x20 /* whitespace */ ) {
                i += 1;
                continue;
            }
            // Dot accessor syntax
            if ( c === 0x2E /* . */ ) {
                if ( mv !== this.#UNDEFINED ) { return; }
                if ( query.startsWith('..', i) ) {
                    mv = this.#DESCENDANTS;
                    i += 2;
                } else {
                    mv = this.#CHILDREN;
                    i += 1;
                }
                continue;
            }
            if ( c !== 0x5B /* [ */ ) {
                if ( mv === this.#UNDEFINED ) {
                    const step = steps.at(-1);
                    if ( step === undefined ) { return; }
                    i = this.#compileExpr(query, step, i);
                    break;
                }
                const s = this.#consumeUnquotedIdentifier(query, i);
                if  ( s === undefined ) { return; }
                steps.push({ mv, k: s });
                i += s.length;
                mv = this.#UNDEFINED;
                continue;
            }
            // Bracket accessor syntax
            if ( query.startsWith('[*]', i) ) {
                mv ||= this.#CHILDREN;
                steps.push({ mv, k: '*' });
                i += 3;
                mv = this.#UNDEFINED;
                continue;
            }
            if ( query.startsWith("['", i) ) {
                const r = this.#consumeQuotedIdentifier(query, i+2);
                if ( r === undefined ) { return; }
                mv ||= this.#CHILDREN;
                steps.push({ mv, k: r.s });
                i = r.i;
                mv = this.#UNDEFINED;
                continue;
            }
            if ( query.startsWith('[?(', i) ) {
                const not = query.charCodeAt(i+3) === 0x21 /* ! */;
                const j = i + 3 + (not ? 1 : 0);
                const r = this.#compile(query, j);
                if ( r === undefined ) { return; }
                if ( query.startsWith(')]', r.i) === false ) { return; }
                if ( not ) { r.steps.at(-1).not = true; }
                steps.push({ mv: mv || this.#CHILDREN, steps: r.steps });
                i = r.i + 2;
                mv = this.#UNDEFINED;
                continue;
            }
            if ( this.#reIndice.test(query.slice(i)) ) {
                const match = this.#reIndice.exec(query.slice(i));
                const indice = parseInt(query.slice(i+1), 10);
                mv ||= this.CHILDREN;
                steps.push({ mv, k: indice });
                i += match[0].length;
                mv = this.#UNDEFINED;
                continue;
            }
            return;
        }
        if ( steps.length <= 1 ) { return; }
        return { steps, i };
    }
    #evaluate(steps, pathin) {
        let resultset = [];
        if ( Array.isArray(steps) === false ) { return resultset; }
        for ( const step of steps ) {
            switch ( step.mv ) {
            case this.#ROOT:
                resultset = [ [] ];
                break;
            case this.#CURRENT:
                resultset = [ pathin ];
                break;
            case this.#CHILDREN:
            case this.#DESCENDANTS:
                resultset = this.#getMatches(resultset, step);
                break;
            default:
                break;
            }
        }
        return resultset;
    }
    #getMatches(listin, step) {
        const listout = [];
        const recursive = step.mv === this.#DESCENDANTS;
        for ( const pathin of listin ) {
            const { value: v } = this.#resolvePath(pathin);
            if ( v === null ) { continue; }
            if ( v === undefined ) { continue; }
            const { steps, k } = step;
            if ( k ) {
                if ( k === '*' ) {
                    const entries = Array.from(this.#getDescendants(v, recursive));
                    for ( const { path } of entries ) {
                        this.#evaluateExpr(step, [ ...pathin, ...path ], listout);
                    }
                    continue;
                }
                if ( typeof k === 'number' ) {
                    if ( Array.isArray(v) === false ) { continue; }
                    const n = v.length;
                    const i = k >= 0 ? k : n + k;
                    if ( i < 0 ) { continue; }
                    if ( i >= n ) { continue; }
                    this.#evaluateExpr(step, [ ...pathin, i ], listout);
                } else if ( Array.isArray(k) ) {
                    for ( const l of k ) {
                        this.#evaluateExpr(step, [ ...pathin, l ], listout);
                    }
                } else {
                    this.#evaluateExpr(step, [ ...pathin, k ], listout);
                }
                if ( recursive !== true ) { continue; }
                for ( const { obj, key, path } of this.#getDescendants(v, recursive) ) {
                    const w = obj[key];
                    if ( w instanceof Object === false ) { continue; }
                    if ( Object.hasOwn(w, k) === false ) { continue; }
                    this.#evaluateExpr(step, [ ...pathin, ...path, k ], listout);
                }
                continue;
            }
            if ( steps ) {
                const isArray = Array.isArray(v);
                if ( isArray === false ) {
                    const r = this.#evaluate(steps, pathin);
                    if ( r.length !== 0 ) {
                        listout.push(pathin);
                    }
                    if ( recursive !== true ) { continue; }
                }
                for ( const { obj, key, path } of this.#getDescendants(v, recursive) ) {
                    const w = obj[key];
                    if ( Array.isArray(w) ) { continue; }
                    const x = [ ...pathin, ...path ];
                    const r = this.#evaluate(steps, x);
                    if ( r.length !== 0 ) {
                        listout.push(x);
                    }
                }
            }
        }
        return listout;
    }
    #getDescendants(v, recursive) {
        const iterator = {
            next() {
                const n = this.stack.length;
                if ( n === 0 ) {
                    this.value = undefined;
                    this.done = true;
                    return this;
                }
                const details = this.stack[n-1];
                const entry = details.keys.next();
                if ( entry.done ) {
                    this.stack.pop();
                    this.path.pop();
                    return this.next();
                }
                this.path[n-1] = entry.value;
                this.value = {
                    obj: details.obj,
                    key: entry.value,
                    path: this.path.slice(),
                };
                const v = this.value.obj[this.value.key];
                if ( recursive ) {
                    if ( Array.isArray(v) ) {
                        this.stack.push({ obj: v, keys: v.keys() });
                    } else if ( typeof v === 'object' && v !== null ) {
                        this.stack.push({ obj: v, keys: Object.keys(v).values() });
                    }
                }
                return this;
            },
            path: [],
            value: undefined,
            done: false,
            stack: [],
            [Symbol.iterator]() { return this; },
        };
        if ( Array.isArray(v) ) {
            iterator.stack.push({ obj: v, keys: v.keys() });
        } else if ( typeof v === 'object' && v !== null ) {
            iterator.stack.push({ obj: v, keys: Object.keys(v).values() });
        }
        return iterator;
    }
    #consumeQuotedIdentifier(query, i) {
        const len = query.length;
        const parts = [];
        let beg = i, end = i;
        for (;;) {
            if ( end === len ) { return; }
            const c = query.charCodeAt(end);
            if ( c === 0x27 /* ' */ ) {
                if ( query.startsWith("']", end) === false ) { return; }
                parts.push(query.slice(beg, end));
                end += 2;
                break;
            }
            if ( c === 0x5C /* \ */ && (end+1) < len ) {
                parts.push(query.slice(beg, end));
                const d = query.chatCodeAt(end+1);
                if ( d === 0x27 || d === 0x5C ) {
                    end += 1;
                    beg = end;
                }
            }
            end += 1;
        }
        return { s: parts.join(''), i: end };
    }
    #consumeUnquotedIdentifier(query, i) {
        const match = this.#reUnquotedIdentifier.exec(query.slice(i));
        if ( match === null ) { return; }
        return match[0];
    }
    #compileExpr(query, step, i) {
        const match = this.#reExpr.exec(query.slice(i));
        if ( match === null ) { return i; }
        try {
            step.rval = JSON.parse(match[2]);
            step.op = match[1];
        } catch {
        }
        return i + match[1].length + match[2].length;
    }
    #resolvePath(path) {
        if ( path.length === 0 ) { return { value: this.#root }; }
        const key = path.at(-1);
        let obj = this.#root
        for ( let i = 0, n = path.length-1; i < n; i++ ) {
            obj = obj[path[i]];
        }
        return { obj, key, value: obj[key] };
    }
    #evaluateExpr(step, path, out) {
        const { obj: o, key: k } = this.#resolvePath(path);
        const hasOwn = o instanceof Object && Object.hasOwn(o, k);
        const v = o[k];
        let outcome = true;
        if ( step.op !== undefined && hasOwn === false ) { return; }
        switch ( step.op ) {
        case '==': outcome = v === step.rval; break;
        case '!=': outcome = v !== step.rval; break;
        case '<': outcome = v < step.rval; break;
        case '<=': outcome = v <= step.rval; break;
        case '>': outcome = v > step.rval; break;
        case '>=': outcome = v >= step.rval; break;
        case '^=': outcome = `${v}`.startsWith(step.rval); break;
        case '$=': outcome = `${v}`.endsWith(step.rval); break;
        case '*=': outcome = `${v}`.includes(step.rval); break;
        default: outcome = hasOwn; break;
        }
        if ( outcome === (step.not === true) ) { return; }
        out.push(path);
    }
}
