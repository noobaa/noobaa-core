/* Copyright (C) 2026 NooBaa */
'use strict';

const errors = require('./s3_tables_errors');

/**
 * Lossless JSON for Iceberg table metadata (design §8.1).
 *
 * Iceberg generates snapshot ids by XORing the halves of a random UUID and masking to
 * 63 bits, so ~99.9% of them exceed Number.MAX_SAFE_INTEGER. A plain JSON.parse /
 * JSON.stringify round trip rounds those values silently - the catalog stays
 * internally consistent with ids that no longer match the manifest-list filenames the
 * client wrote. Node 21+ (NooBaa pins 24.13) supplies both halves natively: the parse
 * reviver receives the raw source text, and JSON.rawJSON emits an integer literal
 * unchanged.
 *
 * Two consequences the rest of the engine must respect:
 *
 * - A preserved value is a *raw JSON object*, not a number. `===`, `_.isEqual` and
 *   `typeof v === 'number'` all misbehave on it. Every read of a stored-only id -
 *   `snapshot-id`, `parent-snapshot-id`, `current-snapshot-id`, ref targets,
 *   `assert-ref-snapshot-id` - goes through {@link id_text} / {@link id_equals}. JSON
 *   forbids leading zeros and a leading `+`, so an integer literal is already
 *   canonical and string comparison is exact. That matters: ...679872 and ...679873
 *   round to the same Number, so a numeric comparison would wrongly satisfy a
 *   requirement.
 * - Every field the engine computes on goes through {@link safe_int}, which rejects a
 *   raw value and anything outside the safe integer range with InvalidRequest.
 */

/**
 * A JSON integer literal: no leading zeros, no `+`, no exponent, no fraction.
 * Gating on this (rather than on !isSafeInteger alone) keeps genuine floats as
 * numbers, which is exactly §8.1's rule - every *integer* literal outside the safe
 * range is preserved as source text.
 */
const INT_RE = /^-?(?:0|[1-9][0-9]*)$/;

/**
 * @param {string} key
 * @param {any} value
 * @param {{ source?: string }} [context]
 * @returns {any}
 */
function lossless_reviver(key, value, context) {
    if (typeof value === 'number' &&
        context !== undefined &&
        context.source !== undefined &&
        !Number.isSafeInteger(value) &&
        INT_RE.test(context.source)) {
        return JSON.rawJSON(context.source);
    }
    return value;
}

/**
 * Parse JSON text, preserving every out-of-range integer literal as its exact source
 * text. Throws SyntaxError on malformed input - callers decide which semantic error
 * that becomes (a malformed request body is InvalidRequest, a malformed stored
 * document is MetadataIntegrity).
 * @param {string} text
 * @returns {any}
 */
function parse(text) {
    return JSON.parse(text, lossless_reviver);
}

/**
 * Serialize. Plain JSON.stringify - raw values emit their source text unchanged.
 * @param {any} value
 * @returns {string}
 */
function stringify(value) {
    return JSON.stringify(value);
}

/**
 * The canonical decimal text of an integer-valued field, whether it survived the parse
 * as a raw value or as an ordinary Number. Returns undefined for an absent field, so
 * callers can tell "absent" from "present with a value" - which is what makes a null
 * `assert-ref-snapshot-id` mean "the ref must not exist".
 * @param {any} value
 * @param {string} [field] field name for the error message
 * @returns {string|undefined}
 */
function id_text(value, field) {
    if (value === undefined || value === null) return undefined;
    if (JSON.isRawJSON(value)) return value.rawJSON;
    if (typeof value === 'number' && Number.isInteger(value)) return String(value);
    throw errors.invalid_request(`${field || 'value'} must be an integer`);
}

/**
 * Exact equality of two integer-valued fields. Both absent compares equal.
 * @param {any} a
 * @param {any} b
 * @param {string} [field] field name for the error message
 * @returns {boolean}
 */
function id_equals(a, b, field) {
    return id_text(a, field) === id_text(b, field);
}

/**
 * A field the engine computes on. Rejects a raw value, a non-number, a fraction and
 * anything outside the safe integer range - including exactly 2^53 - with
 * InvalidRequest (§8.1). Organic growth never reaches there; the check exists to stop
 * a buggy client from pushing the engine into a range where arithmetic silently
 * rounds.
 * @param {any} value
 * @param {string} field
 * @returns {number}
 */
function safe_int(value, field) {
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
    throw errors.invalid_request(`${field} must be an integer within the safe integer range`);
}

// EXPORTS
exports.parse = parse;
exports.stringify = stringify;
exports.id_text = id_text;
exports.id_equals = id_equals;
exports.safe_int = safe_int;
