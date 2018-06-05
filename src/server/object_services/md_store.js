/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const assert = require('assert');
const moment = require('moment');
const mongodb = require('mongodb');
const mime = require('mime');

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
        const versioning_indexes = [
            'null_object_index',
            'version_object_index',
            'latest_object_index',
            'prev_object_index',
            'list_uploads_index',
            'list_versions_index'
        ];
        // This checks if there is a current background operation that creates the indexes
        const current_ops_on_db = await await mongo_client.instance().db.admin().command({ currentOp: 1 });
        const indexing_ops_on_collection = _.flatten(_.filter(current_ops_on_db.inprog, job =>
                job.command && job.command.createIndexes === 'objectmds')
            .map(index_job => index_job.command.indexes));
        const building_indexes_names = indexing_ops_on_collection.map(obj => obj.name);
        const object_mds_indexes_building = building_indexes_names.includes(versioning_indexes);

        // This checks if the indexes are configured on a the collection
        const object_mds_indexes = await this._objects.col().indexes();
        let object_mds_indexes_configured = true;
        versioning_indexes.forEach(index => {
            object_mds_indexes_configured = object_mds_indexes_configured &&
                object_mds_indexes.find(ind => ind.name === index && ind.unique);
        });
        return Boolean(object_mds_indexes_configured && !object_mds_indexes_building);
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
                // This is a place filler for the prefix of the index
                latest_object: null,
                is_obj_version: null,
                upload_started: null
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


    async list_object_versions({
        bucket_id,
        delimiter,
        prefix,
        marker,
        limit,
        version_id_marker
    }) {
        const sort = {
            bucket: 1,
            key: 1,
            deleted: 1,
            // This is done for index
            list_versions: 1,
            version_id: -1
        };
        const { key_cond, regexp } = this._build_key_cond_for_list({ marker, prefix, delimiter });
        const query = compact({
            bucket: bucket_id,
            key: _.isEmpty(key_cond) ? undefined : key_cond,
            deleted: null,
            // This is done for index
            list_versions: null,
            // The index does not include uploads so no need to worry
        });

        if (marker && version_id_marker) {
            this._build_key_id_marker_for_list(query, { regexp, marker, version_id_marker });
        }

        const res = delimiter ? await this._objects.col().mapReduce(
            mongo_functions.map_common_prefixes_and_objects,
            mongo_functions.reduce_common_prefixes_occurrence_and_objects, {
                query,
                limit,
                sort,
                scope: { prefix, delimiter },
                out: { inline: 1 }
            }
        ) : await this._objects.col().find(query, { limit, sort }).toArray();

        return this._resolve_response(({ query: res, prefix, delimiter }));
    }

    async list_objects({
        bucket_id,
        delimiter,
        prefix,
        marker,
        limit
    }) {
        const sort = {
            bucket: 1,
            key: 1,
        };
        const { key_cond } = this._build_key_cond_for_list({ marker, prefix, delimiter });
        const query = compact({
            bucket: bucket_id,
            key: _.isEmpty(key_cond) ? undefined : key_cond,
            deleted: null,
            latest_object: null,
            is_obj_version: null,
            upload_started: null,
            // Couldn't push it into partial since other queries need to delete marker
            delete_marker: null
        });

        const res = delimiter ? await this._objects.col().mapReduce(
            mongo_functions.map_common_prefixes_and_objects,
            mongo_functions.reduce_common_prefixes_occurrence_and_objects, {
                query,
                limit,
                sort,
                scope: { prefix, delimiter },
                out: { inline: 1 }
            }
        ) : await this._objects.col().find(query, { limit, sort }).toArray();

        return this._resolve_response(({ query: res, prefix, delimiter }));
    }

    async list_uploads({
        bucket_id,
        delimiter,
        prefix,
        marker,
        limit,
        upload_id_marker,
    }) {
        const sort = {
            bucket: 1,
            key: 1,
            deleted: 1,
            // This is used instead of _id since they are the same values
            upload_started: 1
        };
        const { key_cond, regexp } = this._build_key_cond_for_list({ marker, prefix, delimiter });
        const query = compact({
            bucket: bucket_id,
            key: _.isEmpty(key_cond) ? undefined : key_cond,
            deleted: null,
            // $exists is less optimized than comparing to null
            upload_started: { $exists: true }
        });

        if (marker && upload_id_marker) {
            this._build_key_id_marker_for_list(query, { regexp, marker, id_marker: upload_id_marker });
        }

        const res = delimiter ? await this._objects.col().mapReduce(
            mongo_functions.map_common_prefixes_and_objects,
            mongo_functions.reduce_common_prefixes_occurrence_and_objects, {
                query,
                limit,
                sort,
                scope: { prefix, delimiter },
                out: { inline: 1 }
            }
        ) : await this._objects.col().find(query, { limit, sort }).toArray();

        return this._resolve_response({ query: res, prefix, delimiter });
    }

    _resolve_response({ query, prefix, delimiter }) {
        const wrap_single_key = obj_rec => ({
            key: obj_rec.key,
            obj: obj_rec
        });
        const wrap_single_prefix = prefix_rec => ({
            key: prefix + prefix_rec._id[0],
        });
        if (delimiter) {
            return _.flatten(
                _.map(query, obj => {
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
            );
        }
        return _.map(query, obj => wrap_single_key(obj));
    }

    _build_key_cond_for_list({ marker, prefix, delimiter }) {
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
        return { key_cond, regexp };
    }

    async find_object_null_version(bucket_id, key) {
        return this._objects.col().findOne({
            bucket: bucket_id,
            key: key,
            deleted: null,
            null_object: null,
            has_version: null,
            upload_started: null,
        });
    }

    async find_object_by_version(bucket_id, key, version_id) {
        return this._objects.col().findOne({
            bucket: bucket_id,
            key: key,
            deleted: null,
            version_object: null,
            version_id
        });
    }

    async find_object_latest(bucket_id, key) {
        return this._objects.col().findOne({
            bucket: bucket_id,
            key: key,
            deleted: null,
            latest_object: null,
            is_obj_version: null,
            upload_started: null,
        });
    }

    async find_object_prev_version(bucket_id, key) {
        return this._objects.col().findOne({
            bucket: bucket_id,
            key: key,
            deleted: null,
            // This is done in order to use index
            version_id: { $exists: true },
            is_obj_version: true,
            upload_started: null
        }, {
            sort: {
                bucket: 1,
                key: 1,
                deleted: 1,
                version_id: -1
            }
        });
    }

    // 2, 3
    async remove_object_and_unset_latest(obj) {
        const res = await this._objects.col().updateOne({
            _id: obj._id,
            deleted: null
        }, {
            $set: { deleted: new Date(), cloud_synced: false, is_obj_version: true },
        });
        mongo_utils.check_update_one(res, 'object');
    }

    // 2, 3, 4
    async remove_object_move_latest(old_latest_obj, new_latest_obj) {
        const bulk = this._objects.col().initializeOrderedBulkOp();
        bulk.find({ _id: old_latest_obj._id, deleted: null })
            .updateOne({
                $set: { deleted: new Date(), cloud_synced: false, is_obj_version: true },
            });

        bulk.find({
                _id: new_latest_obj._id,
                deleted: null
            })
            .updateOne({
                $unset: { is_obj_version: true },
            });

        await bulk.execute();
    }

    async insert_object_delete_marker(obj) {
        const object_sequence = await this.get_object_version_seq();
        const delete_marker = {
            _id: MDStore.instance().make_md_id(),
            system: obj.system,
            bucket: obj.bucket,
            key: obj.key,
            content_type: obj.content_type ||
                mime.getType(obj.key) ||
                'application/octet-stream',
            delete_marker: true,
            create_time: new Date(),
            version_id: object_sequence,
        };
        if (obj.has_version) delete_marker.has_version = obj.has_version;
        await MDStore.instance().insert_object(delete_marker);
        return {
            version_id: delete_marker.has_version ? object_sequence : 'null',
            delete_marker_version_id: delete_marker.has_version ? object_sequence : 'null'
        };
    }

    async insert_object_delete_marker_move_latest(obj, has_version) {
        const bulk = this._objects.col().initializeOrderedBulkOp();
        bulk.find({ _id: obj._id, deleted: null })
            .updateOne({
                $set: { is_obj_version: true }
            });

        const object_sequence = await this.get_object_version_seq();
        const delete_marker = {
            _id: MDStore.instance().make_md_id(),
            system: obj.system,
            bucket: obj.bucket,
            key: obj.key,
            content_type: obj.content_type ||
                mime.getType(obj.key) ||
                'application/octet-stream',
            delete_marker: true,
            create_time: new Date(),
            version_id: object_sequence,
        };
        if (has_version) delete_marker.has_version = has_version;
        bulk.insert(delete_marker);

        await bulk.execute();
        return {
            version_id: has_version ? object_sequence : 'null',
            delete_marker_version_id: has_version ? object_sequence : 'null'
        };
    }

    async complete_object_upload_latest_mark_remove_current({
        unmark_obj,
        put_obj,
        set_updates,
        unset_updates,
        bucket_versioning
    }) {
        const bulk = this._objects.col().initializeOrderedBulkOp();
        bulk.find({ _id: unmark_obj._id, deleted: null })
            .updateOne({
                $set: { is_obj_version: true }
            });
        set_updates.create_time = new Date();
        set_updates.version_id = await MDStore.instance().get_object_version_seq();
        if (bucket_versioning === 'ENABLED') {
            set_updates.has_version = true;
        }
        bulk.find({ _id: put_obj._id, deleted: null })
            .updateOne({
                $set: set_updates,
                $unset: unset_updates
            });
        await bulk.execute();
        return {
            version_id: set_updates.version_id
        };
    }

    async complete_object_upload_latest_mark_remove_current_and_delete({
        unmark_obj,
        put_obj,
        set_updates,
        unset_updates,
        bucket_versioning
    }) {
        const bulk = this._objects.col().initializeOrderedBulkOp();
        bulk.find({ _id: unmark_obj._id, deleted: null })
            .updateOne({
                $set: { deleted: new Date(), cloud_synced: false, is_obj_version: true },
            });
        set_updates.create_time = new Date();
        set_updates.version_id = await MDStore.instance().get_object_version_seq();
        if (bucket_versioning === 'ENABLED') {
            set_updates.has_version = true;
        }
        bulk.find({ _id: put_obj._id, deleted: null })
            .updateOne({
                $set: set_updates,
                $unset: unset_updates
            });
        await bulk.execute();
    }

    // This is for the 2, 3 and 3` for latest removal (3 objects)
    async insert_object_delete_marker_move_latest_with_delete(obj, latest_obj) {
        const bulk = this._objects.col().initializeOrderedBulkOp();
        if (latest_obj) {
            bulk.find({ _id: latest_obj._id, deleted: null })
                .updateOne({
                    $set: { is_obj_version: true }
                });
            bulk.find({ _id: obj._id, deleted: null })
                .updateOne({
                    $set: { deleted: new Date(), cloud_synced: false },
                });
        } else {
            bulk.find({ _id: obj._id, deleted: null })
                .updateOne({
                    $set: { deleted: new Date(), cloud_synced: false, is_obj_version: true },
                });
        }

        const object_sequence = await this.get_object_version_seq();
        const delete_marker = {
            _id: MDStore.instance().make_md_id(),
            system: obj.system,
            bucket: obj.bucket,
            key: obj.key,
            content_type: obj.content_type ||
                mime.getType(obj.key) ||
                'application/octet-stream',
            delete_marker: true,
            create_time: new Date(),
            version_id: object_sequence,
        };
        if (obj.has_version) delete_marker.has_version = obj.has_version;
        bulk.insert(delete_marker);

        await bulk.execute();
        return {
            version_id: delete_marker.has_version ? delete_marker : 'null',
            delete_marker_version_id: delete_marker.has_version ? delete_marker : 'null'
        };
    }

    async get_object_version_seq() {
        // TODO: Just a place holder right now
        return Date.now();
        // return Math.floor(Math.random() * Math.floor(100));
    }

    _build_key_id_marker_for_list(query, { regexp, marker, version_id_marker, id_marker }) {
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
                // This was the _id so not sure about the index changing this
                version_id: version_id_marker ? { $gt: version_id_marker } : undefined,
                _id: id_marker ? { $gt: this.make_md_id(id_marker) } : undefined
            })
        ];
        delete query.key;
    }

    _get_unique_latest_keys(keys) {
        return _.compact(_.map(keys, key => (key.obj ? (!key.obj.is_obj_version && key) : key)));
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
                latest_object: null,
                is_obj_version: null,
                upload_started: null,
                // Couldn't push it into partial since other queries need to delete marker
                delete_marker: null
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
