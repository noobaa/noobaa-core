/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const auth_server = require('../common_services/auth_server');
const system_store = require('../system_services/system_store').get_instance();
const vector_utils = require('../../util/vectors_util');


class VectorBucketsReindexer {
    constructor({client, name}) {
        this.name = name;
        this.client = client;
    }

    async run_batch() {
        dbg.log0('Vector Bucket Reindexer: BEGIN');
        if (!system_store.is_finished_initial_load) {
            dbg.log0('waiting for system store to load');
            return;
        }
        if (!system_store.data.systems[0]) {
            dbg.log0('system does not exist, skipping');
            return;
        }

        if (!system_store.data.vector_indices) {
            dbg.log0("Vector Bucket Reindexer: no vector indices.");
            return config.REINDEX_VECTOR_BUCKETS_DELAY;
        }

        for (const vi of system_store.data.vector_indices) {
            dbg.log0("vi.name =", vi.name, ", vi.rows_since_index =", vi.rows_since_index);

            if (vi.rows_since_index > config.VECTOR_INDEX_ROWS_REINDEX) {

                try {
                    await this.client.bucket.update_rows_since_index({
                        vector_bucket_name: vi.vector_bucket.name,
                        vector_index_name: vi.name,
                        op: 'SET',
                        value: 0
                    }, {
                        auth_token: auth_server.make_auth_token({
                            system_id: system_store.data.systems[0]._id,
                            account_id: system_store.data.systems[0].owner._id,
                            role: 'admin'
                        })
                    });

                    vector_utils.reindex(vi.vector_bucket, vi);
                } catch (e) {
                    //swallow errors, continue to next vi
                    dbg.error("Failed to reindex", vi.name, ", e =", e);
                }
            }
        }

        dbg.log0('Vector Bucket Reindexer: END. ');

        return config.REINDEX_VECTOR_BUCKETS_DELAY;
    }
}

// EXPORTS
exports.VectorBucketsReindexer = VectorBucketsReindexer;
