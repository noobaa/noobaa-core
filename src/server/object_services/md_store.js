/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const moment = require('moment');
const mongodb = require('mongodb');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const map_utils = require('./map_utils');
const mongo_utils = require('../../util/mongo_utils');
const mongo_client = require('../../util/mongo_client');
const nodes_client = require('../node_services/nodes_client');
const mongo_functions = require('../../util/mongo_functions');
const object_md_schema = require('./schemas/object_md_schema');
const object_md_indexes = require('./schemas/object_md_indexes');
const object_part_schema = require('./schemas/object_part_schema');
const object_part_indexes = require('./schemas/object_part_indexes');
const object_multipart_schema = require('./schemas/object_multipart_schema');
const object_multipart_indexes = require('./schemas/object_multipart_indexes');
const data_chunk_schema = require('./schemas/data_chunk_schema');
const data_chunk_indexes = require('./schemas/data_chunk_indexes');
const data_block_schema = require('./schemas/data_block_schema');
const data_block_indexes = require('./schemas/data_block_indexes');


class MDStore {

    constructor(test_suffix = '') {
        this._objects = mongo_client.instance().define_collection({
            name: 'objectmds' + test_suffix,
            schema: object_md_schema,
            db_indexes: object_md_indexes,
        });
        this._multiparts = mongo_client.instance().define_collection({
            name: 'objectmultiparts' + test_suffix,
            schema: object_multipart_schema,
            db_indexes: object_multipart_indexes,
        });
        this._parts = mongo_client.instance().define_collection({
            name: 'objectparts' + test_suffix,
            schema: object_part_schema,
            db_indexes: object_part_indexes,
        });
        this._chunks = mongo_client.instance().define_collection({
            name: 'datachunks' + test_suffix,
            schema: data_chunk_schema,
            db_indexes: data_chunk_indexes,
        });
        this._blocks = mongo_client.instance().define_collection({
            name: 'datablocks' + test_suffix,
            schema: data_block_schema,
            db_indexes: data_block_indexes,
        });
    }

    static instance() {
        if (!MDStore._instance) MDStore._instance = new MDStore();
        return MDStore._instance;
    }

    make_md_id(id_str) {
        return new mongodb.ObjectId(id_str);
    }

    is_valid_md_id(id_str) {
        return mongodb.ObjectId.isValid(id_str);
    }


    /////////////
    // OBJECTS //
    /////////////


    insert_object(info) {
        this._objects.validate(info);
        return this._objects.col().insertOne(info);
    }

    update_object_by_id(obj_id, set_updates, unset_updates, inc_updates) {
        console.log('update_object_by_id:', obj_id, compact_updates(set_updates, unset_updates, inc_updates));
        return this._objects.col().updateOne({
                _id: obj_id
            }, compact_updates(set_updates, unset_updates, inc_updates))
            .then(res => mongo_utils.check_update_one(res, 'object'));
    }

    update_object_by_key(bucket_id, key, set_updates) {
        return this._objects.col().updateOne({
                bucket: bucket_id,
                key: key,
                deleted: null,
            }, compact_updates(set_updates))
            .then(res => mongo_utils.check_update_one(res, 'object'));
    }

    update_objects_by_key_deleted(bucket_id, key, set_updates) {
        return this._objects.col().updateMany({
            bucket: bucket_id,
            key: key,
            deleted: {
                $exists: true
            }
        }, compact_updates(set_updates));
    }

    find_object_by_id(obj_id) {
        return this._objects.col().findOne({
                _id: obj_id,
                deleted: null,
            })
            .then(obj => mongo_utils.check_entity_not_deleted(obj, 'object'));
    }

    find_object_by_key(bucket_id, key) {
        return this._objects.col().findOne(compact({
                bucket: bucket_id,
                key: key,
                deleted: null,
            }))
            .then(obj => mongo_utils.check_entity_not_deleted(obj, 'object'));
    }

    find_object_by_key_allow_missing(bucket_id, key) {
        return this._objects.col().findOne(compact({
            bucket: bucket_id,
            key: key,
            deleted: null,
        }));
    }

    populate_objects(docs, doc_path, fields) {
        return mongo_utils.populate(docs, doc_path, this._objects.col(), fields);
    }

    find_objects({ bucket_id, key, upload_mode, max_create_time, skip, limit, sort, order, pagination }) {
        const query = compact({
            bucket: bucket_id,
            key: key,
            deleted: null,
            create_time: max_create_time ? {
                $lt: new Date(moment.unix(max_create_time).toISOString())
            } : undefined,
            // TODO: Should look at the upload_size or upload_completed?
            // allow filtering of uploading/non-uploading objects
            upload_mode: typeof upload_mode === 'boolean' ? {
                $exists: upload_mode
            } : undefined,
        });

        dbg.log0('list_objects:', query);
        return P.join(
                this._objects.col().find(query, {
                    limit: Math.min(limit, 1000),
                    skip: skip,
                    sort: sort ? {
                        [sort]: (order === -1 ? -1 : 1)
                    } : undefined
                })
                .toArray(),
                pagination ? this._objects.col().count(query) : undefined
            )
            .spread((objects, total_count) => ({
                objects,
                total_count
            }));
    }

    find_objects_by_prefix_and_delimiter({ bucket_id, upload_mode, delimiter, prefix, marker, limit }) {
        // filter keys starting with prefix, *not* followed by marker
        let regexp_text = '^' + prefix;
        if (marker) {
            if (!marker.startsWith(prefix)) {
                throw new Error('BAD MARKER ' + marker + ' FOR PREFIX ' + prefix);
            }
            const marker_suffix = marker.slice(prefix.length);
            if (marker_suffix) {
                regexp_text += '(?!' + marker_suffix + ')';
            }
        }
        const regexp = new RegExp(regexp_text);
        const query = {
            bucket: bucket_id,
            key: {
                $regex: regexp,
                $gt: marker
            },
            deleted: null,
            upload_size: {
                $exists: Boolean(upload_mode)
            }
        };

        if (!delimiter) {
            return this._objects.col().find(query, {
                    limit: limit,
                    sort: {
                        key: 1
                    }
                })
                .toArray()
                .then(res => _.map(res, obj => ({
                    key: obj.key,
                    obj: obj
                })));
        }

        return this._objects.col().mapReduce(
                mongo_functions.map_common_prefixes_and_objects,
                mongo_functions.reduce_common_prefixes_occurrence_and_objects, {
                    query: query,
                    limit: limit,
                    sort: {
                        key: 1
                    },
                    scope: {
                        prefix: prefix,
                        delimiter: delimiter,
                    },
                    out: {
                        inline: 1
                    }
                }
            )
            .then(res => _.map(res, obj => (
                _.isObject(obj.value) ? {
                    key: obj.value.key,
                    obj: obj.value
                } : {
                    key: prefix + obj._id,
                }
            )));
    }

    has_any_objects_in_system(system_id) {
        return this._objects.col().findOne({
                system: system_id,
                deleted: null,
            })
            .then(obj => Boolean(obj));
    }

    has_any_objects_in_bucket(bucket_id) {
        return this._objects.col().findOne({
                bucket: bucket_id,
                deleted: null,
            })
            .then(obj => Boolean(obj));
    }

    count_objects_of_bucket(bucket_id) {
        return this._objects.col().count({
            bucket: bucket_id,
            deleted: null,
        });
    }

    count_objects_per_bucket(system_id) {
        // TODO check which index is needed to cover this aggregation
        return this._objects.col().aggregate([{
                $match: {
                    system: system_id,
                    deleted: null,
                }
            }, {
                $group: {
                    _id: "$bucket",
                    count: {
                        $sum: 1
                    }
                }
            }])
            .toArray()
            .then(res => {
                const buckets = {};
                let total_count = 0;
                _.each(res, r => {
                    total_count += buckets[r._id] = r.count;
                });
                buckets[''] = total_count;
                return buckets;
            });
    }

    aggregate_objects_by_create_dates(from_date, till_date) {
        return this._aggregate_objects_internal({
            create_time: {
                $gte: from_date,
                $lt: till_date,
            }
        });
    }

    aggregate_objects_by_delete_dates(from_date, till_date) {
        return this._aggregate_objects_internal({
            deleted: {
                $gte: from_date,
                $lt: till_date,
            },
            create_time: {
                $exists: true
            }
        });
    }

    /**
     * _aggregate_objects_internal - counts the number of objects and sum of sizes,
     * both for the entire query, and per bucket.
     * @return <Object> buckets - each bucket value is an object with properties: size, count.
     *      the '' key represents the entire query and others are bucket ids.
     */
    _aggregate_objects_internal(query) {
        return this._objects.col().mapReduce(
                mongo_functions.map_aggregate_objects,
                mongo_functions.reduce_sum, {
                    query: query,
                    out: {
                        inline: 1
                    }
                })
            .then(res => {
                const buckets = {};
                _.each(res, r => {
                    const b = buckets[r._id[0]] = buckets[r._id[0]] || {};
                    b[r._id[1]] = r.value;
                });
                return buckets;
            });
    }


    ////////////////
    // CLOUD SYNC //
    ////////////////


    list_all_objects_of_bucket_ordered_by_key(bucket_id) {
        // TODO cloud sync scalability
        return this._objects.col().find({
                bucket: bucket_id,
                deleted: null,
                create_time: {
                    $exists: true
                }
            }, {
                sort: {
                    key: 1
                }
            })
            .toArray();
    }

    list_all_objects_of_bucket_need_sync(bucket_id) {
        // TODO cloud sync scalability
        return this._objects.col().find({
                bucket: bucket_id,
                cloud_synced: false,
                create_time: {
                    $exists: true
                }
            })
            .toArray();
    }

    update_all_objects_of_bucket_set_cloud_sync(bucket_id) {
        // TODO cloud sync scalability
        return this._objects.col().updateMany({
            bucket: bucket_id,
            cloud_synced: false,
            deleted: null,
        }, {
            $set: {
                cloud_synced: true
            }
        });
    }

    update_all_objects_of_bucket_unset_deleted_cloud_sync(bucket_id) {
        // TODO cloud sync scalability
        return this._objects.col().updateMany({
            bucket: bucket_id,
            cloud_synced: true,
            deleted: {
                $exists: true
            },
        }, {
            $set: {
                cloud_synced: false
            }
        });
    }


    ////////////////
    // MULTIPARTS //
    ////////////////

    insert_multipart(multipart) {
        this._multiparts.validate(multipart);
        return this._multiparts.col().insertOne(multipart);

    }

    update_multipart_by_id(multipart_id, set_updates) {
        return this._multiparts.col().updateOne({
                _id: multipart_id,
            }, compact_updates(set_updates))
            .then(res => mongo_utils.check_update_one(res, 'multipart'));
    }

    find_multipart_by_id(multipart_id) {
        return this._multiparts.col().findOne({
                _id: multipart_id,
            })
            .then(obj => mongo_utils.check_entity_not_deleted(obj, 'multipart'));
    }

    find_multiparts_of_object(obj_id, num_gt, limit) {
        return this._multiparts.col().find({
                obj: obj_id,
                num: {
                    $gt: num_gt
                },
                size: {
                    $exists: true
                },
                md5_b64: {
                    $exists: true
                },
            }, {
                sort: {
                    num: 1,
                    _id: -1, // last created first
                },
                limit: limit,
            })
            .toArray();
    }

    delete_multiparts_of_object(obj, delete_date) {
        return this._multiparts.col().updateMany({
            obj: obj._id,
        }, {
            $set: {
                deleted: delete_date
            },
            $rename: {
                obj: 'obj_del',
                num: 'num_del',
            }
        });
    }


    ///////////
    // PARTS //
    ///////////

    insert_parts(parts) {
        if (!parts || !parts.length) return;
        for (const part of parts) {
            this._parts.validate(part);
        }
        return this._parts.col().insertMany(parts, unordered_insert_options());
    }

    find_parts_by_start_range({ obj_id, start_gte, start_lt, end_gt, skip, limit }) {
        return this._parts.col().find({
                obj: obj_id,
                start: {
                    // since end is not indexed we query start with both
                    // low and high constraint, which allows the index to reduce scan
                    // we use a constant that limits the max part size because
                    // this is the only way to limit the minimal start value
                    $gte: start_gte,
                    $lt: start_lt,
                },
                end: {
                    $gt: end_gt
                },
                deleted: null,
            }, {
                sort: {
                    start: 1
                },
                skip: skip || 0,
                limit: limit || 0,
            })
            .toArray();
    }

    find_parts_chunk_ids(obj) {
        return this._parts.col().find({
                obj: obj._id,
            }, {
                fields: {
                    _id: 0,
                    chunk: 1
                }
            })
            .toArray()
            .then(parts => mongo_utils.uniq_ids(parts, 'chunk'));
    }

    find_parts_by_chunk_ids(chunk_ids) {
        return this._parts.col().find({
                chunk: {
                    $in: chunk_ids
                },
                deleted: null,
            })
            .toArray();
    }

    find_parts_unreferenced_chunk_ids(chunk_ids) {
        return this._parts.col().find({
                chunk: {
                    $in: chunk_ids
                },
                deleted: null,
            }, {
                fields: {
                    _id: 0,
                    chunk: 1
                }
            })
            .toArray()
            .then(parts => {
                const referenced_chunks_ids = mongo_utils.uniq_ids(parts, 'chunk');
                const unreferenced_chunks_ids = mongo_utils.obj_ids_difference(chunk_ids, referenced_chunks_ids);
                dbg.log0('find_object_parts_unreferenced_chunk_ids:',
                    'chunk_ids', chunk_ids.length,
                    'referenced_chunks_ids', referenced_chunks_ids.length,
                    'unreferenced_chunks_ids', unreferenced_chunks_ids.length);
                return unreferenced_chunks_ids;
            });
    }

    load_parts_objects_for_chunks(chunks) {
        let parts;
        let objects;
        if (!chunks || !chunks.length) return;
        return this._parts.col().find({
                chunk: {
                    $in: mongo_utils.uniq_ids(chunks, '_id')
                },
                deleted: null,
            })
            .toArray()
            .then(res_parts => {
                parts = res_parts;
                return this._objects.col().find({
                        _id: {
                            $in: mongo_utils.uniq_ids(res_parts, 'obj')
                        },
                        deleted: null,
                    })
                    .toArray();
            })
            .then(res_objects => {
                objects = res_objects;
                return map_utils.analyze_special_chunks(chunks, parts, objects);
            })
            .then(() => ({
                parts,
                objects
            }));
    }

    copy_object_parts(source_obj, target_obj) {
        return this._parts.col().find({
                obj: source_obj._id,
                deleted: null,
            })
            .toArray()
            .then(parts => this.insert_parts(
                _.map(parts, part => _.defaults({
                    _id: this.make_md_id(),
                    system: target_obj.system,
                    bucket: target_obj.bucket,
                    obj: target_obj._id,
                }, part))
            ));
    }

    find_parts_of_object(obj) {
        return this._parts.col().find({
                obj: obj._id,
            })
            .toArray();
    }

    update_parts_in_bulk(parts_updates) {
        const bulk = this._parts.col().initializeUnorderedBulkOp();
        for (const update of parts_updates) {
            bulk.find({
                    _id: update._id
                })
                .updateOne({
                    $set: update.set_updates
                });
        }
        return bulk.length ? bulk.execute() : P.resolve();
    }

    delete_parts_of_object(obj, delete_date) {
        return this._parts.col().updateMany({
            obj: obj._id,
        }, {
            $set: {
                deleted: delete_date
            },
            $rename: {
                obj: 'obj_del',
                start: 'start_del',
                chunk: 'chunk_del',
            }
        });
    }


    ////////////
    // CHUNKS //
    ////////////

    insert_chunks(chunks) {
        if (!chunks || !chunks.length) return;
        for (const chunk of chunks) {
            this._chunks.validate(chunk);
        }
        return this._chunks.col().insertMany(chunks, unordered_insert_options());
    }

    update_chunk_by_id(chunk_id, set_updates) {
        return this._chunks.col().updateOne({
                _id: chunk_id
            }, compact_updates(set_updates))
            .then(res => mongo_utils.check_update_one(res, 'chunk'));
    }

    update_chunks_by_ids(chunk_ids, set_updates, unset_updates) {
        if (!chunk_ids || !chunk_ids.length) return;
        return this._chunks.col().updateMany({
            _id: {
                $in: chunk_ids
            }
        }, compact_updates(set_updates, unset_updates));
    }

    find_chunks_by_ids(chunk_ids) {
        if (!chunk_ids || !chunk_ids.length) return;
        return this._chunks.col().find({
                _id: {
                    $in: chunk_ids
                },
                deleted: null,
            })
            .toArray();
    }

    populate_chunks_for_parts(parts) {
        return mongo_utils.populate(parts, 'chunk', this._chunks.col());
    }

    find_chunks_by_digest(bucket, digest_list) {
        let chunks;
        return this._chunks.col().find({
                system: bucket.system._id,
                bucket: bucket._id,
                digest_b64: {
                    $in: digest_list
                },
                deleted: null,
            }, {
                sort: {
                    _id: -1 // get newer chunks first
                }
            })
            .toArray()
            .then(res => {
                chunks = res;
                return this.load_blocks_for_chunks(chunks);
            })
            .then(blocks => {
                let chunks_by_digest = _.groupBy(chunks, chunk => chunk.digest_b64);
                return chunks_by_digest;
            });
    }

    iterate_all_chunks(marker, limit) {
        return this._chunks.col().find(compact({
                _id: marker ? {
                    $lt: marker
                } : undefined,
                deleted: null,
            }), {
                fields: {
                    _id: 1
                },
                sort: {
                    _id: -1
                },
                limit: limit,
            })
            .toArray()
            .then(chunks => ({
                chunk_ids: mongo_utils.uniq_ids(chunks, '_id'),
                marker: chunks.length ? chunks[chunks.length - 1]._id : null,
            }));
    }

    aggregate_chunks_by_create_dates(from_date, till_date) {
        // ObjectId consists of 24 hex string so we allign to that
        const hex_from_date = Math.floor(from_date.getTime() / 1000).toString(16);
        const hex_till_date = Math.floor(till_date.getTime() / 1000).toString(16);
        const from_date_object_id = new mongodb.ObjectId(hex_from_date + "0".repeat(24 - hex_from_date.length));
        const till_date_object_id = new mongodb.ObjectId(hex_till_date + "0".repeat(24 - hex_till_date.length));
        return this._aggregate_chunks_internal({
            _id: {
                $gte: from_date_object_id,
                $lt: till_date_object_id,
            }
        });
    }

    aggregate_chunks_by_delete_dates(from_date, till_date) {
        return this._aggregate_chunks_internal({
            deleted: {
                $gte: from_date,
                $lt: till_date,
            }
        });
    }

    _aggregate_chunks_internal(query) {
        return this._chunks.col().mapReduce(
                mongo_functions.map_aggregate_chunks,
                mongo_functions.reduce_sum, {
                    query: query,
                    out: {
                        inline: 1
                    }
                })
            .then(res => {
                const buckets = {};
                _.each(res, r => {
                    const b = buckets[r._id[0]] = buckets[r._id[0]] || {};
                    b[r._id[1]] = r.value;
                });
                return buckets;
            });
    }

    delete_chunks_by_ids(chunk_ids, delete_date) {
        if (!chunk_ids || !chunk_ids.length) return;
        return this._chunks.col().updateMany({
            _id: {
                $in: chunk_ids
            }
        }, {
            $set: {
                deleted: delete_date
            },
            $unset: {
                dedup_key: true
            }
        });
    }


    ////////////
    // BLOCKS //
    ////////////


    insert_blocks(blocks) {
        if (!blocks || !blocks.length) return;
        for (const block of blocks) {
            this._blocks.validate(block);
        }
        return this._blocks.col().insertMany(blocks, unordered_insert_options());
    }

    update_blocks_by_ids(block_ids, set_updates, unset_updates) {
        if (!block_ids || !block_ids.length) return;
        return this._blocks.col().updateMany({
            _id: {
                $in: block_ids
            }
        }, compact_updates(set_updates, unset_updates));
    }

    find_blocks_of_chunks(chunk_ids) {
        if (!chunk_ids || !chunk_ids.length) return;
        return this._blocks.col().find({
                chunk: {
                    $in: chunk_ids
                },
            })
            .toArray()
            .then(blocks => this.populate_nodes_for_blocks(blocks));
    }

    load_blocks_for_chunks(chunks) {
        if (!chunks || !chunks.length) return;
        return this._blocks.col().find({
                chunk: {
                    $in: mongo_utils.uniq_ids(chunks, '_id')
                },
                deleted: null,
            })
            .toArray()
            .then(blocks => this.populate_nodes_for_blocks(blocks))
            .then(blocks => {
                // remove from the list blocks that their node is not found
                // and consider these blocks just like deleted blocks
                let orphan_blocks = _.remove(blocks,
                    block => !block.node || !block.node._id);
                if (orphan_blocks.length) {
                    console.log('ORPHAN BLOCKS (ignoring)', orphan_blocks);
                }
                let blocks_by_chunk = _.groupBy(blocks, 'chunk');
                _.each(chunks, chunk => {
                    chunk.blocks = blocks_by_chunk[chunk._id];
                });
            });
    }

    populate_nodes_for_blocks(blocks) {
        return nodes_client.instance().populate_nodes_for_map(
            blocks[0] && blocks[0].system, blocks, 'node');
    }

    iterate_node_chunks({ node_id, marker, skip, limit }) {
        return this._blocks.col().find(compact({
                node: node_id,
                _id: marker ? {
                    $lt: marker
                } : undefined,
                deleted: null,
            }), {
                fields: {
                    _id: 1,
                    chunk: 1,
                    size: 1
                },
                sort: {
                    _id: -1 // start with latest blocks and go back
                },
                skip: skip,
                limit: limit,
            })
            .toArray()
            .then(blocks => ({
                chunk_ids: mongo_utils.uniq_ids(blocks, 'chunk'),
                marker: blocks.length ? blocks[blocks.length - 1]._id : null,
                blocks_size: _.sumBy(blocks, 'size'),
            }));
    }

    count_blocks_of_node(node_id) {
        return this._blocks.col().count({
            node: node_id,
            deleted: null,
        });
    }

    delete_blocks_of_chunks(chunk_ids, delete_date) {
        if (!chunk_ids || !chunk_ids.length) return;
        return this._blocks.col().updateMany({
            chunk: {
                $in: chunk_ids
            }
        }, {
            $set: {
                deleted: delete_date
            },
            $rename: {
                chunk: 'chunk_del',
                node: 'node_del',
            }
        });
    }

}


function compact(obj) {
    return _.omitBy(obj, _.isUndefined);
}

function compact_updates(set_updates, unset_updates, inc_updates) {
    const updates = compact({
        $set: set_updates,
        $unset: unset_updates,
        $inc: inc_updates,
    });
    if (_.isEmpty(updates)) throw new Error(`INVALID EMPTY UPDATES`);
    return updates;
}

function unordered_insert_options() {
    return {
        ordered: false
    };
}


// EXPORTS
exports.MDStore = MDStore;
