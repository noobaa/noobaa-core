/* Copyright (C) 2026 NooBaa */
'use strict';

const { isUtf8 } = require('node:buffer');
const errors = require('./s3_tables_errors');
const json_index = require('./s3_tables_json_index');
const lossless_json = require('./s3_tables_lossless_json');

/**
 * The metadata document as the engine sees it (design §8.1): a plain object whose
 * fields are parsed on first read, whose large arrays are lists of byte ranges, and
 * which is written back by copying every range nothing touched.
 *
 * **Why not parse the document.** The heap a `JSON.parse` needs follows the number of
 * JSON values, not the bytes - a 50 MB table of snapshots needs about 290 MB, a
 * document dense in small values up to 80 times its size - and a worker's heap limit
 * does not contain an overrun: one native call that fills the heap aborts the whole
 * process (§8.3). So the only safe parse is a small one, and this module makes every
 * parse small:
 *
 * - The arrays in {@link RAW_ARRAYS} grow with a table's history. They are never
 *   parsed. Each is a {@link RawList}: one byte range per element, and the one or two
 *   scalars the engine reads from it, decoded straight from the bytes.
 * - Every other top-level field is an accessor that parses its own bytes the first
 *   time a handler reads it. A field nobody reads stays bytes.
 * - What a commit may parse is capped (`max_parsed_bytes`), and so is the number of
 *   elements the index may hold (`max_elements`). The worker heap is sized from those
 *   caps and not from any document.
 *
 * The handlers do not know any of this. A `RawList` answers the array methods they
 * call, and a field read returns a plain value.
 *
 * Requires its siblings and one node builtin, like every module the worker loads.
 */

/**
 * The arrays kept raw, and the scalar keys located inside each element (at most two -
 * see `ElementRanges`). These are the fields a handler reads off a *stored* element
 * without needing the rest of it. Any other key read parses that one element.
 */
const RAW_ARRAYS = Object.freeze({
    'snapshots': Object.freeze({ a: 'snapshot-id', b: 'timestamp-ms' }),
    'snapshot-log': Object.freeze({ a: 'snapshot-id', b: 'timestamp-ms' }),
    'metadata-log': Object.freeze({ a: 'timestamp-ms' }),
    'statistics': Object.freeze({ a: 'snapshot-id' }),
    'partition-statistics': Object.freeze({ a: 'snapshot-id' }),
    'schemas': Object.freeze({ a: 'schema-id' }),
});

/** On the metadata object: its {@link Source}. On an element view: where it came from. */
const SOURCE = Symbol('s3_tables_raw_source');

const SHORT_INT_RE = /^-?\d{1,15}$/;
const INT_RE = /^-?\d+$/;

/**
 * The input bytes and what this commit has parsed out of them so far.
 */
class Source {

    /**
     * @param {Buffer} bytes
     * @param {number} max_parsed_bytes
     */
    constructor(bytes, max_parsed_bytes) {
        this.bytes = bytes;
        this.max_parsed_bytes = max_parsed_bytes;
        // bytes of top-level fields parsed and still referenced by the document
        this.parsed_bytes = 0;
        /** @type {Map<string, { start: number, end: number }>} fields still unparsed */
        this.lazy = new Map();
    }

    /**
     * @param {number} start
     * @param {number} end
     * @returns {string}
     */
    text(start, end) {
        return this.bytes.toString('utf8', start, end);
    }

    /**
     * Parse a top-level field. What it costs stays charged for the rest of the commit,
     * because the value stays in the document.
     * @param {string} key
     * @param {number} start
     * @param {number} end
     * @returns {any}
     */
    parse_field(key, start, end) {
        this._assert_room(end - start, `field ${key}`);
        this.parsed_bytes += end - start;
        return lossless_json.parse(this.text(start, end));
    }

    /**
     * Parse one element of a raw list. It is charged only while it is being looked at:
     * the caller drops it, so what bounds the heap is the largest element, not their sum.
     * @param {number} start
     * @param {number} end
     * @returns {any}
     */
    parse_element(start, end) {
        this._assert_room(end - start, 'an array element');
        return lossless_json.parse(this.text(start, end));
    }

    /**
     * @param {number} size
     * @param {string} what
     */
    _assert_room(size, what) {
        if (this.parsed_bytes + size <= this.max_parsed_bytes) return;
        throw errors.invalid_request(
            `this commit would parse more than ${this.max_parsed_bytes} bytes of the table metadata ` +
            `(${what} is ${size} bytes)`);
    }

    /**
     * A scalar located by the indexer, as `lossless_json.parse` would return it.
     * @param {number} start
     * @param {number} end
     * @returns {any}
     */
    scalar(start, end) {
        const text = this.bytes.toString('latin1', start, end);
        if (SHORT_INT_RE.test(text)) return Number(text);
        if (INT_RE.test(text)) {
            const number = Number(text);
            return Number.isSafeInteger(number) ? number : JSON.rawJSON(text);
        }
        // a string, a fraction, null - or something that is not a scalar at all, which
        // is why this goes through the cap: the value's size is the client's choice
        return this.parse_element(start, end);
    }
}

/**
 * The traps of an {@link ElementView}. Declared first because the class's constructor
 * names it; every trap runs long after both exist.
 * @type {ProxyHandler<any>}
 */
const VIEW_HANDLER = {
    get(view, key) {
        const { list, k } = view;
        if (key === SOURCE) return view;
        if (view.full === undefined) {
            const { ranges, source, spec } = list;
            if (key === spec.a) {
                return ranges.a_end[k] ? source.scalar(ranges.a_start[k], ranges.a_end[k]) : undefined;
            }
            if (key === spec.b) {
                return ranges.b_end[k] ? source.scalar(ranges.b_start[k], ranges.b_end[k]) : undefined;
            }
            if (typeof key === 'symbol') return undefined;
        }
        return view.parsed()[key];
    },
    has(view, key) {
        return key in view.parsed();
    },
    ownKeys(view) {
        return Reflect.ownKeys(view.parsed());
    },
    getOwnPropertyDescriptor(view, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(view.parsed(), key);
        // a Proxy may not report a property its target lacks as non-configurable
        if (descriptor) descriptor.configurable = true;
        return descriptor;
    },
    set() {
        throw new TypeError('a stored metadata element is read-only');
    },
    defineProperty() {
        throw new TypeError('a stored metadata element is read-only');
    },
    deleteProperty() {
        throw new TypeError('a stored metadata element is read-only');
    },
};

/**
 * A stored array element, read without parsing it.
 *
 * It is a Proxy because the engine's handlers are written against parsed objects and
 * must stay that way: `snapshot['snapshot-id']` is answered from the located bytes, and
 * a read of any other key parses that one element and answers from the result. A view
 * is read-only - stored elements are immutable in Iceberg, and a handler that wrote to
 * one would be writing to something that is never serialized.
 */
class ElementView {

    /**
     * @param {RawList} list
     */
    constructor(list) {
        this.list = list;
        this.k = -1;
        this.full = undefined;
        this.proxy = new Proxy(this, VIEW_HANDLER);
    }

    /**
     * Point the view at element `k`.
     * @param {number} k
     * @returns {any} the proxy
     */
    at(k) {
        this.k = k;
        this.full = undefined;
        return this.proxy;
    }

    /** @returns {any} the element, parsed - for the duration of this view only */
    parsed() {
        if (this.full === undefined) {
            const { ranges, source } = this.list;
            this.full = source.parse_element(ranges.start[this.k], ranges.end[this.k]);
        }
        return this.full;
    }
}

/**
 * One of the document's large arrays, as byte ranges.
 *
 * `items` are indices into `ranges`, in document order; `added` are values this commit
 * pushed, and they follow the items. `replaced` holds values that took a stored
 * element's place. The methods are the ones the engine calls on these arrays, with the
 * meaning `Array` gives them.
 */
class RawList {

    /**
     * @param {Source} source
     * @param {{ a?: string, b?: string }} spec
     * @param {import('./s3_tables_json_index').ElementRanges} ranges
     * @param {Int32Array} [items]
     * @param {any[]} [added]
     * @param {Map<number, any>} [replaced]
     */
    constructor(source, spec, ranges, items, added, replaced) {
        this.source = source;
        this.spec = spec;
        this.ranges = ranges;
        if (items) {
            this.items = items;
        } else {
            this.items = new Int32Array(ranges.count);
            for (let k = 0; k < ranges.count; k++) this.items[k] = k;
        }
        this.added = added || [];
        this.replaced = replaced || new Map();
    }

    get length() {
        return this.items.length + this.added.length;
    }

    /**
     * The value at stored element `k`.
     * @param {number} k
     * @param {ElementView} [reuse] a view to repoint instead of allocating one - only
     *      for callers that do not let the value escape
     * @returns {any}
     */
    _value(k, reuse) {
        if (this.replaced.size && this.replaced.has(k)) return this.replaced.get(k);
        const { ranges, source } = this;
        // not an object, or its keys carry escapes the indexer could not compare:
        // parse it, it is not what these arrays are made of
        if (source.bytes[ranges.start[k]] !== 0x7b || ranges.a_start[k] === json_index.COMPLEX) {
            return source.parse_element(ranges.start[k], ranges.end[k]);
        }
        return (reuse || new ElementView(this)).at(k);
    }

    /**
     * @param {(value: any, index: number) => any} fn
     * @returns {number}
     */
    findIndex(fn) {
        const items = this.items;
        const view = new ElementView(this);
        for (let i = 0; i < items.length; i++) {
            if (fn(this._value(items[i], view), i)) return i;
        }
        const index = this.added.findIndex((value, i) => fn(value, items.length + i));
        return index < 0 ? -1 : items.length + index;
    }

    /**
     * @param {(value: any, index: number) => any} fn
     * @returns {any}
     */
    find(fn) {
        const index = this.findIndex(fn);
        if (index < 0) return undefined;
        // a fresh view: this one is returned to the caller
        return index < this.items.length ? this._value(this.items[index]) : this.added[index - this.items.length];
    }

    /**
     * @param {(value: any, index: number) => any} fn
     * @returns {boolean}
     */
    some(fn) {
        return this.findIndex(fn) >= 0;
    }

    /**
     * @param {(value: any, index: number) => any} fn
     * @returns {RawList}
     */
    filter(fn) {
        const items = this.items;
        const kept = new Int32Array(items.length);
        const view = new ElementView(this);
        let n = 0;
        for (let i = 0; i < items.length; i++) {
            if (fn(this._value(items[i], view), i)) {
                kept[n] = items[i];
                n += 1;
            }
        }
        const added = this.added.filter((value, i) => fn(value, items.length + i));
        return new RawList(this.source, this.spec, this.ranges, kept.subarray(0, n), added, new Map(this.replaced));
    }

    /**
     * @param {(value: any, index: number) => any} fn
     * @returns {any[]}
     */
    map(fn) {
        const out = [];
        let i = 0;
        for (const value of this) {
            out.push(fn(value, i));
            i += 1;
        }
        return out;
    }

    /**
     * @param {...any} values
     * @returns {number}
     */
    push(...values) {
        for (const value of values) this.added.push(value);
        return this.length;
    }

    /** Every value, each stored element as a view of its own. */
    *[Symbol.iterator]() {
        const items = this.items;
        for (let i = 0; i < items.length; i++) yield this._value(items[i]);
        yield* this.added;
    }

    /**
     * @param {number} index
     * @param {any} value
     */
    replace_at(index, value) {
        if (index < this.items.length) {
            this.replaced.set(this.items[index], value);
        } else {
            this.added[index - this.items.length] = value;
        }
    }

    /**
     * Drop the first `count` values.
     * @param {number} count
     */
    trim_front(count) {
        const from_items = Math.min(count, this.items.length);
        this.items = this.items.subarray(from_items);
        if (count > from_items) this.added.splice(0, count - from_items);
    }
}

// ///////////////////////////////////////////////////////////////////////////////////
// helpers the engine uses on a list that may be a RawList or a plain array
// ///////////////////////////////////////////////////////////////////////////////////

/**
 * @param {any} value
 * @returns {boolean}
 */
function is_list(value) {
    return Array.isArray(value) || value instanceof RawList;
}

/**
 * `list[index] = value`.
 * @param {any} list
 * @param {number} index
 * @param {any} value
 */
function replace_at(list, index, value) {
    if (list instanceof RawList) {
        list.replace_at(index, value);
    } else {
        list[index] = value;
    }
}

/**
 * `list.splice(0, count)`.
 * @param {any} list
 * @param {number} count
 */
function trim_front(list, count) {
    if (list instanceof RawList) {
        list.trim_front(count);
    } else {
        list.splice(0, count);
    }
}

/**
 * Move a key to the end of an object's key order **without reading it** - the
 * descriptor is moved, so a field that is still bytes stays bytes.
 * @param {any} object
 * @param {string} key
 */
function move_key_last(object, key) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    delete object[key];
    Object.defineProperty(object, key, descriptor);
}

// ///////////////////////////////////////////////////////////////////////////////////
// open and write
// ///////////////////////////////////////////////////////////////////////////////////

/**
 * @param {any} metadata
 * @param {Source} source
 * @param {string} key
 * @param {number} start
 * @param {number} end
 */
function define_lazy_field(metadata, source, key, start, end) {
    source.lazy.set(key, { start, end });
    const settle = value => {
        // redefining an existing property keeps its place in the key order
        Object.defineProperty(metadata, key, { value, writable: true, enumerable: true, configurable: true });
    };
    Object.defineProperty(metadata, key, {
        enumerable: true,
        configurable: true,
        get() {
            const value = source.parse_field(key, start, end);
            settle(value);
            return value;
        },
        set: settle,
    });
}

/**
 * Open a stored `metadata.json` for a commit. Nothing is parsed here.
 *
 * A document that is not JSON, not UTF-8 or not an object is the catalog's stored file
 * at fault, so it is MetadataIntegrity. One past a structural limit is refused the way
 * a document past the size limit is, as InvalidRequest.
 *
 * @param {Buffer} bytes
 * @param {{ max_parsed_bytes: number, max_elements: number }} limits
 * @returns {any} the metadata document
 */
function open_document(bytes, limits) {
    if (!isUtf8(bytes)) {
        throw errors.metadata_integrity('the current table metadata is not valid JSON: it is not UTF-8');
    }
    let fields;
    try {
        fields = json_index.index_document(bytes, { arrays: RAW_ARRAYS, max_elements: limits.max_elements });
    } catch (err) {
        if (!(err instanceof json_index.JsonIndexError)) throw err;
        if (err.kind === 'limit') throw errors.invalid_request(`the table metadata document has ${err.message}`);
        throw errors.metadata_integrity(`the current table metadata is not valid JSON: ${err.message}`);
    }
    if (!fields) throw errors.metadata_integrity('the current table metadata is not a JSON object');

    const source = new Source(bytes, limits.max_parsed_bytes);
    const metadata = {};
    Object.defineProperty(metadata, SOURCE, { value: source });
    for (const field of fields) {
        if (field.elements) {
            Object.defineProperty(metadata, field.key, {
                value: new RawList(source, RAW_ARRAYS[field.key], field.elements),
                writable: true,
                enumerable: true,
                configurable: true,
            });
        } else {
            define_lazy_field(metadata, source, field.key, field.start, field.end);
        }
    }
    return metadata;
}

/**
 * Collects the output as pieces - a Buffer, or a range of the input - and copies them
 * into one allocation at the end.
 */
class Pieces {

    /**
     * @param {Buffer} input
     */
    constructor(input) {
        this.input = input;
        /** @type {(Buffer|number)[]} a Buffer, or two numbers: a start and an end in the input */
        this.list = [];
        this.total = 0;
    }

    /**
     * @param {string} text
     * @returns {number} its length in bytes
     */
    text(text) {
        const buffer = Buffer.from(text, 'utf8');
        this.list.push(buffer);
        this.total += buffer.length;
        return buffer.length;
    }

    /**
     * @param {number} start
     * @param {number} end
     */
    range(start, end) {
        this.list.push(start, end);
        this.total += end - start;
    }

    /** @returns {Buffer} a buffer that owns its whole ArrayBuffer, so it transfers without a copy */
    join() {
        const out = Buffer.allocUnsafeSlow(this.total);
        const list = this.list;
        let at = 0;
        for (let p = 0; p < list.length; p++) {
            const piece = list[p];
            if (typeof piece === 'number') {
                p += 1;
                at += this.input.copy(out, at, piece, /** @type {number} */ (list[p]));
            } else {
                at += piece.copy(out, at);
            }
        }
        return out;
    }
}

/**
 * Write the elements of a list. A run of stored elements that are still adjacent is one
 * range, separators included, so an untouched array of any length is a single copy.
 * @param {Pieces} pieces
 * @param {any} list a RawList, or a plain array that may hold element views
 */
function write_elements(pieces, list) {
    let first = true;
    let run_ranges;
    let run_start = 0;
    let run_end = 0;
    let run_last = -2;
    const flush = () => {
        if (!run_ranges) return;
        if (!first) pieces.text(',');
        first = false;
        pieces.range(run_start, run_end);
        run_ranges = undefined;
    };
    const raw = (ranges, k) => {
        if (run_ranges === ranges && k === run_last + 1) {
            run_end = ranges.end[k];
        } else {
            flush();
            run_ranges = ranges;
            run_start = ranges.start[k];
            run_end = ranges.end[k];
        }
        run_last = k;
    };
    const value = v => {
        const view = v && typeof v === 'object' ? v[SOURCE] : undefined;
        if (view instanceof ElementView) {
            raw(view.list.ranges, view.k);
            return;
        }
        flush();
        if (!first) pieces.text(',');
        first = false;
        // as JSON.stringify writes an array hole or an undefined element
        pieces.text(v === undefined ? 'null' : lossless_json.stringify(v));
    };
    if (list instanceof RawList) {
        const { items, replaced, ranges } = list;
        for (let i = 0; i < items.length; i++) {
            const k = items[i];
            if (replaced.size && replaced.has(k)) value(replaced.get(k)); else raw(ranges, k);
        }
        for (const v of list.added) value(v);
    } else {
        for (const v of list) value(v);
    }
    flush();
}

/**
 * Serialize the document: copy what nothing touched, stringify the rest.
 *
 * The fields this commit parsed are measured as they are written and must fit the
 * parsed cap, so a commit cannot grow them past what a later commit may read.
 *
 * A plain object - a document built in memory, not opened from bytes - is stringified
 * whole.
 *
 * @param {any} metadata
 * @returns {Buffer}
 */
function write_document(metadata) {
    /** @type {Source} */
    const source = metadata[SOURCE];
    if (!source) return Buffer.from(lossless_json.stringify(metadata), 'utf8');

    const pieces = new Pieces(source.bytes);
    let parsed_out = 0;
    let first = true;
    pieces.text('{');
    for (const key of Object.keys(metadata)) {
        const descriptor = Object.getOwnPropertyDescriptor(metadata, key);
        const lazy = descriptor.get ? source.lazy.get(key) : undefined;
        const value = lazy ? undefined : descriptor.value;
        if (!lazy && (value === undefined || typeof value === 'function')) continue;
        pieces.text(`${first ? '' : ','}${JSON.stringify(key)}:`);
        first = false;
        if (lazy) {
            pieces.range(lazy.start, lazy.end);
        } else if (value instanceof RawList || (Array.isArray(value) && Object.hasOwn(RAW_ARRAYS, key))) {
            pieces.text('[');
            write_elements(pieces, value);
            pieces.text(']');
        } else {
            parsed_out += pieces.text(lossless_json.stringify(value));
        }
    }
    pieces.text('}');
    if (parsed_out > source.max_parsed_bytes) {
        throw errors.invalid_request(
            `this commit would grow the parsed fields of the table metadata to ${parsed_out} bytes, ` +
            `over the maximum of ${source.max_parsed_bytes} bytes`);
    }
    return pieces.join();
}

// EXPORTS
exports.open_document = open_document;
exports.write_document = write_document;
exports.is_list = is_list;
exports.replace_at = replace_at;
exports.trim_front = trim_front;
exports.move_key_last = move_key_last;
exports.RawList = RawList;
exports.RAW_ARRAYS = RAW_ARRAYS;
