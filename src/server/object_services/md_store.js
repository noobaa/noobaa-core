/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const assert = require('assert');
const moment = require('moment');
const mongodb = require('mongodb');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
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

    async is_objectmds_indexes_ready() {
        const object_mds_indexes = await mongo_client.instance().db.objectmds.getIndexes();
        const object_mds_indexes_ready =
            object_mds_indexes.find(index =>
                index.name === 'bucket_1_key_1_deleted_1_upload_started_1' && index.unique) &&
            object_mds_indexes.find(index =>
                index.name === 'bucket_1_key_1_deleted_1_create_time_-1_upload_started_1' && !index.unique);
        return Boolean(object_mds_indexes_ready);
    }


    make_md_id(id_str) {
        return new mongodb.ObjectId(id_str);
    }

    make_md_id_from_time(time, zero_suffix) {
        const hex_time = Math.floor(time / 1000).toString(16);
        assert(hex_time.length <= 8);
        const padded_hex_time = '0'.repeat(8 - hex_time.length) + hex_time;
        var suffix;
        if (zero_suffix) {
            suffix = '0'.repeat(16);
        } else {
            suffix = String(new mongodb.ObjectId()).slice(8, 24);
        }
        const hex_id = padded_hex_time + suffix;
        assert(padded_hex_time.length === 8);
        assert(suffix.length === 16);
        assert(hex_id.length === 24);
        assert(parseInt(padded_hex_time, 16) === Math.floor(time / 1000));
        return new mongodb.ObjectId(hex_id);
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
                upload_started: null,
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
            _id: obj_id
        });
    }

    async find_object_by_key(bucket_id, key, has_version_null) {
        const response = await this._objects.col().findOne(compact({
            bucket: bucket_id,
            key: key,
            deleted: null,
            create_time: { $exists: true },
            upload_started: null,
            has_version: has_version_null ? null : undefined,
        }), {
            sort: {
                bucket: 1,
                key: 1,
                deleted: 1,
                create_time: -1,
                upload_started: 1
            }
        });
        return response;
    }

    populate_objects(docs, doc_path, fields) {
        return mongo_utils.populate(docs, doc_path, this._objects.col(), fields);
    }

    populate_chunks(docs, doc_path, fields) {
        return mongo_utils.populate(docs, doc_path, this._chunks.col(), fields);
    }

    find_objects({ bucket_id, key, upload_mode, max_create_time, skip, limit, sort, order, pagination, versioning }) {
        // const versioning_flow = versioning.bucket_activated || versioning.list_versions;
        const query = compact({
            bucket: bucket_id,
            key: key,
            deleted: null,
            // allow filtering of uploading/non-uploading objects
            create_time: max_create_time ? {
                $lt: new Date(moment.unix(max_create_time).toISOString())
            } : undefined,
            upload_started: typeof upload_mode === 'boolean' ? {
                $exists: upload_mode
            } : undefined,
        });

        const completed_query = _.omit(query, 'upload_started');
        completed_query.upload_started = { $exists: false };
        const uploading_query = _.omit(query, 'upload_started');
        uploading_query.upload_started = { $exists: true };

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
                pagination ? this._objects.col().count(query) : undefined,

                // completed uploads count
                this._objects.col().count(completed_query),

                // uploading count
                this._objects.col().count(uploading_query)
            )
            .spread((objects, total_count, completed, uploading) => ({
                objects,
                counters: {
                    non_paginated: total_count,
                    by_mode: {
                        completed,
                        uploading
                    }
                }
            }));
    }

    async find_objects_by_prefix_and_delimiter({
        bucket_id,
        upload_mode,
        delimiter,
        prefix,
        marker,
        limit,
        version_id_marker,
        versioning
    }) {
        const versioning_flow = versioning.bucket_activated || versioning.list_versions;
        // This sort order is crucial for the query to work optimized
        // Pay attention prior to any changes and analyze query results
        // Basically we are interested in primary sort by key and secondary by _id
        // Both the bucket and deleted will be the same, this is needed for index optimization
        const sort = versioning_flow ? {
            bucket: 1,
            key: 1,
            deleted: 1,
            // This is used instead of _id since they are the same values
            create_time: -1,
            upload_started: 1,
        } : {
            bucket: 1,
            key: 1,
            deleted: 1,
            // This is used instead of _id since they are the same values
            upload_started: 1
        };
        // filter keys starting with prefix, *not* followed by marker
        let regexp_text = '^' + _.escapeRegExp(prefix);
        if (marker) {
            if (!marker.startsWith(prefix)) {
                throw new Error('BAD MARKER ' + marker + ' FOR PREFIX ' + prefix);
            }
            const marker_suffix = marker.slice(prefix.length);
            // This is an optimization for filtering out any keys which are under
            // The common prefix in case it ends with a delimiter (directory)
            if (delimiter && marker_suffix.endsWith(delimiter)) {
                regexp_text += '(?!' + _.escapeRegExp(marker_suffix) + ')';
            }
        }
        // We are not interested in triggering empty Regex.
        // This had a bad affect on the performance of the query.
        // Same goes for the $gt/$gte marker when wasn't provided.
        const regexp = (regexp_text === '^') ? undefined : new RegExp(regexp_text);
        const key_cond = compact({
            $regex: regexp,
            $gt: marker || undefined
        });
        const query = compact({
            bucket: bucket_id,
            key: _.isEmpty(key_cond) ? undefined : key_cond,
            deleted: null,
            // Notice that we use undefined so it will be removed from the query
            // Since we have two different indexes we are interested in the most
            // Optimal index that we can possibly get in case of null it will use
            // A different index which was designed for the versioning
            create_time: versioning_flow ? { $exists: true } : undefined,
            // $exists is less optimized than comparing to null
            upload_started: upload_mode ? { $exists: true } : null
        });

        if (marker && version_id_marker) {
            const key_cond2 = compact({
                $regex: regexp,
                $gte: marker || undefined
            });
            // This case is not optimized, guess is because of the $or statement
            // We should investigate it further and optimize it
            query.$or = [
                { key: query.key },
                compact({
                    key: _.isEmpty(key_cond2) ? undefined : key_cond2,
                    _id: { $gt: this.make_md_id(version_id_marker) }
                })
            ];
            delete query.key;
        }

        const res = delimiter ? await this._objects.col().mapReduce(
            mongo_functions.map_common_prefixes_and_objects,
            mongo_functions.reduce_common_prefixes_occurrence_and_objects, {
                query,
                limit,
                sort,
                scope: { prefix, delimiter, list_versions: versioning.list_versions, upload_mode },
                out: { inline: 1 }
            }
        ) : await this._objects.col().find(query, { limit, sort }).toArray();

        const wrap_single_key = obj_rec => ({
            key: obj_rec.key,
            obj: obj_rec
        });
        const wrap_single_prefix = prefix_rec => ({
            key: prefix + prefix_rec._id[0],
        });
        const resolve_response = query_response => (delimiter ?
            _.flatten(
                _.map(query_response, obj => {
                    if (_.isObject(obj.value)) {
                        if (obj.value.objects) {
                            return _.map(obj.value.objects, wrap_single_key);
                        }
                        // MapReduce doesn't call reduce when we have only one map for key
                        // This means that we will not have the objects property in the response object
                        return wrap_single_key(obj.value);
                    }
                    return wrap_single_prefix(obj);
                })
            ) : _.map(query_response, obj => wrap_single_key(obj))
        );
        const sort_in_order = response => _.sortBy(response, ['key', 'obj._id']);
        let resolved_response = resolve_response(res);
        if (!upload_mode) {
            this._mark_latest_keys(resolved_response);
            if (versioning.bucket_activated && !versioning.list_versions) {
                const unique_response = this._get_unique_latest_keys(resolved_response);
                const response_length = unique_response.length;
                if (response_length) {
                    // We are only interested in getting the latest for objects
                    // There is no point in getting latest for common_prefix
                    const last_obj = unique_response[response_length - 1].obj;
                    if (last_obj) {
                        const last_key_latest = await this.find_object_by_key(bucket_id, last_obj.key);
                        if (String(last_key_latest._id) !== String(last_obj._id)) {
                            unique_response[response_length - 1].obj = last_key_latest;
                        }
                    }
                }
                resolved_response = unique_response;
            }
        }

        return sort_in_order(resolved_response);
    }

    _mark_latest_keys(keys) {
        const only_objects = _.filter(keys, key => key.obj);
        only_objects.sort((a, b) => (b.create_time - a.create_time));
        const latest_versions = _.uniqBy(only_objects, 'key');
        _.each(keys, element => {
            if (element.obj && _.includes(latest_versions, element)) element.obj.is_latest = true;
        });
    }

    _get_unique_latest_keys(keys) {
        return _.compact(_.map(keys, key => (key.obj ? (key.obj.is_latest && key) : key)));
    }

    has_any_objects_in_system(system_id) {
        return this._objects.col().findOne({
                system: system_id,
                deleted: null,
            })
            .then(obj => Boolean(obj));
    }

    has_any_completed_objects_in_bucket(bucket_id) {
        return this._objects.col().findOne({
                bucket: bucket_id,
                deleted: null,
                upload_started: null,
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
                    buckets[r._id] = r.count;
                    total_count += r.count;
                });
                buckets[''] = total_count;
                return buckets;
            });
    }

    aggregate_objects_by_create_dates(from_time, till_time) {
        return this._aggregate_objects_internal({
            create_time: {
                $gte: new Date(from_time),
                $lt: new Date(till_time),
            }
        });
    }

    aggregate_objects_by_delete_dates(from_time, till_time) {
        return this._aggregate_objects_internal({
            deleted: {
                $gte: new Date(from_time),
                $lt: new Date(till_time),
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
                    const b = buckets[r._id[0]] || {};
                    buckets[r._id[0]] = b;
                    b[r._id[1]] = r.value;
                });
                return buckets;
            });
    }

    find_deleted_objects(max_delete_time, limit) {
        const query = {
            deleted: {
                $lt: new Date(max_delete_time)
            },
        };
        return this._objects.col().find(query, {
                limit: Math.min(limit, 1000),
                fields: {
                    _id: 1,
                    deleted: 1
                }
            }).toArray()
            .then(objects => mongo_utils.uniq_ids(objects, '_id'));
    }

    db_delete_objects(object_ids) {
        if (!object_ids || !object_ids.length) return;
        return this._objects.col().deleteMany({
            _id: {
                $in: object_ids
            },
            deleted: { $exists: true }
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
                upload_started: null,
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
                upload_started: null,
                create_time: {
                    $exists: true
                }
            })
            .toArray();
    }

    update_all_objects_of_bucket_unset_cloud_sync(bucket_id) {
        // TODO cloud sync scalability
        return this._objects.col().updateMany({
            bucket: bucket_id,
            cloud_synced: true,
            deleted: null,
        }, {
            $set: {
                cloud_synced: false
            }
        });
    }

    update_all_objects_of_bucket_set_deleted_cloud_sync(bucket_id) {
        // TODO cloud sync scalability
        return this._objects.col().updateMany({
            bucket: bucket_id,
            cloud_synced: false,
            deleted: {
                $exists: true
            },
        }, {
            $set: {
                cloud_synced: true
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

    delete_multiparts_of_object(obj) {
        const delete_date = new Date();
        return this._multiparts.col().updateMany({
            obj: obj._id,
            deleted: null
        }, {
            $set: {
                deleted: delete_date
            },
            $rename: {
                // obj: 'obj_del',
                num: 'num_del',
            }
        });
    }

    db_delete_multiparts_of_object(obj) {
        return this._multiparts.col().deleteMany({
            obj: obj._id,
            deleted: { $exists: true }
        });
    }

    has_any_objects_for_bucket(bucket_id) {
        return this._objects.col().findOne({
                bucket: bucket_id,
            })
            .then(obj => Boolean(obj));
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

    find_parts_chunks_references(chunk_ids) {
        return this._parts.col().find({
                chunk: { $in: chunk_ids },
                deleted: null,
            })
            .toArray()
            .then(parts => {
                const parts_by_chunk_id = _.groupBy(parts, 'chunk');
                return parts_by_chunk_id;
            });
    }

    load_parts_objects_for_chunks(chunks) {
        let parts;
        let objects;
        if (!chunks || !chunks.length) return;
        return this._parts.col().find({
                chunk: {
                    $in: mongo_utils.uniq_ids(chunks, '_id')
                }
            })
            .toArray()
            .then(res_parts => {
                parts = res_parts;
                return this._objects.col().find({
                        _id: {
                            $in: mongo_utils.uniq_ids(res_parts, 'obj')
                        }
                    })
                    .toArray();
            })
            .then(res_objects => {
                objects = res_objects;
            })
            .then(() => ({
                parts,
                objects
            }));
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

    delete_parts_of_object(obj) {
        const delete_date = new Date();
        return this._parts.col().updateMany({
            obj: obj._id,
            deleted: null
        }, {
            $set: {
                deleted: delete_date
            },
            $rename: {
                // obj: 'obj_del',
                start: 'start_del',
                // chunk: 'chunk_del',
            }
        });
    }

    db_delete_parts_of_object(obj) {
        return this._parts.col().deleteMany({
            obj: obj._id,
            deleted: { $exists: true }
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
                }
            })
            .toArray();
    }

    populate_chunks_for_parts(parts) {
        return mongo_utils.populate(parts, 'chunk', this._chunks.col());
    }

    find_chunks_by_dedup_key(bucket, dedup_keys) {
        return this._chunks.col().find({
                system: bucket.system._id,
                bucket: bucket._id,
                dedup_key: {
                    $in: dedup_keys
                },
                deleted: null,
            }, {
                sort: {
                    _id: -1 // get newer chunks first
                }
            })
            .toArray()
            .then(chunks => this.load_blocks_for_chunks(chunks));
    }

    iterate_all_chunks_in_buckets(lower_marker, upper_marker, buckets, limit) {
        return this._chunks.col().find(compact({
                _id: lower_marker ? compact({
                    $gt: lower_marker,
                    $lte: upper_marker
                }) : undefined,
                deleted: null,
                bucket: {
                    $in: buckets
                }
            }), {
                fields: {
                    _id: 1
                },
                sort: {
                    _id: 1
                },
                limit: limit,
            })
            .toArray()
            .then(chunks => ({
                chunk_ids: mongo_utils.uniq_ids(chunks, '_id'),
                marker: chunks.length ? chunks[chunks.length - 1]._id : null,
            }));
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

    aggregate_chunks_by_create_dates(from_time, till_time) {
        return this._aggregate_chunks_internal({
            _id: {
                $gte: this.make_md_id_from_time(from_time, 'zero_suffix'),
                $lt: this.make_md_id_from_time(till_time, 'zero_suffix'),
            }
        });
    }

    aggregate_chunks_by_delete_dates(from_time, till_time) {
        return this._aggregate_chunks_internal({
            deleted: {
                $gte: new Date(from_time),
                $lt: new Date(till_time),
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
                    const b = buckets[r._id[0]] || {};
                    buckets[r._id[0]] = b;
                    b[r._id[1]] = r.value;
                });
                return buckets;
            });
    }

    delete_chunks_by_ids(chunk_ids) {
        const delete_date = new Date();
        if (!chunk_ids || !chunk_ids.length) return;
        return this._chunks.col().updateMany({
            _id: {
                $in: chunk_ids
            },
            deleted: null
        }, {
            $set: {
                deleted: delete_date
            },
            $unset: {
                dedup_key: true
            }
        });
    }

    delete_object_by_id(object_id) {
        if (!object_id) return;
        return this._objects.col().updateOne({
            _id: object_id,
            deleted: null
        }, {
            $set: {
                deleted: new Date(),
                cloud_synced: false
            },
        });
    }

    get_dedup_index_size() {
        return this._chunks.col().stats()
            .then(res => res.indexSizes.dedup_key_1);
    }

    get_aprox_dedup_keys_number() {
        // This function estimates the number of items in the dedup index - it does it by sample 10K chunks - and check how much of them are deduped
        // and then calculates the aproximate number of the total indexed dedup chunks - this was the fastest soultion we found
        // both iterating over the chunks and running a query over all the chunks was too lengthy operations.
        const sample_size = 10000;
        return P.join(
                this._chunks.col().count(),
                this._chunks.col().aggregate([
                    { $sample: { size: sample_size } },
                    { $match: { dedup_key: { $exists: true } } },
                    { $count: "count" }
                ]).toArray()
            )
            .then(([total_count, sample_items]) => {
                if (!sample_items.length) return total_count;
                return Math.floor(sample_items[0].count * total_count / sample_size);
            });
    }

    iterate_indexed_chunks(limit, marker) {
        return this._chunks.col().find({
                dedup_key: marker ? { $lt: marker } : { $exists: true }
            }, {
                fields: {
                    _id: 1,
                    dedup_key: 1
                },
                sort: {
                    dedup_key: -1
                },
                limit: limit,
            })
            .toArray()
            .then(chunks => ({
                chunk_ids: mongo_utils.uniq_ids(chunks, '_id'),
                marker: chunks.length ? chunks[chunks.length - 1].dedup_key : null,
            }));
    }

    find_deleted_chunks(max_delete_time, limit) {
        const query = {
            deleted: {
                $lt: new Date(max_delete_time)
            },
        };
        return this._chunks.col().find(query, {
                limit: Math.min(limit, 1000),
                fields: {
                    _id: 1,
                    deleted: 1
                }
            }).toArray()
            .then(objects => mongo_utils.uniq_ids(objects, '_id'));
    }

    has_any_blocks_for_chunk(chunk_id) {
        return this._blocks.col().findOne({
                chunk: chunk_id,
            })
            .then(obj => Boolean(obj));
    }

    has_any_parts_for_chunk(chunk_id) {
        return this._parts.col().findOne({
                chunk: chunk_id,
            })
            .then(obj => Boolean(obj));
    }

    db_delete_chunks(chunk_ids) {
        if (!chunk_ids || !chunk_ids.length) return;
        return this._chunks.col().deleteMany({
            _id: {
                $in: chunk_ids
            },
            deleted: { $exists: true }
        });
    }

    ////////////
    // BLOCKS //
    ////////////

    iterate_all_blocks(marker, limit, deleted_only) {
        const query = compact({
            _id: marker ? {
                $lt: marker
            } : undefined,
            deleted: null
        });
        if (deleted_only) {
            query.deleted = {
                $exists: true
            };
            query.reclaimed = {
                $exists: false
            };
        }
        return this._blocks.col().find(query, {
                sort: {
                    _id: -1
                },
                limit: limit,
            })
            .toArray();
    }

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
        if (!chunks || !chunks.length) return chunks;
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
                const orphan_blocks = _.remove(blocks, block => !block.node || !block.node._id);
                if (orphan_blocks.length) console.log('ORPHAN BLOCKS (ignoring)', orphan_blocks);
                const blocks_by_chunk = _.groupBy(blocks, 'chunk');
                for (let i = 0; i < chunks.length; ++i) {
                    chunks[i].blocks = blocks_by_chunk[chunks[i]._id] || [];
                }
                return chunks;
            });
    }

    populate_nodes_for_blocks(blocks) {
        return nodes_client.instance().populate_nodes_for_map(
            blocks[0] && blocks[0].system, blocks, 'node');
    }

    iterate_node_chunks({ node_id, marker, limit }) {
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
                limit: limit,
            })
            .toArray()
            .then(blocks => ({
                chunk_ids: mongo_utils.uniq_ids(blocks, 'chunk'),
                marker: blocks.length ? blocks[blocks.length - 1]._id : null,
                blocks_size: _.sumBy(blocks, 'size'),
            }));
    }

    iterate_multi_nodes_chunks({ node_ids, skip, limit }) {
        return this._blocks.col().find(compact({
                node: { $in: node_ids },
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

    count_blocks_of_nodes(node_ids) {
        return this._blocks.col().count({
            node: { $in: node_ids },
            deleted: null,
        });
    }

    delete_blocks_of_chunks(chunk_ids) {
        const delete_date = new Date();
        if (!chunk_ids || !chunk_ids.length) return;
        return this._blocks.col().updateMany({
            chunk: {
                $in: chunk_ids
            },
            deleted: null
        }, {
            $set: {
                deleted: delete_date
            },
            // $rename: {
            //     chunk: 'chunk_del',
            //     node: 'node_del',
            // }
        });
    }

    aggregate_blocks_by_create_dates(from_time, till_time) {
        return this._aggregate_blocks_internal({
            _id: {
                $gte: this.make_md_id_from_time(from_time, 'zero_suffix'),
                $lt: this.make_md_id_from_time(till_time, 'zero_suffix'),
            }
        });
    }

    aggregate_blocks_by_delete_dates(from_time, till_time) {
        return this._aggregate_blocks_internal({
            deleted: {
                $gte: new Date(from_time),
                $lt: new Date(till_time),
            }
        });
    }

    _aggregate_blocks_internal(query) {
        return this._blocks.col().mapReduce(
                mongo_functions.map_aggregate_blocks,
                mongo_functions.reduce_sum, {
                    query: query,
                    out: {
                        inline: 1
                    }
                })
            .then(res => {
                const buckets = {};
                const pools = {};
                _.each(res, r => {
                    const type = r._id[0];
                    if (type === 'total') {
                        buckets[r._id[1]] = { size: r.value };
                    } else if (type === 'bucket') {
                        const b = buckets[r._id[1]] || {
                            size: 0,
                            pools: {}
                        };
                        buckets[r._id[1]] = b;
                        b.size = r.value;
                    } else if (type === 'pool') {
                        pools[r._id[1]] = { size: r.value };
                    } else if (type === 'bucket_and_pool') {
                        const b = buckets[r._id[1]] || {
                            size: 0,
                            pools: {}
                        };
                        buckets[r._id[1]] = b;
                        b.pools[r._id[2]] = { size: r.value };
                    }
                });
                return {
                    buckets,
                    pools
                };
            });
    }

    find_deleted_blocks(max_delete_time, limit) {
        const query = {
            deleted: {
                $lt: new Date(max_delete_time)
            },
        };
        return this._blocks.col().find(query, {
                limit: Math.min(limit, 1000),
                fields: {
                    _id: 1,
                    deleted: 1
                }
            }).toArray()
            .then(objects => mongo_utils.uniq_ids(objects, '_id'));
    }

    db_delete_blocks(block_ids) {
        if (!block_ids || !block_ids.length) return;
        return this._blocks.col().deleteMany({
            _id: {
                $in: block_ids
            },
            deleted: { $exists: true }
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
