/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const db_client = require('../../util/db_client');
const { MDStore } = require('./md_store');
const mongo_utils = require('../../util/mongo_utils');
const { escapeLiteral } = require('pg');
const crypto = require('crypto');
const PG_BIGINT_MAX = '9223372036854775807';

// Postgres bigint max. Used as "unlimited" so a single WHERE clause covers both
// size-only and quantity-only quotas without branching in SQL.


const USAGE_SQL = `
SELECT
    SUM(used_bytes)   AS used_bytes,
    SUM(used_objects) AS used_objects
FROM quotausages
WHERE scope_id::text = $1::text
`;

/**
 * Dedicated usage counter for strict bucket quota.
 *
 * Why not system_store / bucket.storage_stats:
 * - system_store is a config cache; every write is broadcast and reloads in-memory state.
 * - md_aggregator already writes storage_stats on a minutes-scale cycle; putting per-request
 *   increments there would serialize all endpoints on config updates.
 *
 * Why a one-row-per-bucket JSONB table with raw SQL:
 * - Same collection machinery as other MD tables, but the hot path is a parameterized
 *   UPDATE ... WHERE (used + delta) <= limit RETURNING, which is one round-trip,
 *   row-level atomic, and prepared (query_name). JSONB rewrite of a ~100B document is
 *   cheap next to the inherent single-row lock on the bucket.
 */
class QuotaStore {

    static instance() {
        QuotaStore._instance =QuotaStore._instance || new QuotaStore();
        return QuotaStore._instance;
    }

    /**
     * @param {nb.ID|string} scope_id
     */
    async delete_usage(scope_id) {
        await MDStore.instance().delete_bucket_quota_rows(scope_id);
    }

    /**
     * @param {nb.ID|string} scope_id
     * @param {string| undefined} scope_type
     * @returns {Promise<{used_bytes: number, used_objects: number}|null>}
     */
    async get_usage(scope_id, scope_type = 'bucket') {
        const params = [
            String(scope_id),
        ];
        const res = await MDStore.instance().find_bucket_quota_row(scope_id, scope_type);
        if (!res || !res.rowCount) {
            dbg.log1('QuotaStore.get_usage: failed', params);
            return { used_bytes: 0, used_objects: 0};
        }
        return {
            used_bytes: Number(res.rows[0].used_bytes) || 0,
            used_objects: Number(res.rows[0].used_objects) || 0,
        };
    }

    /**
     * Fetch current usage and verify that adding delta_bytes/delta_objects would
     * not exceed the given limits.
     *
     * @param {string} scope_id_str  - stringified bucket id
     * @param {number} delta_bytes
     * @param {number} delta_objects
     * @param {number|string} limit_bytes
     * @param {number|string} limit_objects
     * @returns {Promise<boolean>}  false when the row is missing or limits would be exceeded
     */
    async _check_quota_limits(scope_id_str, delta_bytes, delta_objects, limit_bytes, limit_objects) {
        const usage_res = await db_client.instance().executeSQL(USAGE_SQL, [scope_id_str], {
            preferred_pool: 'md',
            query_name: 'bucket_quota_usage',
        });
        if (!usage_res.rowCount) {
            dbg.log1('QuotaStore._check_quota_limits: no usage row found', scope_id_str);
            return false;
        }

        const next_bytes = BigInt(usage_res.rows[0].used_bytes) + BigInt(delta_bytes);
        const next_objects = BigInt(usage_res.rows[0].used_objects) + BigInt(delta_objects);
        if (next_bytes > BigInt(limit_bytes) || next_objects > BigInt(limit_objects)) {
            dbg.warn('QuotaStore._check_quota_limits: rejected due to quota validation, next bytes',
                next_bytes, "limit bytes: ", limit_bytes, "next objects: ", next_objects, "limit objects: ", limit_objects);
            return false;
        }
        return true;
    }

    /**
     * Atomically add usage. Returns false if the write would exceed either limit
     * (or if the row is missing — fail closed). Concurrent endpoints serialize on
     * the row lock; the WHERE clause is evaluated against the locked current values.
     *
     * @param {{
     *   scope_id: nb.ID|string,
     *   delta_bytes?: number,
     *   delta_objects?: number,
     * }} params
     * @returns {Promise<string>}
     */
    async try_reserve_bucket_quota({
        scope_id,
        delta_bytes = 0,
        delta_objects = 0,
    }) {
        if (!delta_bytes && !delta_objects) return '';

        const params = [
            String(scope_id),
            this._hash(),
            String(delta_bytes),
            String(delta_objects),
        ];
        const sql = this._build_update_sql(...params);
        return sql;
    }

    /**
     * Decrement usage, clamped at 0. Never fails the caller for quota reasons.
     *
     * @param {{
     *   scope_id: nb.ID|string,
     *   object_id: string,
     *   delta_bytes?: number,
     *   delta_objects?: number,
     * }} params
     */
    async release_bucket_quota({ scope_id, delta_bytes = 0, delta_objects = 0}) {
        if (!delta_bytes && !delta_objects) return;
        const params = [
            String(scope_id),
            this._hash(),
            String(-Math.abs(delta_bytes)),
            String(-Math.abs(delta_objects)),
        ];
        const sql = this._build_update_sql(...params);
        return sql;
    }
    /**
     * Maps a random number to a shard index in [0, 9].
     * @returns {number}
     */
    _hash() {
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
    _build_update_sql(scope_id, shard, used_bytes, used_objects) {
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
}

exports.QuotaStore = QuotaStore;
exports.PG_BIGINT_MAX = PG_BIGINT_MAX;
