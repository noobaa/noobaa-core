'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var db = require('../db');
var dbg = require('../../util/debug_module')(__filename);
var config = require('../../../config.js');
var js_utils = require('../../util/js_utils');
var time_utils = require('../../util/time_utils');
var range_utils = require('../../util/range_utils');
var mongo_utils = require('../../util/mongo_utils');
// var chunk_builder = require('./chunk_builder');
var policy_allocator = require('./policy_allocator');
var block_allocator = require('./block_allocator');
var nodes_store = require('../stores/nodes_store');


module.exports = MappingAllocator;

/**
 *
 * The mapping allocation flow
 *
 */
function MappingAllocator(bucket, obj, parts) {
    this.bucket = bucket;
    this.obj = obj;
    this.parts = parts;
    this.existing_parts = null;
    this.existing_chunks = [];
    this.digest_to_chunk = {};
    this.new_blocks = [];
    this.new_chunks = [];
    this.new_parts = [];
    this.reply = {
        parts: _.map(parts, function(part) {
            // checking that parts size does not exceed the max
            // which allows the read path to limit range scanning
            if (part.end - part.start > config.MAX_OBJECT_PART_SIZE) {
                throw new Error('allocate_object_parts: PART TOO BIG ' +
                    range_utils.human_range(part));
            }
            // create empty object for each part for the reply
            return {};
        })
    };
    js_utils.self_bind(this);
}

MappingAllocator.prototype.run = function() {
    var self = this;
    var millistamp = time_utils.millistamp();
    dbg.log1('MappingAllocator.run: start');
    return P.join(
            P.fcall(self.load_existing_parts),
            P.fcall(self.find_dups))
        .then(self.load_blocks_for_existing_chunks)
        .then(self.analyze_existing_chunks_status)
        .then(self.call_allocation)
        .then(self.update_db_on_alloc)
        .then(function() {
            dbg.log0('MappingAllocator.run: DONE. took',
                time_utils.millitook(millistamp)/*, util.inspect(self.reply, {
                    depth: null
                })*/);
            return self.reply;
        }, function(err) {
            dbg.error('MappingAllocator.run: ERROR', err.stack || err);
            throw err;
        });

};

/**
 * find the parts already exists from previous attempts that will be removed.
 * their chunks will be used though.
 */
MappingAllocator.prototype.load_existing_parts = function() {
    var self = this;
    return find_consecutive_parts(self.obj, self.parts)
        .then(mongo_utils.populate('chunk', db.DataChunk))
        .then(function(existing_parts) {
            self.existing_parts = existing_parts;
            _.each(existing_parts, function(part) {
                if (part.chunk) {
                    self.existing_chunks.push(part.chunk);
                }
            });
        });
};

MappingAllocator.prototype.find_dups = function() {
    var self = this;
    // dedup with existing chunks by lookup of the digest of the data
    if (process.env.DEDUP_DISABLED === 'true') return;
    return P.when(db.DataChunk.collection.find({
            system: self.obj.system,
            bucket: self.bucket._id,
            digest_b64: {
                $in: _.uniq(_.map(self.parts, function(part) {
                    return part.chunk.digest_b64;
                }))
            },
            deleted: null,
            building: null
        }).toArray())
        .then(function(dup_chunks) {
            js_utils.array_push_all(self.existing_chunks, dup_chunks);
        });
};

MappingAllocator.prototype.load_blocks_for_existing_chunks = function() {
    var self = this;
    dbg.log1('load_blocks_for_existing_chunks');
    var chunks_ids = mongo_utils.uniq_ids(self.existing_chunks, '_id');
    if (!chunks_ids.length) return;
    return P.when(db.DataBlock.collection.find({
            chunk: {
                $in: chunks_ids
            },
            deleted: null,
        }).toArray())
        .then(nodes_store.populate_nodes('node'))
        .then(function(blocks) {
            dbg.log0('load_blocks_for_existing_chunks', blocks.length);
            self.blocks_by_chunk_id = _.groupBy(blocks, 'chunk');
            return _.each(self.existing_chunks, function(chunk) {
                chunk.all_blocks = self.blocks_by_chunk_id[chunk._id];
            });
        });
};

MappingAllocator.prototype.analyze_existing_chunks_status = function() {
    var self = this;
    return P.map(self.existing_chunks, function(chunk) {
        return P.when(policy_allocator.get_pools_groups(chunk.bucket))
            .then(function(pools) {
                return P.when(policy_allocator.analyze_chunk_status_on_pools(chunk, chunk.all_blocks, pools));
            })
            .then(function(cstatus) {
                chunk.chunk_status = cstatus;
                var prev = self.digest_to_chunk[chunk.digest_b64];
                if (prev) {
                    dbg.log1('find_dups_and_existing_parts: already found chunk for digest', prev, chunk);
                } else if (chunk.chunk_status.chunk_health === 'unavailable') {
                    dbg.log1('find_dups_and_existing_parts: ignore unavailable chunk', chunk);
                } else {
                    self.digest_to_chunk[chunk.digest_b64] = chunk;
                }
            });
    });
};


//Create chunks and parts and call for allocation
MappingAllocator.prototype.call_allocation = function() {
    var self = this;
    var millistamp = time_utils.millistamp();
    return P.map(self.parts, function(part, i) {
            var reply_part = self.reply.parts[i];
            var dup_chunk = self.digest_to_chunk[part.chunk.digest_b64];

            dbg.log1('call_allocation: allocate part',
                part.start, part.end, part.part_sequence_number,
                'dup_chunk', dup_chunk);
            if (dup_chunk) {
                part.db_chunk = dup_chunk;
                reply_part.dedup = true;
            } else {
                part.db_chunk = /*new db.DataChunk*/ (_.extend({
                    _id: db.new_object_id(),
                    system: self.obj.system,
                    bucket: self.bucket._id,
                    building: new Date(),
                }, part.chunk));
                self.new_chunks.push(part.db_chunk);
            }

            // create a new part
            part.db_part = /*new db.ObjectPart*/ ({
                _id: db.new_object_id(),
                system: self.obj.system,
                obj: self.obj._id,
                start: part.start,
                end: part.end,
                part_sequence_number: part.part_sequence_number,
                upload_part_number: part.upload_part_number || 0,
                chunk: part.db_chunk
            });
            self.new_parts.push(part.db_part);

            if (reply_part.dedup) {
                dbg.log3('call_allocation: using dup chunk');
                return;
            }

            // Chunk is not available, create a new fragment on it
            dbg.log2('call_allocation: chunk is unavailable,',
                'allocating new block for it', part.db_chunk);
            var avoid_nodes = _.map(part.db_chunk.all_blocks, function(block) {
                return block.node._id.toString();
            });
            return P.map(part.frags, function(fragment) {
                    return P.when(policy_allocator.get_pools_groups(part.db_chunk.bucket))
                        .then(function(pools) {
                            return policy_allocator.allocate_on_pools(part.db_chunk, avoid_nodes, pools)
                                .then(function(block) {
                                    if (!block) {
                                        throw new Error('call_allocation: no nodes for allocation');
                                    }
                                    block.size = fragment.size;
                                    block.layer = fragment.layer;
                                    block.frag = fragment.frag;
                                    if (fragment.layer_n) {
                                        block.layer_n = fragment.layer_n;
                                    }
                                    block.digest_type = fragment.digest_type;
                                    block.digest_b64 = fragment.digest_b64;
                                    avoid_nodes.push(block.node._id.toString());
                                    self.new_blocks.push(block);
                                    return block;
                                });
                        });
                })
                .then(function(new_blocks_of_chunk) {
                    dbg.log2('call_allocation: part info', part,
                        'chunk', part.db_chunk,
                        'blocks', new_blocks_of_chunk);
                    return P.when(get_part_info({
                            part: part,
                            chunk: part.db_chunk,
                            blocks: new_blocks_of_chunk,
                            building: true
                        }))
                        .then(function(r) {
                            reply_part.part = r;
                        });
                });
        })
        .then(function() {
            dbg.log0('call_allocation DONE took', time_utils.millitook(millistamp));
        });
};

MappingAllocator.prototype.update_db_on_alloc = function() {
    var self = this;
    _.each(self.new_blocks, function(x) {
        x.node = x.node._id;
        x.chunk = x.chunk._id;
    });
    _.each(self.new_parts, function(x) {
        x.obj = db.new_object_id(x.obj);
        x.chunk = x.chunk._id;
    });
    dbg.log2('update_db_on_alloc: db create blocks', self.new_blocks);
    dbg.log2('update_db_on_alloc: db create chunks', self.new_chunks);
    dbg.log2('update_db_on_alloc: db remove existing parts', self.existing_parts);
    dbg.log2('update_db_on_alloc: db create parts', self.new_parts);
    // we send blocks and chunks to DB in parallel,
    // even if we fail, it will be ignored until someday we reclaim it
    return P.join(
            self.new_blocks.length && P.when(db.DataBlock.collection.insertMany(self.new_blocks)),
            self.new_chunks.length && P.when(db.DataChunk.collection.insertMany(self.new_chunks)),
            self.existing_parts.length && db.ObjectPart.collection.updateMany({
                _id: {
                    $in: _.map(self.existing_parts, '_id')
                }
            }, {
                $set: {
                    deleted: new Date()
                }
            })
        )
        .then(function() {
            return self.new_parts.length && P.when(db.ObjectPart.collection.insertMany(self.new_parts));
        });
};


function find_consecutive_parts(obj, parts) {
    var start = parts[0].start;
    var end = parts[parts.length - 1].end;
    var upload_part_number = parts[0].upload_part_number;
    var pos = start;
    _.each(parts, function(part) {
        if (pos !== part.start) {
            throw new Error('expected parts to be consecutive');
        }
        if (upload_part_number !== part.upload_part_number) {
            throw new Error('expected parts to have same upload_part_number');
        }
        pos = part.end;
    });
    return P.when(db.ObjectPart.collection.find({
        system: obj.system,
        obj: obj._id,
        upload_part_number: upload_part_number,
        start: {
            // since end is not indexed we query start with both
            // low and high constraint, which allows the index to reduce scan
            $gte: start,
            $lte: end
        },
        end: {
            $lte: end
        },
        deleted: null
    }, {
        sort: 'start'
    }).toArray());
}


function get_part_info(params) {
    return P.when(policy_allocator.get_pools_groups(params.chunk.bucket))
        .then(function(pools) {
            return P.when(policy_allocator.analyze_chunk_status_on_pools(params.chunk, params.blocks, pools))
                .then(function(chunk_status) {
                    var p = _.pick(params.part, 'start', 'end');

                    p.chunk = _.pick(params.chunk,
                        'size',
                        'digest_type',
                        'digest_b64',
                        'compress_type',
                        'compress_size',
                        'cipher_type',
                        'cipher_key_b64',
                        'cipher_iv_b64',
                        'cipher_auth_tag_b64',
                        'data_frags',
                        'lrc_frags');
                    p.part_sequence_number = params.part.part_sequence_number;
                    if (params.upload_part_number) {
                        p.upload_part_number = params.upload_part_number;
                    }
                    if (params.set_obj) {
                        p.obj = params.part.obj;
                    }
                    if (params.part.chunk_offset) {
                        p.chunk_offset = params.part.chunk_offset;
                    }

                    p.frags = _.map(chunk_status.frags, function(fragment) {
                        var blocks = params.building && fragment.building_blocks ||
                            // params.adminfo && fragment.blocks ||
                            fragment.accessible_blocks;

                        var part_fragment = _.pick(fragment, 'layer', 'layer_n', 'frag', 'size');

                        // take the digest from some block.
                        // TODO better check that the rest of the blocks match...
                        if (fragment.blocks[0]) {
                            part_fragment.digest_type = fragment.blocks[0].digest_type;
                            part_fragment.digest_b64 = fragment.blocks[0].digest_b64;
                        } else {
                            part_fragment.digest_type = '';
                            part_fragment.digest_b64 = '';
                        }

                        part_fragment.blocks = _.map(blocks, function(block) {
                            return {
                                block_md: block_allocator.get_block_md(block),
                            };
                        });
                        return part_fragment;
                    });

                    return p;
                });
        });
}
