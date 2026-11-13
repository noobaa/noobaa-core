/* Copyright (C) 2026 NooBaa */
'use strict';

const json_index = require('../../../sdk/s3_tables/s3_tables_json_index');

const { index_document, validate, JsonIndexError, COMPLEX, MAX_DEPTH } = json_index;

/**
 * The indexer is the only reader of the bytes the commit engine copies into the next
 * `metadata.json` (design §8.1), so the property that matters is one sentence: **it
 * accepts exactly what `JSON.parse` accepts.** Most of this file checks that sentence
 * against `JSON.parse` itself, on documents this file did not hand-pick.
 */

// ///////////////////////////////////////////////////////////////////////////////////
// helpers
// ///////////////////////////////////////////////////////////////////////////////////

/* eslint-disable no-bitwise */
/** A small deterministic PRNG (mulberry32), so a failure reproduces from its seed. */
function prng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/* eslint-enable no-bitwise */

const WS = ['', '', '', ' ', '\n', '\t', '\r', '  \n'];
const STRINGS = ['', 'a', 'snapshot-id', 'with space', 'quote\\"inside', 'back\\\\slash', 'nl\\n', 'u\\u00e9',
    'surrogate\\ud83d\\ude00', 'lone\\ud800', 'é', '日本', '😀', '{}[],:', 'true', '\\/'];
const NUMBERS = ['0', '-0', '1', '-1', '42', '8103159149723679872', '-9223372036854775808', '0.5', '-0.0',
    '1e5', '1E+5', '2e-3', '1.5e10', '123456789012345678901234567890'];

/** Random JSON text, with random whitespace between tokens. */
function random_json(rand, depth = 0) {
    const pick = list => list[Math.floor(rand() * list.length)];
    const ws = () => pick(WS);
    const kind = depth > 4 ? Math.floor(rand() * 4) : Math.floor(rand() * 6);
    if (kind === 0) return pick(NUMBERS);
    if (kind === 1) return `"${pick(STRINGS)}"`;
    if (kind === 2) return pick(['true', 'false', 'null']);
    if (kind === 3) return rand() < 0.5 ? `{${ws()}}` : `[${ws()}]`;
    const count = Math.floor(rand() * 5);
    const parts = [];
    for (let i = 0; i < count; i++) {
        const value = `${ws()}${random_json(rand, depth + 1)}${ws()}`;
        parts.push(kind === 4 ? `${ws()}"${pick(STRINGS)}"${ws()}:${value}` : value);
    }
    return kind === 4 ? `{${parts.join(',')}}` : `[${parts.join(',')}]`;
}

/** Damage a document by one ASCII edit, so the bytes stay UTF-8 whatever happens. */
function mutate(rand, text) {
    const chars = [...text];
    const at = Math.floor(rand() * (chars.length + 1));
    const junk = ['{', '}', '[', ']', ',', ':', '"', '\\', '0', '1', '-', '.', 'e', 't', 'n', 'x', ' ', '\n', '\u0001'];
    const choice = rand();
    if (choice < 0.34) chars.splice(at, 1);
    else if (choice < 0.67) chars.splice(at, 0, junk[Math.floor(rand() * junk.length)]);
    else chars.splice(at, 1, junk[Math.floor(rand() * junk.length)]);
    return chars.join('');
}

function json_parse_accepts(text) {
    try {
        JSON.parse(text);
        return true;
    } catch (err) {
        return false;
    }
}

function indexer_accepts(text) {
    try {
        validate(Buffer.from(text, 'utf8'));
        return true;
    } catch (err) {
        if (err instanceof JsonIndexError && err.kind === 'syntax') return false;
        throw err;
    }
}

/** @returns {Record<string, string>} the text of each top-level field */
function field_texts(text, options) {
    const bytes = Buffer.from(text, 'utf8');
    const out = {};
    for (const field of index_document(bytes, options)) out[field.key] = bytes.toString('utf8', field.start, field.end);
    return out;
}

// ///////////////////////////////////////////////////////////////////////////////////
// the same verdict as JSON.parse
// ///////////////////////////////////////////////////////////////////////////////////

describe('s3_tables json_index - the same verdict as JSON.parse', () => {

    it('accepts every generated document JSON.parse accepts', () => {
        const rand = prng(1);
        for (let i = 0; i < 3000; i++) {
            const text = random_json(rand);
            expect(json_parse_accepts(text)).toBe(true);
            if (!indexer_accepts(text)) throw new Error(`the indexer rejected valid JSON: ${JSON.stringify(text)}`);
        }
    });

    it('agrees with JSON.parse on every damaged document', () => {
        const rand = prng(2);
        let rejected = 0;
        for (let i = 0; i < 20000; i++) {
            let text = random_json(rand);
            const edits = 1 + Math.floor(rand() * 2);
            for (let e = 0; e < edits; e++) text = mutate(rand, text);
            const expected = json_parse_accepts(text);
            if (!expected) rejected += 1;
            if (indexer_accepts(text) !== expected) {
                throw new Error(`JSON.parse ${expected ? 'accepts' : 'rejects'} but the indexer does not: ${JSON.stringify(text)}`);
            }
        }
        // the damage has to actually break documents for the comparison to mean anything
        expect(rejected).toBeGreaterThan(5000);
    });

    it.each([
        ['an empty input', ''],
        ['whitespace only', '  \n'],
        ['a trailing comma in an object', '{"a":1,}'],
        ['a trailing comma in an array', '[1,]'],
        ['a missing comma', '[1 2]'],
        ['a missing colon', '{"a" 1}'],
        ['a missing value', '{"a":}'],
        ['an unquoted key', '{a:1}'],
        ['a single-quoted string', "{'a':1}"],
        ['a leading zero', '01'],
        ['a bare minus', '-'],
        ['a trailing decimal point', '1.'],
        ['a leading decimal point', '.5'],
        ['an empty exponent', '1e'],
        ['a plus sign', '+1'],
        ['a hex number', '0x10'],
        ['NaN', 'NaN'],
        ['Infinity', 'Infinity'],
        ['a truncated literal', 'tru'],
        ['a capitalized literal', 'True'],
        ['a raw newline in a string', '"a\nb"'],
        ['a raw tab in a string', '"a\tb"'],
        ['an unknown escape', '"\\x41"'],
        ['a short unicode escape', '"\\u12"'],
        ['an unterminated string', '"abc'],
        ['an unterminated object', '{"a":1'],
        ['an unterminated array', '[1,2'],
        ['a mismatched bracket', '[1}'],
        ['two documents', '{} {}'],
        ['trailing garbage', '{}x'],
        ['a comment', '{} // x'],
        ['a byte order mark', '﻿{}'],
        ['a non-breaking space as whitespace', ' {}'],
        ['a form feed as whitespace', '\f{}'],
    ])('rejects %s, as JSON.parse does', (_label, text) => {
        expect(json_parse_accepts(text)).toBe(false);
        expect(indexer_accepts(text)).toBe(false);
    });

    it.each([
        ['a DEL character in a string', '"a\u007fb"'],
        ['an escaped solidus', '"\\/"'],
        ['a lone surrogate escape', '"\\ud800"'],
        ['an integer far outside the double range', '1e999'],
        ['a scalar at the root', '42'],
        ['whitespace on both sides', ' \r\n\t{"a":[1, 2 ,3]}\n'],
    ])('accepts %s, as JSON.parse does', (_label, text) => {
        expect(json_parse_accepts(text)).toBe(true);
        expect(indexer_accepts(text)).toBe(true);
    });

    it('refuses nesting past its depth limit as a limit, not as bad syntax', () => {
        const ok = `${'['.repeat(MAX_DEPTH)}${']'.repeat(MAX_DEPTH)}`;
        expect(() => validate(Buffer.from(ok))).not.toThrow();
        const deep = `${'['.repeat(MAX_DEPTH + 1)}${']'.repeat(MAX_DEPTH + 1)}`;
        let err;
        try {
            validate(Buffer.from(deep));
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(JsonIndexError);
        expect(err.kind).toBe('limit');
    });

    it('walks very long flat containers without recursion', () => {
        const text = `{"a":[${'{"k":[1,2,{"x":null}]},'.repeat(200000)}0]}`;
        expect(() => validate(Buffer.from(text))).not.toThrow();
    });
});

// ///////////////////////////////////////////////////////////////////////////////////
// index_document
// ///////////////////////////////////////////////////////////////////////////////////

describe('s3_tables json_index - index_document', () => {

    it('locates every top-level field, in document order', () => {
        const text = ' { "format-version" : 2 , "name":"t","nested":{"a":[1,{"b":"}"}]},"n":null } ';
        expect(field_texts(text)).toEqual({
            'format-version': '2',
            'name': '"t"',
            'nested': '{"a":[1,{"b":"}"}]}',
            'n': 'null',
        });
        expect(Object.keys(field_texts(text))).toEqual(['format-version', 'name', 'nested', 'n']);
    });

    it('returns no fields for an empty object', () => {
        expect(index_document(Buffer.from(' {} '))).toEqual([]);
    });

    it('reports a root that is valid JSON but not an object as undefined', () => {
        expect(index_document(Buffer.from('[1,2]'))).toBeUndefined();
        expect(index_document(Buffer.from('"text"'))).toBeUndefined();
        expect(index_document(Buffer.from('null'))).toBeUndefined();
        expect(() => index_document(Buffer.from('[1,'))).toThrow(JsonIndexError);
    });

    it('keeps the last value and the first position of a repeated key, as JSON.parse does', () => {
        const text = '{"a":1,"b":2,"a":3}';
        expect(Object.keys(JSON.parse(text))).toEqual(['a', 'b']);
        expect(field_texts(text)).toEqual({ a: '3', b: '2' });
        expect(Object.keys(field_texts(text))).toEqual(['a', 'b']);
    });

    it('decodes an escaped key to the name it spells', () => {
        expect(Object.keys(field_texts('{"snap\\u0073hots":1,"a\\"b":2}'))).toEqual(['snapshots', 'a"b']);
    });

    it('indexes the elements of a requested array and locates two scalars in each', () => {
        const text = '{"x":1,"snapshots":[ {"snapshot-id":8103159149723679872,"timestamp-ms":17,"summary":{"snapshot-id":"decoy"}} ,' +
            '{"timestamp-ms" : 18, "snapshot-id" : 5},{"other":true},{}, 7, [1], "s", null ]}';
        const bytes = Buffer.from(text);
        const [, field] = index_document(bytes, { arrays: { snapshots: { a: 'snapshot-id', b: 'timestamp-ms' } } });
        const e = field.elements;
        const slice = (start, end) => bytes.toString('utf8', start, end);
        expect(e.count).toBe(8);
        expect(slice(e.a_start[0], e.a_end[0])).toBe('8103159149723679872');
        expect(slice(e.b_start[0], e.b_end[0])).toBe('17');
        expect(slice(e.a_start[1], e.a_end[1])).toBe('5');
        expect(slice(e.b_start[1], e.b_end[1])).toBe('18');
        // a key that is absent is not located, and neither is anything in a non-object
        for (const k of [2, 3, 4, 5, 6, 7]) {
            expect(e.a_end[k]).toBe(0);
            expect(e.b_end[k]).toBe(0);
        }
        expect(slice(e.start[0], e.end[0])).toMatch(/^\{"snapshot-id".*\}\}$/);
        expect(slice(e.start[4], e.end[4])).toBe('7');
        expect(slice(e.start[5], e.end[5])).toBe('[1]');
        expect(slice(e.start[7], e.end[7])).toBe('null');
        // and the elements tile the array: each is exactly one JSON value
        for (let k = 0; k < e.count; k++) expect(() => JSON.parse(slice(e.start[k], e.end[k]))).not.toThrow();
    });

    it('takes the last of a repeated key inside an element', () => {
        const bytes = Buffer.from('{"l":[{"id":1,"id":2}]}');
        const [field] = index_document(bytes, { arrays: { l: { a: 'id' } } });
        expect(bytes.toString('utf8', field.elements.a_start[0], field.elements.a_end[0])).toBe('2');
    });

    it('marks an element whose keys carry escapes, instead of comparing them as bytes', () => {
        // "snapshot-id" is the key snapshot-id to JSON.parse, and is not to a byte compare
        const bytes = Buffer.from('{"l":[{"snapshot\\u002did":1},{"snapshot-id":2}]}');
        const [field] = index_document(bytes, { arrays: { l: { a: 'snapshot-id' } } });
        expect(field.elements.a_start[0]).toBe(COMPLEX);
        expect(field.elements.a_start[1]).not.toBe(COMPLEX);
    });

    it('leaves a requested key that is not an array as an ordinary field', () => {
        const [field] = index_document(Buffer.from('{"snapshots":null}'), { arrays: { snapshots: { a: 'snapshot-id' } } });
        expect(field.elements).toBeUndefined();
    });

    it('caps the elements of all indexed arrays together', () => {
        const text = '{"a":[1,2,3],"b":[4,5,6]}';
        const arrays = { a: {}, b: {} };
        expect(() => index_document(Buffer.from(text), { arrays, max_elements: 6 })).not.toThrow();
        let err;
        try {
            index_document(Buffer.from(text), { arrays, max_elements: 5 });
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(JsonIndexError);
        expect(err.kind).toBe('limit');
        // an array that was not requested is not counted
        expect(() => index_document(Buffer.from(text), { arrays: { a: {} }, max_elements: 3 })).not.toThrow();
    });

    it('validates what it does not index as strictly as what it does', () => {
        expect(() => index_document(Buffer.from('{"a":[1,],"l":[]}'), { arrays: { l: {} } })).toThrow(JsonIndexError);
        expect(() => index_document(Buffer.from('{"a":1,"l":[{"k":01}]}'), { arrays: { l: {} } })).toThrow(JsonIndexError);
        expect(() => index_document(Buffer.from('{"a":1,"l":[{"k":1,}]}'), { arrays: { l: {} } })).toThrow(JsonIndexError);
        expect(() => index_document(Buffer.from('{"a":1,"l":[{"k":1}],}'), { arrays: { l: {} } })).toThrow(JsonIndexError);
    });

    it('grows its element table past its first allocation', () => {
        const text = `{"l":[${'{"id":1},'.repeat(5000)}{"id":2}]}`;
        const bytes = Buffer.from(text);
        const [field] = index_document(bytes, { arrays: { l: { a: 'id' } } });
        expect(field.elements.count).toBe(5001);
        expect(bytes.toString('utf8', field.elements.a_start[5000], field.elements.a_end[5000])).toBe('2');
        expect(bytes.toString('utf8', field.elements.start[4999], field.elements.end[4999])).toBe('{"id":1}');
    });
});
