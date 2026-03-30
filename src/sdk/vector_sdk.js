/* Copyright (C) 2026 NooBaa */
'use strict';

const _ = require('lodash');

const vector_utils = require("../util/vectors_util");

class VectorSDK {


    /**
     * @param {{
     *      bucketspace?: nb.BucketSpace;
     * }} args
     */
    constructor({ bucketspace }) {
        this.bucketspace = bucketspace;
    }

    /**
     * @returns {nb.BucketSpace}
     */
    _get_bucketspace() {
        return this.bucketspace;
    }

    //load the vector bucket and index (if handling the op requries it)
    async load_vector_bucket_and_index(req, op) {
        if (!op.load_vector_bucket) return;
        const params = {
            vector_bucket_name: req.body.vectorBucketName
        };
        req.vector_bucket = await this.get_vector_bucket(params);
        if (!op.load_vector_index) return;
        params.vector_index_name = req.body.indexName;
        req.vector_index = await this.get_vector_index(params);
    }

    //////////////////////////
    // VECTOR BUCKETS       //
    //////////////////////////

    async create_vector_bucket(params) {
        const bs = this._get_bucketspace();
        await bs.create_vector_bucket(params);
        await vector_utils.create_vector_bucket(params);
    }

    async get_vector_bucket(params) {
        const bs = this._get_bucketspace();
        return await bs.get_vector_bucket(params);
    }

    async delete_vector_bucket(params) {
        const bs = this._get_bucketspace();
        await bs.delete_vector_bucket(params);
        await vector_utils.delete_vector_bucket(params);
    }

    async list_vector_buckets(params) {
        const bs = this._get_bucketspace();
        const res = await bs.list_vector_buckets(params);
        return res;
    }

    //////////////////////////
    // VECTOR INDICES       //
    //////////////////////////

    async create_vector_index(params) {
        const bs = this._get_bucketspace();
        await bs.create_vector_index(params);
        await vector_utils.create_vector_index(params);
    }

    async get_vector_index(params) {
        const bs = this._get_bucketspace();
        return await bs.get_vector_index(params);
    }

    async list_vector_indices(params) {
        const bs = this._get_bucketspace();
        return await bs.list_vector_indices(params);
    }

    async delete_vector_index(params) {
        const bs = this._get_bucketspace();
        await bs.delete_vector_index(params);
        await vector_utils.delete_vector_index(params);
    }

    //////////////////////////
    // VECTORS              //
    //////////////////////////

    async put_vectors(params) {
        params.vector_index = await this.get_vector_index(_.pick(params, 'vector_bucket_name', 'vector_index_name'));
        return await vector_utils.put_vectors(params);
    }

    async list_vectors(params) {
        return await vector_utils.list_vectors(params);
    }

    async delete_vectors(params) {
        await vector_utils.delete_vectors(params);
    }

    async query_vectors(params) {
        return await vector_utils.query_vectors(params);
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
