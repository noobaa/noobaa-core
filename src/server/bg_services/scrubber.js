/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('../object_services/md_store').MDStore;
const map_server = require('../object_services/map_server');
const { MapBuilder } = require('../object_services/map_builder');
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');

/**
 *
 * BUILD_CHUNKS_WORKER
 *
 * background worker that scans chunks and builds them according to their blocks status
 *
 * @this {Object} worker instance
 *
 */
async function background_worker() {
    if (!system_store.is_finished_initial_load) {
        dbg.log0('SCRUBBER: system_store did not finish initial load');
        return;
    }
    const system = system_store.data.systems[0];
    if (!system || system_utils.system_in_maintenance(system._id)) return;

    if (!this.marker) {
        dbg.log0('SCRUBBER:', 'BEGIN');
    }

    try {
        const { chunk_ids, marker } = await MDStore.instance().iterate_all_chunks(this.marker, config.SCRUBBER_BATCH_SIZE);
        // update the marker for next time
        this.marker = marker;
        if (chunk_ids.length) {
            dbg.log1('SCRUBBER:', 'WORKING ON', chunk_ids.length, 'CHUNKS');
            const builder = new MapBuilder(chunk_ids);
            await builder.run();
        }

        // return the delay before next batch
        if (this.marker) {
            dbg.log1('SCRUBBER:', 'CONTINUE', this.marker, this.marker.getTimestamp());
            return config.SCRUBBER_BATCH_DELAY;
        } else {
            dbg.log0('SCRUBBER:', 'END');
            return config.SCRUBBER_RESTART_DELAY;
        }

    } catch (err) {
        // return the delay before next batch
        dbg.error('SCRUBBER:', 'ERROR', err, err.stack);
        return config.SCRUBBER_ERROR_DELAY;
    }
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
async function build_chunks(req) {
    const chunk_ids = _.map(req.rpc_params.chunk_ids, id => MDStore.instance().make_md_id(id));
    const tier = req.rpc_params.tier && system_store.data.get_by_id(req.rpc_params.tier);
    const evict = req.rpc_params.evict;
    const builder = new MapBuilder(chunk_ids, tier, evict);
    await builder.run();
}

async function make_room_in_tier(req) {
    return map_server.make_room_in_tier(req.rpc_params.tier, req.rpc_params.bucket);
}


// EXPORTS
exports.background_worker = background_worker;
exports.build_chunks = build_chunks;
exports.make_room_in_tier = make_room_in_tier;
