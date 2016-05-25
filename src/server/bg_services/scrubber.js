'use strict';

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const md_store = require('../object_services/md_store');
const map_builder = require('../object_services/map_builder');

/**
 *
 * BUILD_CHUNKS_WORKER
 *
 * background worker that scans chunks and builds them according to their blocks status
 *
 */
function background_worker() {
    /* jshint validthis: true */
    var self = this;
    return P.fcall(function() {
            var now = Date.now();
            var query = {
                $and: [{
                    $or: [{
                        last_build: null
                    }, {
                        last_build: {
                            $lt: new Date(now - self.time_since_last_build)
                        }
                    }]
                }, {
                    $or: [{
                        building: null
                    }, {
                        building: {
                            $lt: new Date(now - self.building_timeout)
                        }
                    }]
                },
                //ignore old chunks without buckets
                {
                    bucket: {
                        $exists: true
                    }
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

            return P.when(md_store.DataChunk.find(query)
                .limit(self.batch_size)
                .sort('-_id')
                .lean()
                .exec());
            // return P.when(md_store.DataChunk.collection.find(query, {
            //     limit: self.batch_size,
            //     sort: {
            //         _id: -1
            //     }
            // }).toArray());
        })
        .then(function(chunks) {

            // update the last_chunk_id for next time
            if (chunks.length === self.batch_size) {
                self.last_chunk_id = chunks[0]._id;
            } else {
                self.last_chunk_id = undefined;
            }

            if (chunks.length) {
                dbg.log0('SCRUBBER:', 'WORKING ON', chunks.length, 'CHUNKS');
                let builder = new map_builder.MapBuilder(chunks);
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
                return 100;
            } else {
                dbg.log0('SCRUBBER:', 'END');
                return 60000;
            }
        }, function(err) {
            // return the delay before next batch
            dbg.error('SCRUBBER:', 'ERROR', err, err.stack);
            return 10000;
        });
}


// EXPORTS
exports.background_worker = background_worker;
