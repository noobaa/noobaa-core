/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../../sdk/nb')} nb */

const _ = require('lodash');
const assert = require('assert');
const moment = require('moment');
const mongodb = require('mongodb');
const mime = require('mime');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const db_client = require('../../util/db_client');

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
const config = require('../../../config');


class MDStore {

    constructor(test_suffix = '') {
        this._objects = db_client.instance().define_collection({
            name: 'objectmds' + test_suffix,
            schema: object_md_schema,
            db_indexes: object_md_indexes,
        });
        this._multiparts = db_client.instance().define_collection({
            name: 'objectmultiparts' + test_suffix,
            schema: object_multipart_schema,
            db_indexes: object_multipart_indexes,
        });
        this._parts = db_client.instance().define_collection({
            name: 'objectparts' + test_suffix,
            schema: object_part_schema,
            db_indexes: object_part_indexes,
        });
        this._chunks = db_client.instance().define_collection({
            name: 'datachunks' + test_suffix,
            schema: data_chunk_schema,
            db_indexes: data_chunk_indexes,
        });
        this._blocks = db_client.instance().define_collection({
            name: 'datablocks' + test_suffix,
            schema: data_block_schema,
            db_indexes: data_block_indexes,
        });
        this._sequences = db_client.instance().define_collection({
            name: 'mdsequences' + test_suffix,
        });
    }

    /**
     * @returns {MDStore}
     */
    static instance() {
        if (!MDStore._instance) MDStore._instance = new MDStore();
        return MDStore._instance;
    }

    make_md_id(id_str) {
        return make_md_id(id_str);
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


    async insert_object(info) {
        this._objects.validate(info);
        return this._objects.insertOne(info);
    }

    async update_object_by_id(obj_id, set_updates, unset_updates, inc_updates) {
        dbg.log1('update_object_by_id:', obj_id, compact_updates(set_updates, unset_updates, inc_updates));
        const res = await this._objects.updateOne({ _id: obj_id },
            compact_updates(set_updates, unset_updates, inc_updates)
        );
        db_client.instance().check_update_one(res, 'object');
    }

    /**
     * @param {nb.ID[]} object_ids
     * @param {Object} [set_updates]
     * @param {Object} [unset_updates]
     */
    async update_objects_by_ids(object_ids, set_updates, unset_updates) {
        if (!object_ids || !object_ids.length) return;
        dbg.log0('update_object_by_id:', object_ids.join(','), compact_updates(set_updates, unset_updates));
        await this._objects.updateMany({
            _id: {
                $in: object_ids
            }
        }, compact_updates(set_updates, unset_updates));
    }

    /**
     * @param {nb.ID} obj_id
     * @returns {Promise<nb.ObjectMD>}
     */
    async find_object_by_id(obj_id) {
        return this._objects.findOne({ _id: obj_id });
    }

    /**
     * @param {nb.ID[]} obj_ids
     * @returns {Promise<nb.ObjectMD[]>}
     */
    async find_objects_by_id(obj_ids) {
        return this._objects.find({ _id: { $in: obj_ids } });
    }

    /**
     * populate a certain doc path which contains object ids to another collection
     * @template {{}} T
     * @param {T[]} docs
     * @param {string} doc_path
     * @param {Object} [fields]
     * @returns {Promise<T[]>}
     */
    async populate_objects(docs, doc_path, fields) {
        return db_client.instance().populate(docs, doc_path, this._objects, fields);
    }

    async find_object_latest(bucket_id, key) {
        return this._objects.findOne({
            // index fields:
            bucket: bucket_id,
            key,
            version_past: null,
            // partialFilterExpression:
            deleted: null,
            upload_started: null,
        }, {
            hint: 'latest_version_index',
            sort: { bucket: 1, key: 1, version_past: 1 },
        });
    }

    async find_object_null_version(bucket_id, key) {
        return this._objects.findOne({
            // index fields:
            bucket: bucket_id,
            key,
            version_enabled: null,
            // partialFilterExpression:
            deleted: null,
            upload_started: null,
        }, {
            hint: 'null_version_index',
            sort: { bucket: 1, key: 1, version_enabled: 1 },
        });
    }

    async find_object_or_upload_null_version(bucket_id, key) {
        return this._objects.findOne({
            // index fields:
            bucket: bucket_id,
            key,
            version_enabled: null,
            // partialFilterExpression:
            deleted: null,
        }, {
            sort: { bucket: 1, key: 1, version_enabled: 1 },
        });
    }

    async find_object_by_version(bucket_id, key, version_seq) {
        return this._objects.findOne({
            // index fields:
            bucket: bucket_id,
            key,
            version_seq,
            // partialFilterExpression:
            deleted: null,
            upload_started: null,
        }, {
            hint: 'version_seq_index',
            sort: { bucket: 1, key: 1, version_seq: -1 },
        });
    }

    async find_object_prev_version(bucket_id, key) {
        return this._objects.findOne({
            // index fields:
            bucket: bucket_id,
            key: key,
            // partialFilterExpression:
            deleted: null,
            upload_started: null,
            // scan:
            // `version_past: null` is limited to 1 because latest_version_index is unique,
            // so worst case we scan 2 docs before we find one with `version_past: true`
            version_past: true,
        }, {
            hint: 'version_seq_index',
            sort: { bucket: 1, key: 1, version_seq: -1 },
        });
    }

    // 2, 3
    async remove_object_and_unset_latest(obj) {
        const res = await this._objects.updateOne({
            _id: obj._id,
            deleted: null
        }, {
            $set: {
                deleted: new Date(),
                version_past: true,
            },
        });
        db_client.instance().check_update_one(res, 'object');
    }

    async remove_objects_and_unset_latest(objs) {
        if (!objs || !objs.length) return;

        await this._objects.updateMany(
            {
                _id: {
                    $in: objs.map(obj => obj._id),
                }
            },
            {
                $set: {
                    deleted: new Date(),
                    version_past: true,
                },
            }
        );
    }

    // 2, 3, 4
    async remove_object_move_latest(old_latest_obj, new_latest_obj) {
        const bulk = this._objects.initializeOrderedBulkOp();
        bulk.find({ _id: old_latest_obj._id, deleted: null })
            .updateOne({ $set: { deleted: new Date(), version_past: true } });
        bulk.find({ _id: new_latest_obj._id, deleted: null })
            .updateOne({ $unset: { version_past: true } });
        const res = await bulk.execute();
        if (!res.ok || res.nMatched !== 2 || res.nModified !== 2) {
            dbg.error('remove_object_move_latest: partial bulk update',
                _.clone(res), old_latest_obj, new_latest_obj);
            throw new Error('remove_object_move_latest: partial bulk update');
        }
    }

    async _delete_marker_from_obj(obj, version_enabled) {
        const version_seq = await this.alloc_object_version_seq();
        const delete_marker = {
            _id: MDStore.instance().make_md_id(),
            system: obj.system,
            bucket: obj.bucket,
            key: obj.key,
            content_type: obj.content_type || mime.getType(obj.key) || 'application/octet-stream',
            delete_marker: true,
            create_time: new Date(),
            version_seq,
        };
        if (version_enabled) delete_marker.version_enabled = true;
        return delete_marker;
    }

    async insert_object_delete_marker(obj) {
        const delete_marker = await this._delete_marker_from_obj(obj, obj.version_enabled);
        await MDStore.instance().insert_object(delete_marker);
        return delete_marker;
    }

    async insert_object_delete_marker_move_latest(obj, version_enabled) {
        const delete_marker = await this._delete_marker_from_obj(obj, version_enabled);
        const bulk = this._objects.initializeOrderedBulkOp();
        bulk.find({ _id: obj._id, deleted: null })
            .updateOne({ $set: { version_past: true } });
        bulk.insert(delete_marker);
        const res = await bulk.execute();
        if (!res.ok || res.nMatched !== 1 || res.nModified !== 1 || res.nInserted !== 1) {
            dbg.error('insert_object_delete_marker_move_latest: partial bulk update',
                _.clone(res), obj, delete_marker);
            throw new Error('insert_object_delete_marker_move_latest: partial bulk update');
        }
        return delete_marker;
    }

    /**
     * @param {Object} params
     * @param {nb.ObjectMD} params.unmark_obj
     * @param {nb.ObjectMD} params.put_obj
     * @param {Object} [params.set_updates]
     * @param {Object} [params.unset_updates]
     * @returns {Promise<void>}
     */
    async complete_object_upload_latest_mark_remove_current({
        unmark_obj,
        put_obj,
        set_updates,
        unset_updates,
    }) {
        const bulk = this._objects.initializeOrderedBulkOp();
        bulk.find({ _id: unmark_obj._id, deleted: null })
            .updateOne({ $set: { version_past: true } });
        bulk.find({ _id: put_obj._id, deleted: null })
            .updateOne({ $set: set_updates, $unset: unset_updates });
        const res = await bulk.execute();
        if (!res.ok || res.nMatched !== 2 || res.nModified !== 2) {
            dbg.error('complete_object_upload_latest_mark_remove_current: partial bulk update',
                _.clone(res), unmark_obj, put_obj, set_updates, unset_updates);
            throw new Error('complete_object_upload_latest_mark_remove_current: partial bulk update');
        }
    }

    /**
     * @param {Object} params
     * @param {nb.ObjectMD} [params.delete_obj]
     * @param {nb.ObjectMD} params.unmark_obj
     * @param {nb.ObjectMD} params.put_obj
     * @param {Object} [params.set_updates]
     * @param {Object} [params.unset_updates]
     * @returns {Promise<void>}
     */
    async complete_object_upload_latest_mark_remove_current_and_delete({
        delete_obj,
        unmark_obj,
        put_obj,
        set_updates,
        unset_updates,
    }) {
        const bulk = this._objects.initializeOrderedBulkOp();
        if (delete_obj) {
            bulk.find({ _id: delete_obj._id, deleted: null })
                .updateOne({ $set: { deleted: new Date() } });
            bulk.find({ _id: unmark_obj._id, deleted: null })
                .updateOne({ $set: { version_past: true } });
        } else {
            bulk.find({ _id: unmark_obj._id, deleted: null })
                .updateOne({ $set: { deleted: new Date(), version_past: true } });
        }

        bulk.find({ _id: put_obj._id, deleted: null })
            .updateOne({ $set: set_updates, $unset: unset_updates });
        const res = await bulk.execute();
        const number_of_queries = delete_obj ? 3 : 2;
        if (!res.ok || res.nMatched !== number_of_queries || res.nModified !== number_of_queries) {
            dbg.error('complete_object_upload_latest_mark_remove_current_and_delete: partial bulk update',
                _.clone(res), unmark_obj, put_obj, set_updates, unset_updates);
            throw new Error('complete_object_upload_latest_mark_remove_current_and_delete: partial bulk update');
        }
    }

    /**
     * This is for the 2, 3 and 3` for latest removal (3 objects)
     * @param {nb.ObjectMD} obj
     * @param {nb.ObjectMD} [latest_obj]
     * @returns {Promise<nb.ObjectMD>}
     */
    async insert_object_delete_marker_move_latest_with_delete(obj, latest_obj) {
        const delete_marker = await this._delete_marker_from_obj(obj, obj.version_enabled);
        const bulk = this._objects.initializeOrderedBulkOp();
        let num_updates = 0;
        if (latest_obj) {
            bulk.find({ _id: latest_obj._id, deleted: null })
                .updateOne({ $set: { version_past: true } });
            bulk.find({ _id: obj._id, deleted: null })
                .updateOne({ $set: { deleted: new Date() } });
            num_updates = 2;
        } else {
            bulk.find({ _id: obj._id, deleted: null })
                .updateOne({ $set: { deleted: new Date(), version_past: true } });
            num_updates = 1;
        }
        bulk.insert(delete_marker);
        const res = await bulk.execute();
        if (!res.ok || res.nMatched !== num_updates || res.nModified !== num_updates || res.nInserted !== 1) {
            dbg.error('insert_object_delete_marker_move_latest_with_delete: partial bulk update',
                _.clone(res), latest_obj, obj, delete_marker);
            throw new Error('insert_object_delete_marker_move_latest_with_delete: partial bulk update');
        }
        return delete_marker;
    }

    /**
     * @returns {Promise<number>}
     */
    async alloc_object_version_seq() {
        // empty query, we maintain a single doc in this collection
        const query = {};
        const update = { $inc: { object_version_seq: 1 } };
        const options = { upsert: true, returnOriginal: false };
        let res = await this._sequences.findOneAndUpdate(query, update, options);
        return res.value.object_version_seq;
    }

    /**
     * TODO define indexes used by find_objects()
     *
     * @typedef {Object} FindObjectsParams
     * @property {nb.ID} bucket_id
     * @property {string|RegExp} key
     * @property {boolean} [upload_mode]
     * @property {boolean} [latest_versions]
     * @property {boolean} [filter_delete_markers]
     * @property {number} [max_create_time]
     * @property {number} [max_size]
     * @property {number} [min_size]
     * @property {Array<{ key: string; value: string; }>} [tagging]
     * @property {number} [skip]
     * @property {number} [limit]
     * @property {string} [sort]
     * @property {1|-1} [order]
     * @property {boolean} [pagination]
     *
     * @typedef {Object} FindObjectsReply
     * @property {nb.ObjectMD[]} objects
     * @property {{ non_paginated: Object, by_mode: Object }} counters
     *
     * @param {FindObjectsParams} params
     * @returns {Promise<FindObjectsReply>}
     */
    async find_objects({
        bucket_id,
        key,
        upload_mode,
        latest_versions,
        filter_delete_markers,
        max_create_time,
        max_size,
        min_size,
        tagging,
        skip,
        limit,
        sort,
        order,
        pagination,
    }) {
        let version_past;
        if (latest_versions === true) version_past = null;
        else if (latest_versions === false) version_past = true;
        let delete_marker;
        if (filter_delete_markers === true) delete_marker = null;
        else if (filter_delete_markers === false) delete_marker = true;

        const query = compact({
            bucket: bucket_id,
            key: key,
            deleted: null,
            // allow filtering of uploading/non-uploading objects
            create_time: max_create_time ? {
                $lt: new Date(moment.unix(max_create_time).toISOString()),
                $exists: true
            } : undefined,
            tagging: tagging ? {
                $all: tagging,
            } : undefined,
            size: (max_size || min_size) ?
                compact({
                    $gt: min_size,
                    $lt: max_size,
                    $exists: true,
                }) : undefined,
            upload_started: typeof upload_mode === 'boolean' ? {
                $exists: upload_mode
            } : undefined,
            version_past,
            delete_marker,
        });

        const completed_query = _.omit(query, 'upload_started');
        completed_query.upload_started = { $exists: false };
        const uploading_query = _.omit(query, 'upload_started');
        uploading_query.upload_started = { $exists: true };

        const [objects, non_paginated, completed, uploading] = await Promise.all([
            this._objects.find(query, {
                limit: Math.min(limit, 1000),
                skip: skip,
                sort: sort ? {
                    [sort]: (order === -1 ? -1 : 1)
                } : undefined
            }),
            pagination ? this._objects.countDocuments(query) : undefined,
            // completed uploads count
            this._objects.countDocuments(completed_query),
            // uploading count
            this._objects.countDocuments(uploading_query)
        ]);

        return {
            objects,
            counters: {
                non_paginated,
                by_mode: {
                    completed,
                    uploading
                }
            }
        };
    }

    async find_unreclaimed_objects(limit) {
        const results = await this._objects.find({
            deleted: { $exists: true },
            reclaimed: null
        }, {
            limit: Math.min(limit, 1000),
            hint: 'deleted_unreclaimed_index',
        });
        return results;
    }

    async list_objects({
        bucket_id,
        delimiter,
        prefix,
        key_marker,
        limit
    }) {
        const hint = 'latest_version_index';
        const sort = { bucket: 1, key: 1 };

        // for mongodb add version_past to the sort
        if (process.env.DB_TYPE === 'mongodb') {
            sort.version_past = 1;
        }

        const { key_query } = this._build_list_key_query_from_markers(prefix, delimiter, key_marker);

        const query = compact({
            // index fields:
            bucket: bucket_id,
            key: key_query,
            version_past: null,
            // partialFilterExpression:
            deleted: null,
            upload_started: null,
            // scan (max 1):
            delete_marker: null
        });

        if (delimiter) {
            const mr_results = await this._objects.mapReduce(
                mongo_functions.map_common_prefixes,
                mongo_functions.reduce_common_prefixes, {
                    query,
                    limit,
                    sort,
                    hint, // hint is not supported in mapReduce, so assume sort will enforce the correct index
                    scope: { prefix, delimiter },
                    out: { inline: 1 }
                }
            );
            const results = normalize_list_mr_results(mr_results, prefix);
            results.sort(sort_list_objects_with_delimiter);
            return results;
        } else {
            const results = await this._objects.find(query, {
                limit,
                sort,
                hint,
            });
            return results;
        }
    }

    async list_object_versions({
        bucket_id,
        delimiter,
        prefix,
        key_marker,
        limit,
        version_seq_marker,
    }) {
        const hint = 'version_seq_index';
        const sort = { bucket: 1, key: 1, version_seq: -1 };

        const { key_query, or_query } = this._build_list_key_query_from_markers(
            prefix, delimiter, key_marker, /*upload_started_marker*/ undefined, version_seq_marker
        );

        const query = compact({
            // index fields:
            bucket: bucket_id,
            key: key_query,
            $or: or_query,
            // partialFilterExpression:
            deleted: null,
            upload_started: null,
        });

        if (delimiter) {
            const mr_results = await this._objects.mapReduce(
                mongo_functions.map_common_prefixes,
                mongo_functions.reduce_common_prefixes, {
                    query,
                    limit,
                    sort,
                    hint, // hint is not supported in mapReduce, so assume sort will enforce the correct index
                    scope: { prefix, delimiter },
                    out: { inline: 1 }
                }
            );
            const results = normalize_list_mr_results(mr_results, prefix);
            results.sort(sort_list_versions_with_delimiter);
            return results;
        } else {
            const results = await this._objects.find(query, {
                limit,
                sort,
                hint,
            });
            return results;
        }
    }

    async list_uploads({
        bucket_id,
        delimiter,
        prefix,
        key_marker,
        limit,
        upload_started_marker,
    }) {
        const hint = 'upload_index';
        const sort = { bucket: 1, key: 1, upload_started: 1 };

        const { key_query, or_query } = this._build_list_key_query_from_markers(
            prefix, delimiter, key_marker, upload_started_marker, /*version_seq_marker*/ undefined
        );

        const query = compact({
            // index fields:
            bucket: bucket_id,
            key: key_query,
            $or: or_query,
            // partialFilterExpression:
            deleted: null,
            // Note: $exists is less optimized than comparing to null
            upload_started: { $exists: true }
        });

        if (delimiter) {
            const mr_results = await this._objects.mapReduce(
                mongo_functions.map_common_prefixes,
                mongo_functions.reduce_common_prefixes, {
                    query,
                    limit,
                    sort,
                    hint, // hint is not supported in mapReduce, so assume sort will enforce the correct index
                    scope: { prefix, delimiter },
                    out: { inline: 1 }
                }
            );
            const results = normalize_list_mr_results(mr_results, prefix);
            results.sort(sort_list_uploads_with_delimiter);
            return results;
        } else {
            const results = await this._objects.find(query, {
                limit,
                sort,
                hint,
            });
            return results;
        }
    }

    _build_list_key_query_from_prefix(prefix) {
        // filter keys starting with prefix
        return prefix ? { key_query: new RegExp('^' + _.escapeRegExp(prefix)) } : {};
    }

    _build_list_key_query_from_markers(prefix, delimiter, key_marker, upload_started_marker, version_seq_marker) {
        if (!key_marker) {
            return this._build_list_key_query_from_prefix(prefix);
        }
        if (!key_marker.startsWith(prefix)) {
            throw new Error(`BAD KEY MARKER ${key_marker} FOR PREFIX ${prefix}`);
        }
        const key_query = { $gt: key_marker };

        // filter keys starting with prefix
        let regexp_text = '^' + _.escapeRegExp(prefix);

        // Optimization:
        // when using delimiter and key_marker ends with delimiter,
        // this means the last iteration ended on a directory, i.e. common prefix,
        // so we can safely skip any objects under that directory,
        // since all these keys have the same common prefix and surely not > key_marker.
        // this is also safe with secondary markers such as upload_started_marker or version_seq_marker,
        // since common prefixes are never assumed to have a secondary marker.
        const key_marker_suffix = key_marker.slice(prefix.length);
        if (delimiter && key_marker_suffix.endsWith(delimiter)) {
            regexp_text += '(?!' + _.escapeRegExp(key_marker_suffix) + ')';
        }
        if (regexp_text !== '^') {
            key_query.$regex = new RegExp(regexp_text);
        }

        if (upload_started_marker) {
            return {
                or_query: [{
                    // this match keys with the last key_marker and next (ascending) upload_started_marker
                    key: key_marker,
                    upload_started: { $gt: upload_started_marker }
                }, {
                    key: key_query
                }]
            };
        }

        if (version_seq_marker) {
            return {
                or_query: [{
                    // this match keys with the last key_marker and next (descending) version_seq_marker
                    key: key_marker,
                    version_seq: { $lt: version_seq_marker }
                }, {
                    key: key_query
                }]
            };
        }

        return { key_query };
    }

    _get_unique_latest_keys(keys) {
        return _.compact(_.map(keys, key => (key.obj ? (!key.obj.version_past && key) : key)));
    }

    async had_any_objects_in_system(system_id) {
        // this is not an optimized query but since we have a single system we dont care for now.
        const obj = await this._objects.findOne({ system: system_id });
        return Boolean(obj);
    }

    async has_any_completed_objects_in_bucket(bucket_id) {
        const obj = await this._objects.findOne({
            // index fields:
            bucket: bucket_id,
            // prefix for stored blob blocks information. TODO: move somwhere like config.js
            key: { $not: /^\.noobaa_blob_blocks/ },
            // partialFilterExpression:
            deleted: null,
            upload_started: null,
        }, {
            hint: 'version_seq_index',
            sort: { bucket: 1, key: 1, version_seq: -1 },
        });
        return Boolean(obj);
    }

    async count_objects_of_bucket(bucket_id) {
        return this._objects.countDocuments({
            bucket: bucket_id,
            deleted: null,
            delete_marker: null,
            version_past: null
        });
    }

    async has_any_latest_objects_for_bucket(bucket_id, upload_mode) {
        if (upload_mode === true) return false;
        return this._objects.findOne({
                bucket: bucket_id,
                deleted: null,
                delete_marker: null,
                version_past: null
            })
            .then(obj => Boolean(obj));
    }

    async count_objects_per_bucket(system_id) {
        // TODO check which index is needed to cover this aggregation
        const res = await this._objects.groupBy({
            system: system_id,
            deleted: null,
            delete_marker: null,
            version_past: null
        }, {
            _id: '$bucket',
            count: {
                $sum: 1
            }
        });
        const buckets = {};
        let total_count = 0;
        _.forEach(res, r => {
            buckets[r._id] = r.count;
            total_count += r.count;
        });
        buckets[''] = total_count;
        return buckets;
    }

    async aggregate_objects_by_create_dates(from_time, till_time) {
        return this._aggregate_objects_internal({
            create_time: {
                $gte: new Date(from_time),
                $lt: new Date(till_time),
                $exists: true
            }
        });
    }

    async aggregate_objects_by_delete_dates(from_time, till_time) {
        return this._aggregate_objects_internal({
            deleted: {
                $gte: new Date(from_time),
                $lt: new Date(till_time),
            },
            create_time: { $exists: true }
        });
    }


    /**
     * _aggregate_objects_internal - counts the number of objects and sum of sizes,
     * both for the entire query, and per bucket.
     * @return <Object> buckets - each bucket value is an object with properties: size, count.
     *      the '' key represents the entire query and others are bucket ids.
     */
    async _aggregate_objects_internal(query) {
        const res = await this._objects.mapReduce(
            mongo_functions.map_aggregate_objects,
            mongo_functions.reduce_sum, {
                query,
                out: { inline: 1 }
            }
        );
        const buckets = {};
        _.forEach(res, r => {
            r._id.reduce((o, s, i, arr) => {
                o[s] = i < arr.length - 1 ?
                    o[s] || {} :
                    o[s] = r.value;
                return o[s];
            }, buckets);
        });
        return buckets;
    }

    async find_deleted_objects(max_delete_time, limit) {
        const objects = await this._objects.find({
            deleted: {
                $lt: new Date(max_delete_time),
                $exists: true // This forces the index to be used
            },
        }, {
            limit: Math.min(limit, 1000),
            projection: {
                _id: 1,
                deleted: 1
            }
        });
        return db_client.instance().uniq_ids(objects, '_id');
    }

    async db_delete_objects(object_ids) {
        if (!object_ids || !object_ids.length) return;
        dbg.warn('Removing the following objects from DB:', object_ids);
        return this._objects.deleteMany({
            _id: { $in: object_ids },
            deleted: { $exists: true }
        });
    }

    get_object_version_id({ version_seq, version_enabled }) {
        if (!version_enabled || !version_seq) return 'null';
        return `nbver-${version_seq}`;
    }

    ////////////////
    // MULTIPARTS //
    ////////////////

    insert_multipart(multipart) {
        this._multiparts.validate(multipart);
        return this._multiparts.insertOne(multipart);

    }

    update_multipart_by_id(multipart_id, set_updates) {
        return this._multiparts.updateOne({
                _id: multipart_id,
            }, compact_updates(set_updates))
            .then(res => db_client.instance().check_update_one(res, 'multipart'));
    }

    update_multiparts_by_ids(multipart_ids, set_updates, unset_updates) {
        if (!multipart_ids || !multipart_ids.length) return;
        return this._multiparts.updateMany({
            _id: { $in: multipart_ids }
        }, compact_updates(set_updates, unset_updates));
    }

    /**
     * @param {nb.ID} multipart_id
     * @returns {Promise<nb.ObjectMultipart>}
     */
    find_multipart_by_id(multipart_id) {
        return this._multiparts.findOne({
                _id: multipart_id,
            })
            .then(obj => db_client.instance().check_entity_not_deleted(obj, 'multipart'));
    }

    /**
     * @param {nb.ID} obj_id
     * @returns {Promise<nb.ObjectMultipart[]>}
     */
    async find_all_multiparts_of_object(obj_id) {
        return this._multiparts.find({
            obj: { $eq: obj_id, $exists: true },
            deleted: null
        });
    }

    /**
     * @param {nb.ID} obj_id
     * @param {number} [num_gt]
     * @param {number} [limit]
     * @returns {Promise<nb.ObjectMultipart[]>}
     */
    find_completed_multiparts_of_object(obj_id, num_gt, limit) {
        return this._multiparts.find({
            obj: { $eq: obj_id, $exists: true },
            num: { $gt: num_gt },
            size: { $exists: true },
            md5_b64: { $exists: true },
            create_time: { $exists: true },
        }, {
            sort: {
                num: 1,
                create_time: -1, // last-completed first
            },
            limit: limit,
        });
    }

    delete_multiparts_of_object(obj) {
        const delete_date = new Date();
        return this._multiparts.updateMany({
            obj: { $eq: obj._id, $exists: true },
            deleted: null
        }, {
            $set: {
                deleted: delete_date
            },
        });
    }

    delete_multiparts(multiparts) {
        const delete_date = new Date();
        return this._multiparts.updateMany({
            _id: { $in: db_client.instance().uniq_ids(multiparts, '_id') },
        }, {
            $set: {
                deleted: delete_date
            },
        });
    }

    async db_delete_multiparts_of_object(id) {
        const res = await this._multiparts.deleteMany({
            obj: { $eq: id, $exists: true },
            deleted: { $exists: true }
        });
        dbg.warn(`Removed ${res.result.n} multiparts of object ${id} from DB`);
    }

    has_any_objects_for_bucket_including_deleted(bucket_id) {
        return this._objects.findOne({
                bucket: bucket_id,
            })
            .then(obj => Boolean(obj));
    }

    has_any_objects_for_bucket(bucket_id, upload_mode) {
        let upload_started;
        if (upload_mode === true) {
            upload_started = { $exists: true };
        } else if (upload_mode === false) {
            upload_started = null;
        }

        return this._objects.findOne(_.omitBy({
                bucket: bucket_id,
                deleted: null,
                upload_started
            }, _.isUndefined))
            .then(obj => Boolean(obj));
    }

    has_any_uploads_for_bucket(bucket_id) {
        return this._objects.findOne({
                bucket: bucket_id,
                deleted: null,
                upload_started: { $exists: true }
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
        return this._parts.insertManyUnordered(parts);
    }

    /**
     * @param {Object} params
     * @param {nb.ID} params.obj_id
     * @param {number} params.start_gte
     * @param {number} params.start_lt
     * @param {number} params.end_gt
     * @returns {Promise<nb.PartSchemaDB[]>}
     */
    async find_parts_by_start_range({ obj_id, start_gte, start_lt, end_gt }) {
        return this._parts.find({
            obj: { $eq: obj_id, $exists: true },
            start: {
                // since end is not indexed we query start with both
                // low and high constraint, which allows the index to reduce scan
                // we use a constant that limits the max part size because
                // this is the only way to limit the minimal start value
                $gte: start_gte,
                $lt: start_lt,
            },
            end: { $gt: end_gt },
            deleted: null,
            uncommitted: null,
        }, {
            sort: { start: 1 },
        });
    }

    /**
     * @param {Object} params
     * @param {nb.ID} params.obj_id
     * @param {number} [params.skip]
     * @param {number} [params.limit]
     */
    async find_parts_sorted_by_start({ obj_id, skip, limit }) {
        return this._parts.find({
            obj: { $eq: obj_id, $exists: true },
            deleted: null,
            uncommitted: null,
        }, {
            sort: { start: 1 },
            skip: skip || 0,
            limit: limit || 0,
        });
    }

    /**
     * @param {nb.ObjectMD} obj
     * @returns {Promise<nb.ID[]>}
     */
    async find_parts_chunk_ids(obj) {
        const find = {
            obj: { $eq: obj._id, $exists: true },
            deleted: null,
        };
        return this._parts.find(find, {
                projection: {
                    _id: 0,
                    chunk: 1,
                },
                hint: 'obj_1_start_1'
            })

            .then(parts => db_client.instance().uniq_ids(parts, 'chunk'));
    }

    /**
     * @param {nb.ID[]} chunk_ids
     * @returns {Promise<nb.PartSchemaDB[]>}
     */
    async find_parts_by_chunk_ids(chunk_ids) {
        return this._parts.find({
            chunk: { $in: chunk_ids, $exists: true },
            deleted: null,
        });
    }

    /**
     * @param {nb.ID[]} part_ids
     *
     */
    async delete_parts_by_ids(part_ids) {
        if (!part_ids || !part_ids.length) return;

        const delete_date = new Date();
        return this._parts.updateMany({
            _id: {
                $in: part_ids
            },
            deleted: null
        }, {
            $set: {
                deleted: delete_date
            },
        });
    }
    /**
     * @param {nb.ID[]} chunk_ids
     * @returns {Promise<nb.ID[]>}
     */
    async find_parts_unreferenced_chunk_ids(chunk_ids) {
        return this._parts.find({
                chunk: { $in: chunk_ids, $exists: true },
                deleted: null,
            }, {
                projection: {
                    _id: 0,
                    chunk: 1
                }
            })

            .then(parts => {
                const referenced_chunks_ids = db_client.instance().uniq_ids(parts, 'chunk');
                const unreferenced_chunks_ids = db_client.instance().obj_ids_difference(chunk_ids, referenced_chunks_ids);
                dbg.log0('find_object_parts_unreferenced_chunk_ids:',
                    'chunk_ids', chunk_ids.length,
                    'referenced_chunks_ids', referenced_chunks_ids.length,
                    'unreferenced_chunks_ids', unreferenced_chunks_ids.length);
                return unreferenced_chunks_ids;
            });
    }

    find_parts_chunks_references(chunk_ids) {
        return this._parts.find({
                chunk: { $in: chunk_ids, $exists: true },
                deleted: null,
            })

            .then(parts => {
                const parts_by_chunk_id = _.groupBy(parts, 'chunk');
                return parts_by_chunk_id;
            });
    }

    /**
     * @param {nb.ChunkSchemaDB[]} chunks
     */
    async load_parts_objects_for_chunks(chunks) {
        if (!chunks || !chunks.length) return;
        const parts = await this._parts.find({
            chunk: { $in: db_client.instance().uniq_ids(chunks, '_id'), $exists: true },
            deleted: null
        });
        const objects = await this._objects.find({
            _id: { $in: db_client.instance().uniq_ids(parts, 'obj'), $exists: true }
        });
        const parts_by_chunk = _.groupBy(parts, 'chunk');
        const objects_by_id = _.keyBy(objects, '_id');
        for (const chunk of chunks) {
            chunk.parts = parts_by_chunk[chunk._id.toHexString()] || [];
            chunk.objects = _.uniq(_.compact(_.map(chunk.parts, part => objects_by_id[part.obj.toHexString()])));
        }
    }

    /**
     * @param {nb.ObjectMD} obj
     * @returns {Promise<nb.PartSchemaDB[]>}
     */
    async find_all_parts_of_object(obj) {
        return this._parts.find({ obj: { $eq: obj._id, $exists: true }, deleted: null });
    }

    update_parts_in_bulk(parts_updates) {
        const bulk = this._parts.initializeUnorderedBulkOp();
        for (const update of parts_updates) {
            bulk.find({ _id: update._id })
                .updateOne(compact_updates(update.set_updates, update.unset_updates));
        }
        return bulk.length ? bulk.execute() : P.resolve();
    }

    delete_parts_of_object(obj) {
        const delete_date = new Date();
        return this._parts.updateMany({
            obj: { $eq: obj._id, $exists: true },
            deleted: null
        }, {
            $set: {
                deleted: delete_date
            },
        });
    }

    delete_parts(parts) {
        const delete_date = new Date();
        return this._parts.updateMany({
            _id: { $in: db_client.instance().uniq_ids(parts, '_id') },
        }, {
            $set: {
                deleted: delete_date
            },
        });
    }

    async db_delete_parts_of_object(id) {
        const res = await this._parts.deleteMany({
            obj: { $eq: id, $exists: true },
            deleted: { $exists: true }
        });
        dbg.warn(`Removed ${res.result.n} parts of object ${id} from DB`);
    }


    ////////////
    // CHUNKS //
    ////////////

    insert_chunks(chunks) {
        if (!chunks || !chunks.length) return;
        for (const chunk of chunks) {
            this._chunks.validate(chunk);
        }
        return this._chunks.insertManyUnordered(chunks);
    }

    update_chunk_by_id(chunk_id, set_updates, unset_updates) {
        return this._chunks.updateOne({
                _id: chunk_id
            }, compact_updates(set_updates, unset_updates))
            .then(res => db_client.instance().check_update_one(res, 'chunk'));
    }

    /**
     * @param {nb.ID[]} chunk_ids
     * @param {Object} [set_updates]
     * @param {Object} [unset_updates]
     */
    async update_chunks_by_ids(chunk_ids, set_updates, unset_updates) {
        if (!chunk_ids || !chunk_ids.length) return;
        return this._chunks.updateMany({
            _id: {
                $in: chunk_ids
            }
        }, compact_updates(set_updates, unset_updates));
    }

    /**
     * @param {nb.ID[]} chunk_ids
     * @returns {Promise<nb.ChunkSchemaDB[]>}
     */
    find_chunks_by_ids(chunk_ids) {
        if (!chunk_ids || !chunk_ids.length) return;
        return this._chunks.find({ _id: { $in: chunk_ids } });
    }

    populate_chunks(docs, doc_path, fields) {
        return db_client.instance().populate(docs, doc_path, this._chunks, fields);
    }

    /**
     * @param {nb.Bucket} bucket
     * @param {nb.DBBuffer[]} dedup_keys
     * @returns {Promise<nb.ChunkSchemaDB[]>}
     */
    async find_chunks_by_dedup_key(bucket, dedup_keys) {
        // TODO: This is temporary patch because of binary representation in MongoDB and PostgreSQL
        /** @type {nb.ChunkSchemaDB[]} */
        const chunks = await this._chunks.find({
            system: bucket.system._id,
            bucket: bucket._id,
            dedup_key: {
                $in: dedup_keys,
                $exists: true
            },
            deleted: null,
        }, {
            sort: {
                _id: -1 // get newer chunks first
            }
        });
        await this.load_blocks_for_chunks(chunks);
        return chunks;
    }

    iterate_all_chunks_in_buckets(lower_marker, upper_marker, buckets, limit) {
        return this._chunks.find(compact({
                _id: lower_marker ? compact({
                    $gt: lower_marker,
                    $lte: upper_marker
                }) : undefined,
                deleted: null,
                bucket: {
                    $in: buckets
                }
            }), {
                projection: {
                    _id: 1
                },
                sort: {
                    _id: 1
                },
                limit: limit,
            })

            .then(chunks => ({
                chunk_ids: db_client.instance().uniq_ids(chunks, '_id'),
                marker: chunks.length ? chunks[chunks.length - 1]._id : null,
            }));
    }

    iterate_all_chunks(marker, limit) {
        return this._chunks.find(compact({
                _id: marker ? {
                    $lt: marker
                } : undefined,
                deleted: null,
            }), {
                projection: {
                    _id: 1
                },
                sort: {
                    _id: -1
                },
                limit: limit,
            })

            .then(chunks => ({
                chunk_ids: db_client.instance().uniq_ids(chunks, '_id'),
                marker: chunks.length ? chunks[chunks.length - 1]._id : null,
            }));
    }

    find_oldest_tier_chunk_ids(tier, limit, sort_direction) {
        const sort = {
            tier: sort_direction * -1,
            tier_lru: sort_direction
        };
        return this._chunks.find({
                tier: { $eq: tier, $exists: true },
                deleted: null,
            }, {
                projection: { _id: 1 },
                hint: 'tiering_index',
                sort,
                limit,
            })

            .then(chunks => db_client.instance().uniq_ids(chunks, '_id'));
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
        return this._chunks.mapReduce(
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

    /**
     * @param {nb.ID[]} chunk_ids
     */
    async delete_chunks_by_ids(chunk_ids) {
        const delete_date = new Date();
        if (!chunk_ids || !chunk_ids.length) return;
        return this._chunks.updateMany({
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

    // Only for clean up in testing - Don't use unless you are sure!!!!
    async delete_all_chunks_in_system() {
        assert(config.test_mode, 'This function should be called only in test mode!');
        const delete_date = new Date();
        return this._chunks.updateMany({}, {
            $set: {
                deleted: delete_date,
            },
        });
    }

    delete_object_by_id(object_id) {
        if (!object_id) return;
        return this._objects.updateOne({
            _id: object_id,
            deleted: null
        }, {
            $set: {
                deleted: new Date(),
            },
        });
    }

    get_dedup_index_size() {
        return this._chunks.stats()
            .then(res => res.indexSizes.dedup_key_1);
    }

    get_aprox_dedup_keys_number() {
        // This function estimates the number of items in the dedup index - it does it by sample 10K chunks - and check how much of them are deduped
        // and then calculates the aproximate number of the total indexed dedup chunks - this was the fastest soultion we found
        // both iterating over the chunks and running a query over all the chunks was too lengthy operations.
        return Promise.all([
                this._chunks.estimatedDocumentCount(),
                this._chunks.estimatedQueryCount({ dedup_key: { $exists: true } }),
            ])
            .then(([total_count, sample_count]) => (sample_count ? sample_count : total_count));
    }

    iterate_indexed_chunks(limit, marker) {
        return this._chunks.find({
                dedup_key: marker ? { $lt: marker, $exists: true } : { $exists: true }
            }, {
                projection: {
                    _id: 1,
                    dedup_key: 1
                },
                sort: {
                    dedup_key: -1
                },
                limit: limit,
            })

            .then(chunks => ({
                chunk_ids: db_client.instance().uniq_ids(chunks, '_id'),
                marker: chunks.length ? chunks[chunks.length - 1].dedup_key : null,
            }));
    }

    find_deleted_chunks(max_delete_time, limit) {
        const query = {
            deleted: {
                $lt: new Date(max_delete_time)
            },
        };
        return this._chunks.find(query, {
                limit: Math.min(limit, 1000),
                projection: {
                    _id: 1,
                    deleted: 1
                }
            })
            .then(objects => db_client.instance().uniq_ids(objects, '_id'));
    }

    has_any_blocks_for_chunk(chunk_id) {
        return this._blocks.findOne({
                chunk: { $eq: chunk_id, $exists: true },
            })
            .then(obj => Boolean(obj));
    }

    has_any_parts_for_chunk(chunk_id) {
        return this._parts.findOne({
                chunk: { $eq: chunk_id, $exists: true },
            })
            .then(obj => Boolean(obj));
    }


    has_any_parts_for_object(obj) {
        return this._parts.findOne({
                obj: { $eq: obj._id, $exists: true },
                deleted: null
            })
            .then(part => Boolean(part));
    }

    db_delete_chunks(chunk_ids) {
        if (!chunk_ids || !chunk_ids.length) return;
        dbg.warn('Removing the following chunks from DB:', chunk_ids);
        return this._chunks.deleteMany({
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
        return this._blocks.find(query, {
            sort: { _id: -1 },
            limit: limit,
        });
    }

    insert_blocks(blocks) {
        if (!blocks || !blocks.length) return;
        for (const block of blocks) {
            this._blocks.validate(block);
        }
        return this._blocks.insertManyUnordered(blocks);
    }

    update_blocks_by_ids(block_ids, set_updates, unset_updates) {
        if (!block_ids || !block_ids.length) return;
        return this._blocks.updateMany({
            _id: {
                $in: block_ids
            }
        }, compact_updates(set_updates, unset_updates));
    }

    /**
     * @param {nb.ID[]} chunk_ids
     * @returns {Promise<nb.BlockSchemaDB[]>}
     */
    async find_blocks_of_chunks(chunk_ids) {
        if (!chunk_ids || !chunk_ids.length) return;
        const blocks = await this._blocks.find({
            chunk: { $in: chunk_ids, $exists: true },
        });
        return blocks;
    }

    /**
     * @param {nb.ChunkSchemaDB[]} chunks
     * @param {?(a: any, b: any) => number} [sorter]
     * @return {Promise<void>}
     */
    async load_blocks_for_chunks(chunks, sorter) {
        if (!chunks || !chunks.length) return;
        const blocks = await this._blocks.find({
            chunk: { $in: db_client.instance().uniq_ids(chunks, '_id'), $exists: true },
            deleted: null,
        });
        const blocks_by_chunk = _.groupBy(blocks, 'chunk');
        for (const chunk of chunks) {
            const blocks_by_frag = _.groupBy(blocks_by_chunk[chunk._id.toHexString()], 'frag');
            for (const frag of chunk.frags) {
                const frag_blocks = blocks_by_frag[frag._id.toHexString()] || [];
                frag.blocks = sorter ? frag_blocks.sort(sorter) : frag_blocks;
            }
        }
    }

    iterate_node_chunks({ node_id, marker, limit }) {
        return this._blocks.find(compact({
                node: { $eq: node_id, $exists: true },
                _id: marker ? {
                    $lt: marker
                } : undefined,
                deleted: null,
            }), {
                projection: {
                    _id: 1,
                    chunk: 1,
                    size: 1
                },
                sort: {
                    _id: -1 // start with latest blocks and go back
                },
                limit: limit,
            })

            .then(blocks => ({
                chunk_ids: db_client.instance().uniq_ids(blocks, 'chunk'),
                marker: blocks.length ? blocks[blocks.length - 1]._id : null,
                blocks_size: _.sumBy(blocks, 'size'),
            }));
    }

    /**
     * @param {nb.ID[]} node_ids
     * @param {number} [skip]
     * @param {number} [limit]
     * @returns {Promise<nb.ID[]>}
     */
    async find_blocks_chunks_by_node_ids(node_ids, skip = 0, limit = 0) {
        const blocks = await this._blocks.find({
            node: { $in: node_ids, $exists: true },
            deleted: null,
        }, {
            projection: { _id: 0, chunk: 1 },
            sort: { _id: -1 }, // start with latest blocks and go back
            skip,
            limit,
        });
        return db_client.instance().uniq_ids(blocks, 'chunk');
    }

    /**
     * @param {nb.ID[]} node_ids
     * @returns {Promise<number>}
     */
    async count_blocks_of_nodes(node_ids) {
        return this._blocks.countDocuments({
            node: { $in: node_ids, $exists: true },
            deleted: null,
        });
    }

    /**
     * @param {nb.ID[]} block_ids
     */
    async delete_blocks_by_ids(block_ids) {
        const delete_date = new Date();
        if (!block_ids || !block_ids.length) return;
        return this._blocks.updateMany({
            _id: { $in: block_ids },
            deleted: null
        }, {
            $set: {
                deleted: delete_date
            },
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
        return this._blocks.mapReduce(
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
                $lt: new Date(max_delete_time),
                $exists: true // Force index usage
            },
        };
        return this._blocks.find(query, {
                limit: Math.min(limit, 1000),
                projection: {
                    _id: 1,
                    deleted: 1
                }
            })
            .then(objects => db_client.instance().uniq_ids(objects, '_id'));
    }

    db_delete_blocks(block_ids) {
        if (!block_ids || !block_ids.length) return;
        dbg.warn('Removing the following blocks from DB:', block_ids);
        return this._blocks.deleteMany({
            _id: {
                $in: block_ids
            },
            deleted: { $exists: true }
        });
    }

    count_total_objects() {
        return this._objects.countDocuments({}); // maybe estimatedDocumentCount()
    }

    estimated_total_objects() {
        return this._objects.estimatedDocumentCount();
    }
}

MDStore._instance = undefined;

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

function normalize_list_mr_results(mr_results, prefix) {
    return mr_results.map(r => (
        r._id[1] === 'common_prefix' ?
        ({ common_prefix: r.value || 1, key: prefix + r._id[0] }) :
        r.value
    ));
}

function sort_list_objects_with_delimiter(a, b) {
    // key is sorted in ascending order
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
}

function sort_list_versions_with_delimiter(a, b) {
    // key is sorted in ascending order
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    // version_seq is sorted in *** descending *** order
    const a_version = a.version_seq || 0;
    const b_version = b.version_seq || 0;
    if (a_version < b_version) return 1;
    if (a_version > b_version) return -1;
    return 0;
}

function sort_list_uploads_with_delimiter(a, b) {
    // key is sorted in ascending order
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    // upload_started is sorted in ascending order
    const a_upload = a.upload_started ? a.upload_started : 0;
    const b_upload = b.upload_started ? b.upload_started : 0;
    if (a_upload < b_upload) return -1;
    if (a_upload > b_upload) return 1;
    return 0;
}

/**
 * @param {string} id_str
 * @returns {nb.ID}
 */
function make_md_id(id_str) {
    return new mongodb.ObjectId(id_str);
}


// EXPORTS
exports.MDStore = MDStore;
exports.make_md_id = make_md_id;
