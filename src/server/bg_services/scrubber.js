/* Copyright (C) 2016 NooBaa */
'use strict';

// const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('../object_services/md_store').MDStore;
const map_builder = require('../object_services/map_builder');
const system_store = require('../system_services/system_store').get_instance();
const system_server_utils = require('../utils/system_server_utils');


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
    if (!system || system_server_utils.system_in_maintenance(system._id)) return;

    if (!this.marker) {
        dbg.log0('SCRUBBER:', 'BEGIN');
    }

    return MDStore.instance().iterate_all_chunks(this.marker, config.REBUILD_BATCH_SIZE)
        .then(res => {
            // update the marker for next time
            this.marker = res.marker;
            if (!res.chunk_ids.length) return;
            dbg.log0('SCRUBBER:', 'WORKING ON', res.chunk_ids.length, 'CHUNKS');
            const builder = new map_builder.MapBuilder(res.chunk_ids);
            return builder.run()
                .catch(err => dbg.error('SCRUBBER:', 'BUILD ERROR', err, err.stack));
        })
        .then(() => {
            // return the delay before next batch
            if (this.marker) {
                dbg.log0('SCRUBBER:', 'CONTINUE', this.marker);
                return config.REBUILD_BATCH_DELAY;
            }
            dbg.log0('SCRUBBER:', 'END');
            return config.SCRUBBER_RESTART_DELAY;
        }, err => {
            // return the delay before next batch
            dbg.error('SCRUBBER:', 'ERROR', err, err.stack);
            return config.REBUILD_BATCH_ERROR_DELAY;
        });
}


// EXPORTS
exports.background_worker = background_worker;
