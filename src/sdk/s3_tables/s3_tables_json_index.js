/* Copyright (C) 2026 NooBaa */
'use strict';

/**
 * A strict, allocation-free pass over the bytes of a JSON document (design §8.1).
 *
 * It answers one question - where does each top-level field, and each element of a
 * large array, start and end - and builds no object graph while doing so. That is the
 * whole point: the heap a `JSON.parse` needs follows the number of JSON values in its
 * input rather than the bytes, so a document that is never parsed costs the worker
 * heap nothing, whatever is in it.
 *
 * **It is the only reader of the bytes the writer copies**, so it accepts exactly what
 * `JSON.parse` accepts and nothing else. A range this module calls a value is later
 * copied into the next `metadata.json` without anything else looking at it; an indexer
 * more lenient than the parser would write a document no client can load. The grammar
 * is RFC 8259 as V8 implements it: four whitespace bytes, no control characters inside
 * a string, the eight escapes plus `\uXXXX`, no leading zero, no trailing comma.
 *
 * It does *not* check that the input is UTF-8 - the caller does that once, natively,
 * with `buffer.isUtf8`.
 *
 * Requires nothing, like every module the worker loads (§8.1).
 */

const QUOTE = 0x22;
const BSLASH = 0x5c;
const LBRACE = 0x7b;
const RBRACE = 0x7d;
const LBRACK = 0x5b;
const RBRACK = 0x5d;
const COMMA = 0x2c;
const COLON = 0x3a;
const MINUS = 0x2d;
const ZERO = 0x30;
const NINE = 0x39;

const IN_OBJECT = 1;
const IN_ARRAY = 2;

/**
 * Nesting the indexer follows before it refuses. `JSON.parse` itself has no limit, but
 * `JSON.stringify` recurses, so a document nested deeper than a few thousand levels is
 * one the catalog could read and never write. Real table metadata is under twenty deep.
 */
const MAX_DEPTH = 512;

/**
 * Thrown for anything `JSON.parse` would reject (`kind` 'syntax') and for a document
 * past a structural limit (`kind` 'limit'). The caller decides which semantic error
 * each becomes; this module knows nothing about them.
 */
class JsonIndexError extends Error {
    /**
     * @param {'syntax'|'limit'} kind
     * @param {string} message
     */
    constructor(kind, message) {
        super(message);
        this.name = 'JsonIndexError';
        this.kind = kind;
    }
}

/**
 * @param {string} what
 * @param {number} at
 * @returns {JsonIndexError}
 */
function syntax(what, at) {
    return new JsonIndexError('syntax', `${what} at byte ${at}`);
}

/**
 * The byte ranges of an array's elements, with up to two scalar fields located inside
 * each object element. Six parallel `Int32Array`s - 24 bytes an element, outside the V8
 * heap - rather than an object per element, which is the cost this module exists to
 * avoid.
 *
 * `a_start[k] === COMPLEX` marks an element whose keys could not be compared as raw
 * bytes (one of them contains an escape). Its fields are not located; the reader has to
 * parse it.
 */
class ElementRanges {

    constructor() {
        this.count = 0;
        this._capacity = 256;
        this.start = new Int32Array(this._capacity);
        this.end = new Int32Array(this._capacity);
        this.a_start = new Int32Array(this._capacity);
        this.a_end = new Int32Array(this._capacity);
        this.b_start = new Int32Array(this._capacity);
        this.b_end = new Int32Array(this._capacity);
    }

    /**
     * @param {number} start
     * @param {number} end
     * @param {number} a_start
     * @param {number} a_end
     * @param {number} b_start
     * @param {number} b_end
     */
    add(start, end, a_start, a_end, b_start, b_end) {
        if (this.count === this._capacity) this._grow();
        const k = this.count;
        this.start[k] = start;
        this.end[k] = end;
        this.a_start[k] = a_start;
        this.a_end[k] = a_end;
        this.b_start[k] = b_start;
        this.b_end[k] = b_end;
        this.count = k + 1;
    }

    _grow() {
        this._capacity *= 2;
        for (const name of ['start', 'end', 'a_start', 'a_end', 'b_start', 'b_end']) {
            const next = new Int32Array(this._capacity);
            next.set(this[name]);
            this[name] = next;
        }
    }
}

/** See {@link ElementRanges}. */
const COMPLEX = -1;

/**
 * @param {number} c
 * @returns {boolean}
 */
function is_ws(c) {
    return c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;
}

/**
 * @param {number} c
 * @returns {boolean}
 */
function is_hex(c) {
    return (c >= ZERO && c <= NINE) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

class Scanner {

    /**
     * @param {Uint8Array} bytes
     */
    constructor(bytes) {
        this.b = bytes;
        this.len = bytes.length;
        // what kind of container is open at each depth, for the iterative value walk
        this.stack = new Uint8Array(MAX_DEPTH + 1);
        // set by string(): whether the string just scanned contained a backslash
        this.escaped = false;
    }

    /**
     * @param {number} i
     * @returns {number} the first index at or after i that is not whitespace
     */
    ws(i) {
        const b = this.b;
        while (is_ws(b[i])) i += 1;
        return i;
    }

    /**
     * @param {number} i index of the opening quote
     * @returns {number} index just past the closing quote
     */
    string(i) {
        const b = this.b;
        const len = this.len;
        let escaped = false;
        let j = i + 1;
        for (;;) {
            if (j >= len) throw syntax('unterminated string', i);
            const c = b[j];
            if (c === QUOTE) break;
            if (c < 0x20) throw syntax('control character in a string', j);
            if (c === BSLASH) {
                escaped = true;
                const e = b[j + 1];
                if (e === 0x75) { // u
                    if (!is_hex(b[j + 2]) || !is_hex(b[j + 3]) || !is_hex(b[j + 4]) || !is_hex(b[j + 5])) {
                        throw syntax('bad unicode escape', j);
                    }
                    j += 6;
                } else if (e === QUOTE || e === BSLASH || e === 0x2f || e === 0x62 || e === 0x66 ||
                    e === 0x6e || e === 0x72 || e === 0x74) {
                    j += 2;
                } else {
                    throw syntax('bad escape', j);
                }
            } else {
                j += 1;
            }
        }
        this.escaped = escaped;
        return j + 1;
    }

    /**
     * @param {number} i index of the first byte, a minus or a digit
     * @returns {number} index just past the number
     */
    number(i) {
        const b = this.b;
        let j = i;
        if (b[j] === MINUS) j += 1;
        if (b[j] === ZERO) {
            j += 1;
        } else if (b[j] > ZERO && b[j] <= NINE) {
            j += 1;
            while (b[j] >= ZERO && b[j] <= NINE) j += 1;
        } else {
            throw syntax('bad number', i);
        }
        if (b[j] === 0x2e) { // .
            j += 1;
            if (!(b[j] >= ZERO && b[j] <= NINE)) throw syntax('bad number', i);
            while (b[j] >= ZERO && b[j] <= NINE) j += 1;
        }
        if (b[j] === 0x65 || b[j] === 0x45) { // e E
            j += 1;
            if (b[j] === 0x2b || b[j] === MINUS) j += 1;
            if (!(b[j] >= ZERO && b[j] <= NINE)) throw syntax('bad number', i);
            while (b[j] >= ZERO && b[j] <= NINE) j += 1;
        }
        return j;
    }

    /**
     * @param {number} i
     * @returns {number} index just past `true`, `false` or `null`
     */
    literal(i) {
        const b = this.b;
        const c = b[i];
        if (c === 0x74 && b[i + 1] === 0x72 && b[i + 2] === 0x75 && b[i + 3] === 0x65) return i + 4;
        if (c === 0x6e && b[i + 1] === 0x75 && b[i + 2] === 0x6c && b[i + 3] === 0x6c) return i + 4;
        if (c === 0x66 && b[i + 1] === 0x61 && b[i + 2] === 0x6c && b[i + 3] === 0x73 && b[i + 4] === 0x65) return i + 5;
        throw syntax(i >= this.len ? 'unexpected end of input' : 'unexpected byte', i);
    }

    /**
     * A key and its colon.
     * @param {number} i index where a key must start
     * @returns {number} index of the first byte of the value
     */
    key(i) {
        if (this.b[i] !== QUOTE) throw syntax('expected a property name', i);
        i = this.ws(this.string(i));
        if (this.b[i] !== COLON) throw syntax('expected a colon', i);
        return this.ws(i + 1);
    }

    /**
     * Validate one value of any shape. Iterative, with the open containers on an
     * explicit stack, so nesting costs no call stack.
     * @param {number} i index of the value's first byte
     * @returns {number} index just past the value
     */
    value(i) {
        const b = this.b;
        const stack = this.stack;
        let depth = 0;
        for (;;) {
            // a value starts at i
            const c = b[i];
            let opened = false;
            if (c === QUOTE) {
                i = this.string(i);
            } else if (c === LBRACE) {
                if (depth === MAX_DEPTH) throw new JsonIndexError('limit', `nested deeper than ${MAX_DEPTH} levels`);
                i = this.ws(i + 1);
                if (b[i] === RBRACE) {
                    i += 1;
                } else {
                    depth += 1;
                    stack[depth] = IN_OBJECT;
                    i = this.key(i);
                    opened = true;
                }
            } else if (c === LBRACK) {
                if (depth === MAX_DEPTH) throw new JsonIndexError('limit', `nested deeper than ${MAX_DEPTH} levels`);
                i = this.ws(i + 1);
                if (b[i] === RBRACK) {
                    i += 1;
                } else {
                    depth += 1;
                    stack[depth] = IN_ARRAY;
                    opened = true;
                }
            } else if (c === MINUS || (c >= ZERO && c <= NINE)) {
                i = this.number(i);
            } else {
                i = this.literal(i);
            }
            if (opened) continue;
            // a value just ended: close containers, or move to the next sibling
            for (;;) {
                if (depth === 0) return i;
                i = this.ws(i);
                const d = b[i];
                if (stack[depth] === IN_OBJECT) {
                    if (d === COMMA) {
                        i = this.key(this.ws(i + 1));
                        break;
                    }
                    if (d !== RBRACE) throw syntax('expected a comma or }', i);
                } else {
                    if (d === COMMA) {
                        i = this.ws(i + 1);
                        break;
                    }
                    if (d !== RBRACK) throw syntax('expected a comma or ]', i);
                }
                depth -= 1;
                i += 1;
            }
        }
    }
}

/**
 * @param {Uint8Array} b
 * @param {number} start
 * @param {number} end
 * @param {Uint8Array|undefined} name
 * @returns {boolean}
 */
function key_equals(b, start, end, name) {
    if (!name || end - start !== name.length) return false;
    for (let q = 0; q < name.length; q++) {
        if (b[start + q] !== name[q]) return false;
    }
    return true;
}

/**
 * Index the elements of the array that opens at `i`.
 *
 * @param {Scanner} scanner
 * @param {number} i index of the `[`
 * @param {{ a?: Uint8Array, b?: Uint8Array }} extract the two keys to locate in each
 *      object element, as the bytes between their quotes
 * @param {{ elements: number, max_elements: number }} budget shared by every array of
 *      one document
 * @returns {{ ranges: ElementRanges, end: number }}
 */
function index_array(scanner, i, extract, budget) {
    const b = scanner.b;
    const ranges = new ElementRanges();
    i = scanner.ws(i + 1);
    if (b[i] === RBRACK) return { ranges, end: i + 1 };
    for (;;) {
        const start = i;
        let a_start = 0;
        let a_end = 0;
        let b_start = 0;
        let b_end = 0;
        if (b[i] === LBRACE) {
            i = scanner.ws(i + 1);
            if (b[i] === RBRACE) {
                i += 1;
            } else {
                let complex = false;
                for (;;) {
                    if (b[i] !== QUOTE) throw syntax('expected a property name', i);
                    const key_start = i + 1;
                    const after_key = scanner.string(i);
                    const key_end = after_key - 1;
                    if (scanner.escaped) complex = true;
                    i = scanner.ws(after_key);
                    if (b[i] !== COLON) throw syntax('expected a colon', i);
                    i = scanner.ws(i + 1);
                    const value_end = scanner.value(i);
                    // a repeated key keeps its last value, as JSON.parse does
                    if (key_equals(b, key_start, key_end, extract.a)) {
                        a_start = i;
                        a_end = value_end;
                    } else if (key_equals(b, key_start, key_end, extract.b)) {
                        b_start = i;
                        b_end = value_end;
                    }
                    i = scanner.ws(value_end);
                    if (b[i] === COMMA) {
                        i = scanner.ws(i + 1);
                        continue;
                    }
                    if (b[i] !== RBRACE) throw syntax('expected a comma or }', i);
                    i += 1;
                    break;
                }
                if (complex) a_start = COMPLEX;
            }
        } else {
            i = scanner.value(i);
        }
        if (budget.elements >= budget.max_elements) {
            throw new JsonIndexError('limit', `more than ${budget.max_elements} elements in its large arrays`);
        }
        budget.elements += 1;
        ranges.add(start, i, a_start, a_end, b_start, b_end);
        i = scanner.ws(i);
        if (b[i] === COMMA) {
            i = scanner.ws(i + 1);
            continue;
        }
        if (b[i] !== RBRACK) throw syntax('expected a comma or ]', i);
        return { ranges, end: i + 1 };
    }
}

/**
 * @typedef {{
 *      key: string,
 *      start: number,
 *      end: number,
 *      elements?: ElementRanges,
 * }} FieldRange `start` and `end` bound the value. `elements` is set when the field is
 *      one of the arrays the caller asked to have indexed, and its value is an array.
 */

/**
 * Index a JSON document whose root is an object.
 *
 * @param {Uint8Array} bytes the document, already checked to be UTF-8
 * @param {{
 *      arrays?: Record<string, { a?: string, b?: string }>,
 *      max_elements?: number,
 * }} [options] `arrays` names the top-level arrays to index element by element, each
 *      with the (at most two) scalar keys to locate inside its object elements.
 *      `max_elements` caps the elements of all of them together.
 * @returns {FieldRange[]|undefined} the top-level fields in document order, a repeated
 *      key appearing once with its last value - or undefined when the root is valid
 *      JSON but not an object
 */
function index_document(bytes, options = {}) {
    const scanner = new Scanner(bytes);
    const b = bytes;
    const arrays = new Map();
    for (const [key, spec] of Object.entries(options.arrays || {})) {
        arrays.set(key, {
            a: spec.a === undefined ? undefined : Buffer.from(spec.a, 'utf8'),
            b: spec.b === undefined ? undefined : Buffer.from(spec.b, 'utf8'),
        });
    }
    const budget = { elements: 0, max_elements: options.max_elements === undefined ? Infinity : options.max_elements };

    let i = scanner.ws(0);
    if (b[i] !== LBRACE) {
        // still has to be valid JSON for the caller to say "not an object"
        i = scanner.ws(scanner.value(i));
        if (i !== scanner.len) throw syntax('unexpected byte after the document', i);
        return undefined;
    }
    /** @type {Map<string, FieldRange>} */
    const fields = new Map();
    i = scanner.ws(i + 1);
    if (b[i] === RBRACE) {
        i += 1;
    } else {
        for (;;) {
            if (b[i] !== QUOTE) throw syntax('expected a property name', i);
            const after_key = scanner.string(i);
            // JSON.parse on the key text itself, so an escaped key means what it says
            const key = JSON.parse(Buffer.from(b.buffer, b.byteOffset + i, after_key - i).toString('utf8'));
            i = scanner.ws(after_key);
            if (b[i] !== COLON) throw syntax('expected a colon', i);
            i = scanner.ws(i + 1);
            const start = i;
            /** @type {FieldRange} */
            const field = { key, start, end: 0 };
            const extract = arrays.get(key);
            if (extract && b[i] === LBRACK) {
                const indexed = index_array(scanner, i, extract, budget);
                field.elements = indexed.ranges;
                i = indexed.end;
            } else {
                i = scanner.value(i);
            }
            field.end = i;
            const earlier = fields.get(key);
            if (earlier) {
                // the last value wins and the first position stays, as in JSON.parse
                earlier.start = field.start;
                earlier.end = field.end;
                earlier.elements = field.elements;
            } else {
                fields.set(key, field);
            }
            i = scanner.ws(i);
            if (b[i] === COMMA) {
                i = scanner.ws(i + 1);
                continue;
            }
            if (b[i] !== RBRACE) throw syntax('expected a comma or }', i);
            i += 1;
            break;
        }
    }
    i = scanner.ws(i);
    if (i !== scanner.len) throw syntax('unexpected byte after the document', i);
    return [...fields.values()];
}

/**
 * Validate one JSON value that fills `bytes` exactly, whitespace aside.
 * @param {Uint8Array} bytes
 */
function validate(bytes) {
    const scanner = new Scanner(bytes);
    const end = scanner.ws(scanner.value(scanner.ws(0)));
    if (end !== scanner.len) throw syntax('unexpected byte after the document', end);
}

// EXPORTS
exports.index_document = index_document;
exports.validate = validate;
exports.JsonIndexError = JsonIndexError;
exports.ElementRanges = ElementRanges;
exports.COMPLEX = COMPLEX;
exports.MAX_DEPTH = MAX_DEPTH;
