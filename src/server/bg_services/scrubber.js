/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('../object_services/md_store').MDStore;
const map_builder = require('../object_services/map_builder');
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');


/**
 *
 * BUILD_CHUNKS_WORKER
 *
 * background worker that scans chunks and builds them according to their blocks status
 *
 * @this worker instance
 *
 */
function background_worker() {
    if (!system_store.is_finished_initial_load) {
        dbg.log0('SCRUBBER: system_store did not finish initial load');
        return;
    }
    const system = system_store.data.systems[0];
    if (!system || system_utils.system_in_maintenance(system._id)) return;

    if (!this.marker) {
        dbg.log0('SCRUBBER:', 'BEGIN');
    }

    return MDStore.instance().iterate_all_chunks(this.marker, config.SCRUBBER_BATCH_SIZE)
        .then(res => {
            // update the marker for next time
            this.marker = res.marker;
            if (!res.chunk_ids.length) return;
            dbg.log0('SCRUBBER:', 'WORKING ON', res.chunk_ids.length, 'CHUNKS');
            const builder = new map_builder.MapBuilder();
            return builder.run(res.chunk_ids);
        })
        .then(() => {
            // return the delay before next batch
            if (this.marker) {
                dbg.log0('SCRUBBER:', 'CONTINUE', this.marker, this.marker.getTimestamp());
                return config.SCRUBBER_BATCH_DELAY;
            }
            dbg.log0('SCRUBBER:', 'END');
            return config.SCRUBBER_RESTART_DELAY;
        })
        .catch(err => {
            // return the delay before next batch
            dbg.error('SCRUBBER:', 'ERROR', err, err.stack);
            return config.SCRUBBER_ERROR_DELAY;
        });
}

/**
 * 
 * Scrubber RPC API to build chunks
 * 
 * This is meant to be the only way to run MapBuilder by any non-scrubber creatures
 * such as the nodes monitor or other modules that will need it in the future.
 * 
 * The reason they need to call the scrubber to do it is that we want MapBuilder's builder_lock 
 * to prevent concurrent rebuild of the same chunk in concurrency.
 * 
 */
function build_chunks(req) {
    return P.resolve()
        .then(() => {
            const chunk_ids = _.map(req.rpc_params.chunk_ids, id => MDStore.instance().make_md_id(id));
            const tier = req.rpc_params.tier && system_store.data.get_by_id(req.rpc_params.tier);
            const builder = new map_builder.MapBuilder();
            return builder.run(chunk_ids, tier);
        })
        .return();
}


// EXPORTS
exports.background_worker = background_worker;
exports.build_chunks = build_chunks;
