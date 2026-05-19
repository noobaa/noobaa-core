/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const auth_server = require('../common_services/auth_server');
const system_store = require('../system_services/system_store').get_instance();
const vector_utils = require('../../util/vectors_util');
const { get_process_fs_context } = require('../../util/native_fs_utils');
const { ConfigFS } = require('../../sdk/config_fs');
const SensitiveString = require('../../util/sensitive_string');

class VectorBucketsReindexer {
    constructor({client, nsfs_config_root, name}) {
        this.name = name;
        this.client = client; //containerized env
        if (nsfs_config_root) { //NC env
            const fs_context = get_process_fs_context(
            config.NSFS_NC_CONFIG_DIR_BACKEND,
            config.NSFS_WARN_THRESHOLD_MS,
            );

            this.config_fs = new ConfigFS(nsfs_config_root, config.NSFS_NC_CONFIG_DIR_BACKEND, fs_context);
        }
    }

    async run_batch() {
        dbg.log0('Vector Bucket Reindexer: BEGIN');
        if (this.client) {
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
                await this.handle_single_vi(vi);
            }
        } else {
            const vb_names = await this.config_fs.list_vector_buckets();
            for (const vb_name of vb_names) {
                const vb = await this.config_fs.get_vector_bucket_by_name(vb_name);
                //vector utils expects name to be SensitiveString
                vb.name = new SensitiveString(vb_name);
                const vi_names = await this.config_fs.list_vector_indexes(vb_name);
                for (const vi_name of vi_names) {
                    const vi = await this.config_fs.get_vector_index_by_name(vb_name, vi_name);
                    vi.name = new SensitiveString(vi_name);
                    await this.handle_single_vi(vi, vb);
                }
            }
        }

        dbg.log0('Vector Bucket Reindexer: END. ');

        return config.REINDEX_VECTOR_BUCKETS_DELAY;
    }

    async handle_single_vi(vi, vb) {

        dbg.log0("vi.name =", vi.name, ", vi.rows_since_index =", vi.rows_since_index);

        if (vi.rows_since_index > config.VECTOR_INDEX_ROWS_REINDEX) {

            try {
                if (this.client) {
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
                } else {
                    vi.rows_since_index = 0;
                    await this.config_fs.update_vector_index_config_file(vi);
                }

                vector_utils.reindex(vb || vi.vector_bucket, vi).catch(e =>
                        dbg.error("Failed to reindex", vi.name, ", e =", e)
                );
            } catch (e) {
                //swallow errors, continue to next vi
                dbg.error("Failed to reindex", vi.name, ", e =", e);
            }
        }
    }
}

// EXPORTS
exports.VectorBucketsReindexer = VectorBucketsReindexer;
