/* Copyright (C) 2026 NooBaa */
'use strict';

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

    //////////////////////////
    // VECTORS BUCKETS      //
    //////////////////////////

    async create_vector_bucket(params) {
        const bs = this._get_bucketspace();
        await bs.create_vector_bucket(params);
        await vector_utils.create_vector_bucket(params);
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
    // VECTORS INDICES      //
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

}

module.exports = VectorSDK;
