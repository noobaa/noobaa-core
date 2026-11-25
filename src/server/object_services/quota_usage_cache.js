/* Copyright (C) 2026 NooBaa */
'use strict';

const config = require('../../../config');
const LRUCache = require('../../util/lru_cache');



/**
 * Object-server cache of quotausages.used_bytes / used_objects.
 *
 * Checks consult this cache instead of SELECTing quotausages on every request.
 * The cache is process-local. It only works because these RPCs run in the
 * object server, not in the S3 endpoint.
 */
const quota_usage_cache = new LRUCache({
    name: 'QuotaUsageCache',
    expiry_ms: config.QUOTA_USAGE_CACHE_EXPIRY_MS,
    max_usage: config.QUOTA_USAGE_CACHE_MAX_ITEMS,
    /**
     * @param {{ scope_id: string }} params
     */
    make_key: params => String(params.scope_id),
    /**
     * @param {{ scope_id: string }} params
     */
    load: async params => {
        // TODO: Quota get used bytes and object from quotausage schema
        // keep bigint values as strings to stay exact above 2^53
        const usage = {
            used_bytes: 0,
            used_objects: 0,
        };
        return {
            used_bytes: String(usage?.used_bytes ?? '0'),
            used_objects: String(usage?.used_objects ?? '0'),
        };
    },
});



exports.quota_usage_cache = quota_usage_cache;
