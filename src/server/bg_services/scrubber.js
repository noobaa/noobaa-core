'use strict';

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const md_store = require('../object_services/md_store');
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
        dbg.log0('System did not finish initial load');
        return;
    }

    const system = system_store.data.systems[0];
    if (!system || system_server_utils.system_in_maintenance(system._id)) return;

    var self = this;
    return P.fcall(function() {
            var now = Date.now();
            var query = {
                $and: [{
                    $or: [{
                        last_build: null
                    }, {
                        last_build: {
                            $lt: new Date(now - config.REBUILD_LAST_BUILD_BACKOFF)
                        }
                    }]
                }, {
                    $or: [{
                        building: null
                    }, {
                        building: {
                            $lt: new Date(now - config.REBUILD_BUILDING_MODE_BACKOFF)
                        }
                    }]
                }]
            };
            if (self.last_chunk_id) {
                query._id = {
                    $lt: self.last_chunk_id
                };
            } else {
                dbg.log0('SCRUBBER:', 'BEGIN');
            }
            query.deleted = null;

            return P.resolve(md_store.DataChunk.find(query)
                .select('_id')
                .limit(config.REBUILD_BATCH_SIZE)
                .sort('-_id')
                .lean()
                .exec());
        })
        .then(function(chunk_ids) {

            // update the last_chunk_id for next time
            if (chunk_ids.length === config.REBUILD_BATCH_SIZE) {
                self.last_chunk_id = chunk_ids[0];
            } else {
                self.last_chunk_id = undefined;
            }

            if (chunk_ids.length) {
                dbg.log0('SCRUBBER:', 'WORKING ON', chunk_ids.length, 'CHUNKS');
                let builder = new map_builder.MapBuilder(chunk_ids);
                return builder.run()
                    .catch(function(err) {
                        dbg.error('SCRUBBER:', 'BUILD ERROR', err, err.stack);
                    });
            }
        })
        .then(function() {
            // return the delay before next batch
            if (self.last_chunk_id) {
                dbg.log0('SCRUBBER:', 'CONTINUE', self.last_chunk_id);
                return config.REBUILD_BATCH_DELAY;
            } else {
                dbg.log0('SCRUBBER:', 'END');
                return config.SCRUBBER_RESTART_DELAY;
            }
        }, function(err) {
            // return the delay before next batch
            dbg.error('SCRUBBER:', 'ERROR', err, err.stack);
            return config.REBUILD_BATCH_ERROR_DELAY;
        });
}


// EXPORTS
exports.background_worker = background_worker;
