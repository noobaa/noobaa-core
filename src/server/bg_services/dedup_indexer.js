/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('../object_services/md_store').MDStore;
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');

// dbg.set_module_level(5);

/**
 *
 * DEDUP_INDEXER
 *
 * background worker that validates the chunk collection's dedup_key index size in not too big to fit in RAM
 *
 * @this worker instance
 *
 */
function background_worker() {
    if (!system_store.is_finished_initial_load) {
        dbg.log0('DEDUP_INDEXER: system_store did not finish initial load');
        return;
    }
    const system = system_store.data.systems[0];
    if (!system || system_utils.system_in_maintenance(system._id)) return;

    let chunk_ids = [];

    return P.resolve()
        .then(() => {
            if (this.last_check && Date.now() - this.last_check < config.DEDUP_INDEXER_CHECK_INDEX_CYCLE) return;
            dbg.log0('DEDUP_INDEXER: checking index size ...');
            return Promise.all([
                    MDStore.instance().get_dedup_index_size(),
                    MDStore.instance().get_aprox_dedup_keys_number()
                ])
                .then(([dedup_index_size, dedup_aprox_keys]) => {
                    dbg.log0('DEDUP_INDEXER: dedup_index_size', dedup_index_size, 'dedup_aprox_keys', dedup_aprox_keys);
                    this.last_check = Date.now();
                    this.dedup_index_size = dedup_index_size;
                    this.dedup_keys_count = dedup_aprox_keys;
                });
        })
        .then(() => {
            dbg.log1('DEDUP_INDEXER: the index size is', this.dedup_index_size);

            if (this.dedup_keys_count < config.DEDUP_INDEXER_LOW_KEYS_NUMBER) {
                dbg.log0('DEDUP_INDEXER: the index keys number is smaller than', config.DEDUP_INDEXER_LOW_KEYS_NUMBER, ' - nothing to do');
                // return the delay before next batch
                this.marker = undefined;
                return;
            }

            const batch_size = config.DEDUP_INDEXER_BATCH_SIZE;
            return MDStore.instance().iterate_indexed_chunks(batch_size, this.marker);
        })
        .then(res => {
            if (!res || !res.chunk_ids || !res.chunk_ids.length) {
                this.marker = undefined;
                return;
            }
            this.marker = res.marker;
            dbg.log1('DEDUP_INDEXER:', 'WORKING ON', res.chunk_ids.length, 'CHUNKS');
            const ignore_back_time = Date.now() - config.DEDUP_INDEXER_IGNORE_BACK_TIME;
            chunk_ids = res.chunk_ids.filter(id => (id.getTimestamp().getTime() < ignore_back_time));
            if (!chunk_ids.length) return;

            dbg.log1('DEDUP_INDEXER:', 'not_last_week_res', chunk_ids.length);
            return MDStore.instance().find_parts_chunks_references(chunk_ids);
        })
        .then(parts_by_chunk_id => {
            if (parts_by_chunk_id) {
                chunk_ids = chunk_ids.filter(
                    chunk_id => !parts_by_chunk_id[chunk_id] || parts_by_chunk_id[chunk_id].length <= 1
                );
            }
            if (!chunk_ids.length) return;

            dbg.log1('DEDUP_INDEXER:', 'chunk_ids_to_deindex', chunk_ids.length);
            dbg.log1('DEDUP_INDEXER:', 'marker', this.marker);
            return MDStore.instance().update_chunks_by_ids(
                chunk_ids, undefined, { dedup_key: true }
            );
        })
        .then(() => {
            if (this.marker) {
                return config.DEDUP_INDEXER_BATCH_DELAY;
            } else {
                dbg.log0('DEDUP_INDEXER:', 'RESTART');
                return config.DEDUP_INDEXER_RESTART_DELAY;
            }
        })
        .catch(err => {
            dbg.error('DEDUP_INDEXER:', 'ERROR', err, err.stack);
            return config.DEDUP_INDEXER_ERROR_DELAY;
        });
}

// EXPORTS
exports.background_worker = background_worker;
