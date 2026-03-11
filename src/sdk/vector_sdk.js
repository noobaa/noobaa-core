/* Copyright (C) 2026 NooBaa */
'use strict';

const vector_utils = require("../util/vectors_util");

const dbg = require('../util/debug_module')(__filename);

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
    // VECTORS              //
    //////////////////////////

    async create_vector_bucket(params) {
        const bs = this._get_bucketspace();
        return await bs.create_vector_bucket(params);
    }

    async delete_vector_bucket(params) {
        const bs = this._get_bucketspace();
        return await bs.delete_vector_bucket(params);
    }

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

    async get_index(params) {
        return await vector_utils.get_index(params);
    }

    async list_indexes(params) {
        return await vector_utils.list_indexes(params);
    }

    async list_vector_buckets(params) {
        const bs = this._get_bucketspace();
        const res = await bs.list_vector_buckets(params);
        dbg.log0("list_vector_buckets res =", res);
        return res;
    }

}

module.exports = VectorSDK;
