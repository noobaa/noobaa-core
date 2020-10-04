/* Copyright (C) 2016 NooBaa */
'use strict';

// TODO: Should be removed, left it just in case I've missed something moving to Interface of DBClient

// const _ = require('lodash');
// const util = require('util');
// const mongodb = require('mongodb');
// const mongo_utils = require('./mongo_utils');

// const { RpcError } = require('../rpc');

// /* exported constants */
// const mongo_operators = new Set([
//     '$inc',
//     '$mul',
//     '$rename',
//     '$setOnInsert',
//     '$set',
//     '$unset',
//     '$min',
//     '$max',
//     '$currentDate',
//     '$addToSet',
//     '$pop',
//     '$pullAll',
//     '$pull',
//     '$pushAll',
//     '$push',
//     '$each',
//     '$slice',
//     '$sort',
//     '$position',
//     '$bit',
//     '$isolated'
// ]);

// mongodb.Binary.prototype[util.inspect.custom] = function custom_inspect_binary() {
//     return `<mongodb.Binary ${this.buffer.toString('base64')} >`;
// };

// /**
//  * populate a certain doc path which contains object ids to another collection
//  * @template {{}} T
//  * @param {T[]} docs
//  * @param {string} doc_path
//  * @param {mongodb.Collection<T>} collection
//  * @param {Object} [fields]
//  * @returns {Promise<T[]>}
//  */
// async function populate(docs, doc_path, collection, fields) {
//     const docs_list = _.isArray(docs) ? docs : [docs];
//     const ids = uniq_ids(docs_list, doc_path);
//     if (!ids.length) return docs;
//     const items = await collection.find({ _id: { $in: ids } }, { projection: fields });
//     const idmap = _.keyBy(items, '_id');
//     _.each(docs_list, doc => {
//         const id = _.get(doc, doc_path);
//         if (id) {
//             const item = idmap[String(id)];
//             _.set(doc, doc_path, item);
//         }
//     });
//     return docs;
// }

// // JENIA TODO: Figure out error codes in postgres
// function is_err_duplicate_key(err) {
//     return err && err.code === 11000;
// }

// // JENIA TODO: Figure out error codes in postgres
// function is_err_namespace_exists(err) {
//     return err && err.code === 48;
// }

// function check_duplicate_key_conflict(err, entity) {
//     if (is_err_duplicate_key(err)) {
//         throw new RpcError('CONFLICT', entity + ' already exists');
//     } else {
//         throw err;
//     }
// }

// function check_entity_not_found(doc, entity) {
//     if (doc) {
//         return doc;
//     }
//     throw new RpcError('NO_SUCH_' + entity.toUpperCase());
// }

// function check_entity_not_deleted(doc, entity) {
//     if (doc && !doc.deleted) {
//         return doc;
//     }
//     throw new RpcError('NO_SUCH_' + entity.toUpperCase());
// }

// function check_update_one(res, entity) {
//     // note that res.modifiedCount might be 0 if the update is to same values
//     // so we only verify here that the query actually matched a single document.
//     if (!res || res.rowCount !== 1) {
//         throw new RpcError('NO_SUCH_' + entity.toUpperCase());
//     }
// }

// // JENIA TODO: Use something from postgres
// async function get_db_stats(client) {
//     if (!client.promise) {
//         throw new Error('get_db_stats: client is not connected');
//     }

//     // Wait for the client to connect.
//     await client.promise;

//     // return the stats.
//     return { fsUsedSize: 1, fsTotalSize: Infinity };
// }

// /**
//  * make a list of ObjectId unique by indexing their string value
//  * this is needed since ObjectId is an object so === comparison is not
//  * logically correct for it even for two objects with the same id.
//  */
// function uniq_ids(docs, doc_path) {
//     const map = {};
//     _.each(docs, doc => {
//         let id = _.get(doc, doc_path);
//         if (id) {
//             id = id._id || id;
//             map[String(id)] = id;
//         }
//     });
//     return _.values(map);
// }

// // EXPORTS
// exports.mongo_operators = mongo_operators;
// exports.obj_ids_difference = mongo_utils.obj_ids_difference;
// exports.uniq_ids = uniq_ids;
// exports.populate = populate;
// exports.resolve_object_ids_recursive = mongo_utils.resolve_object_ids_recursive;
// exports.resolve_object_ids_paths = mongo_utils.resolve_object_ids_paths;
// exports.new_object_id = mongo_utils.new_object_id;
// exports.parse_object_id = mongo_utils.parse_object_id;
// exports.fix_id_type = mongo_utils.fix_id_type;
// exports.is_object_id = mongo_utils.is_object_id;
// exports.is_err_duplicate_key = is_err_duplicate_key;
// exports.is_err_namespace_exists = is_err_namespace_exists;
// exports.check_duplicate_key_conflict = check_duplicate_key_conflict;
// exports.check_entity_not_found = check_entity_not_found;
// exports.check_entity_not_deleted = check_entity_not_deleted;
// exports.check_update_one = check_update_one;
// exports.make_object_diff = mongo_utils.make_object_diff;
// exports.get_db_stats = get_db_stats;
