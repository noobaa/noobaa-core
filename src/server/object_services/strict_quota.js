/* Copyright (C) 2026 NooBaa */
'use strict';

const Quota = require('../system_services/objects/quota');
const { escapeLiteral } = require('pg');
const crypto = require('crypto');

const PG_BIGINT_MAX = '9223372036854775807';

function is_strict_quota(scope) {
    return Boolean(scope && scope.quota && scope.quota.mode === 'strict');
}

/**
 * @param {object} scope
 * @returns {{ limit_bytes: string, limit_objects: string }}
 */
function get_strict_limits(scope) {
    const quota = new Quota(scope.quota);
    const size_raw = quota.get_quota_by_size();
    const quantity_raw = quota.get_quota_by_quantity();
    return {
        limit_bytes: size_raw === '0' ? PG_BIGINT_MAX : size_raw,
        limit_objects: quantity_raw === '0' ? PG_BIGINT_MAX : quantity_raw,
    };
}

function _object_size(obj) {
    if (!obj) return 0;
    const md = obj.data || obj;
    const size = md.size;
    if (typeof size === 'number' && size > 0) return size;
    return 0;
}

/**
 * Reserve bytes and/or objects. Throws QUOTA_EXCEEDED when the atomic increment
 * is rejected by the WHERE cap (this endpoint or another one would overflow).
 *
 * @param {object} scope
 * @param {{ _id: string, size?: number, objects?: number }} info
 */
async function reserve_scope_quota(scope, info) {
    if (!is_strict_quota(scope)) return;
    const bytes = (typeof info.size === 'number' && info.size >= 0) ? info.size : 0;
    if (!bytes && !info.objects) return;

    const params = [
        String(scope._id),
        _hash(),
        String(bytes),
        String(info.objects),
    ];
    const sql = _build_update_sql(...params);
    return sql;
}


/**
 * Maps a random number to a shard index in [0, 9].
 * @returns {number}
 */
function _hash() {
    return crypto.randomInt(1, 101) % 10;
}

/**
 * Builds an upsert SQL that adds the given deltas to used_bytes / used_objects
 * of the (scope_type, scope_id, shard) row in quotausages.
 * Deltas may be negative (release path). Values are inlined as escaped literals
 * because the SQL is executed without bind parameters via the bulk op.
 *
 * Returns an empty string when neither field is provided (caller should skip).
 *
 * @param {string|number} scope_id
 * @param {string|number} shard
 * @param {number|string|undefined} used_bytes
 * @param {number|string|undefined} used_objects
 * @returns {string}
 */
function _build_update_sql(scope_id, shard, used_bytes, used_objects) {
    const has_bytes = used_bytes !== undefined && used_bytes !== null;
    const has_objects = used_objects !== undefined && used_objects !== null;

    if (!has_bytes && !has_objects) return '';

    const scope_lit = escapeLiteral(String(scope_id));
    const shard_lit = Number.parseInt(String(shard), 10);
    const bytes_lit = has_bytes ? BigInt(used_bytes).toString() : '0';
    const objects_lit = has_objects ? BigInt(used_objects).toString() : '0';

    return `
        INSERT INTO quotausages AS c (scope_type, scope_id, shard, used_bytes, used_objects)
        VALUES ('bucket', ${scope_lit}, ${shard_lit}, ${bytes_lit}, ${objects_lit})
        ON CONFLICT (scope_type, scope_id, shard) DO UPDATE
        SET used_bytes   = c.used_bytes   + EXCLUDED.used_bytes,
            used_objects = c.used_objects + EXCLUDED.used_objects`.trim();
}



exports.is_strict_quota = is_strict_quota;
exports.get_strict_limits = get_strict_limits;
exports.reserve_scope_quota = reserve_scope_quota;
exports._object_size = _object_size;
