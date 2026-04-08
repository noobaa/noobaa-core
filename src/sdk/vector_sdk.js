/* Copyright (C) 2026 NooBaa */
'use strict';

const vector_utils = require("../util/vectors_util");
const LRUCache = require('../util/lru_cache');
const config = require('../../config');

const vector_bucket_cache = new LRUCache({
    name: 'VectorBucketCache',
    expiry_ms: config.VECTORS_CACHE_DURATION,
    make_key: ({ params, account_id }) => params.vector_bucket_name + account_id,
    load: async ({ vector_sdk, params }) => vector_sdk.get_vector_bucket(params),
});

const vector_index_cache = new LRUCache({
    name: 'VectorIndexCache',
    expiry_ms: config.VECTORS_CACHE_DURATION,
    make_key: ({ params, account_id }) => params.vector_bucket_name + params.vector_index__name + account_id,
    load: async ({ vector_sdk, params }) => vector_sdk.get_vector_index(params),
});

class VectorSDK {

    constructor({ bucketspace, req }) {
        this.bucketspace = bucketspace;
        this.req = req;
    }

    /**
     * @returns {nb.BucketSpace}
     */
    _get_bucketspace() {
        return this.bucketspace;
    }

    //load the vector bucket and index (if handling the op requries it)
    async load_vector_bucket_and_index(op) {
        if (!op.load_vector_bucket) return;
        const params = {
            vector_bucket_name: this.req.body.vectorBucketName
        };
        this.req.vector_bucket = await vector_bucket_cache.get_with_cache({
            vector_sdk: this,
            account_id: this.req.object_sdk.requesting_account._id,
            params
        });
        if (!op.load_vector_index) return;
        params.vector_index_name = this.req.body.indexName;
        this.req.vector_index = await vector_index_cache.get_with_cache({
            vector_sdk: this,
            account_id: this.req.object_sdk.requesting_account._id,
            params,
        });
    }

    //////////////////////////
    // VECTOR BUCKETS       //
    //////////////////////////

    async create_vector_bucket(params) {
        const bs = this._get_bucketspace();
        await bs.create_vector_bucket(params, this.req.object_sdk);
    }

    async get_vector_bucket(params) {
        const bs = this._get_bucketspace();
        return await bs.get_vector_bucket(params, this.req.object_sdk);
    }

    async delete_vector_bucket(params) {
        const bs = this._get_bucketspace();
        await bs.delete_vector_bucket(params, this.req.object_sdk);
        vector_utils.delete_vector_bucket(this.req.vector_bucket);
        vector_bucket_cache.invalidate({
            params,
            account_id: this.req.object_sdk.requesting_account._id,
        });
    }

    async list_vector_buckets(params) {
        const bs = this._get_bucketspace();
        const res = await bs.list_vector_buckets(params, this.req.object_sdk);
        return res;
    }

    //////////////////////////
    // VECTOR INDICES       //
    //////////////////////////

    async create_vector_index(params) {
        const bs = this._get_bucketspace();
        await bs.create_vector_index(params, this.req.object_sdk);
        await vector_utils.create_vector_index(this.req.vector_bucket, this.req.vector_index, params);
    }

    async get_vector_index(params) {
        const bs = this._get_bucketspace();
        return await bs.get_vector_index(params, this.req.object_sdk);
    }

    async list_vector_indices(params) {
        const bs = this._get_bucketspace();
        return await bs.list_vector_indices(params, this.req.object_sdk);
    }

    async delete_vector_index(params) {
        const bs = this._get_bucketspace();
        await bs.delete_vector_index(params, this.req.object_sdk);
        await vector_utils.delete_vector_index(this.req.vector_bucket, this.req.vector_index);
        vector_index_cache.invalidate({
            params,
            account_id: this.req.object_sdk.requesting_account._id,
        });
    }

    //////////////////////////
    // VECTORS              //
    //////////////////////////

    async put_vectors(params) {
        return await vector_utils.put_vectors(this.req.vector_bucket, this.req.vector_index, params.vectors);
    }

    async list_vectors(params) {
        return await vector_utils.list_vectors(this.req.vector_bucket, this.req.vector_index, params);
    }

    async delete_vectors(params) {
        await vector_utils.delete_vectors(this.req.vector_bucket, this.req.vector_index, params.keys);
    }

    async query_vectors(params) {
        return await vector_utils.query_vectors(this.req.vector_bucket, this.req.vector_index, params);
    }

    //////////////////////////////
    // VECTOR BUCKET POLICY     //
    //////////////////////////////

    async put_vector_bucket_policy(params) {
        const bs = this._get_bucketspace();
        return await bs.put_vector_bucket_policy(params);
    }

    async get_vector_bucket_policy(params) {
        const bs = this._get_bucketspace();
        return await bs.get_vector_bucket_policy(params);
    }

    async delete_vector_bucket_policy(params) {
        const bs = this._get_bucketspace();
        return await bs.delete_vector_bucket_policy(params);
    }
}

module.exports = VectorSDK;
