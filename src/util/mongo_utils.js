/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../sdk/nb')} nb */

// const _ = require('lodash');
// const util = require('util');
const mongodb = require('mongodb');

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

// /*
//  *@param base - the array to subtract from
//  *@param values - array of values to subtract from base
//  *@out - return an array of string containing values in base which did no appear in values
//  */
// function obj_ids_difference(base, values) {
//     const map_base = {};
//     for (let i = 0; i < base.length; ++i) {
//         map_base[base[i]] = base[i];
//     }
//     for (let i = 0; i < values.length; ++i) {
//         delete map_base[values[i]];
//     }
//     return _.values(map_base);
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

// /**
//  * populate a certain doc path which contains object ids to another collection
//  * @template {{}} T
//  * @param {T[]} docs
//  * @param {string} doc_path
//  * @param {nb.DBCollection} collection
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


// function resolve_object_ids_recursive(idmap, item) {
//     _.each(item, (val, key) => {
//         if (val instanceof mongodb.ObjectId) {
//             if (key !== '_id') {
//                 const obj = idmap[val.toHexString()];
//                 if (obj) {
//                     item[key] = obj;
//                 }
//             }
//         } else if (_.isObject(val) && !_.isString(val)) {
//             resolve_object_ids_recursive(idmap, val);
//         }
//     });
//     return item;
// }

// function resolve_object_ids_paths(idmap, item, paths, allow_missing) {
//     _.each(paths, path => {
//         const ref = _.get(item, path);
//         if (is_object_id(ref)) {
//             const obj = idmap[ref];
//             if (obj) {
//                 _.set(item, path, obj);
//             } else if (!allow_missing) {
//                 throw new Error('resolve_object_ids_paths missing ref to ' +
//                     path + ' - ' + ref + ' from item ' + util.inspect(item));
//             }
//         } else if (!allow_missing) {
//             if (!ref || !is_object_id(ref._id)) {
//                 throw new Error('resolve_object_ids_paths missing ref id to ' +
//                     path + ' - ' + ref + ' from item ' + util.inspect(item));
//             }
//         }
//     });
//     return item;
// }

// /**
//  * @returns {nb.ID}
//  */
// function new_object_id() {
//     return new mongodb.ObjectId();
// }

// /**
//  * @param {string} id_str
//  * @returns {nb.ID}
//  */
// function parse_object_id(id_str) {
//     return new mongodb.ObjectId(String(id_str || undefined));
// }

// function fix_id_type(doc) {
//     if (_.isArray(doc)) {
//         _.each(doc, d => fix_id_type(d));
//     } else if (doc && doc._id) {
//         doc._id = new mongodb.ObjectId(doc._id);
//     }
//     return doc;
// }

function is_object_id(id) {
    return (id instanceof mongodb.ObjectId);
}

// function is_err_duplicate_key(err) {
//     return err && err.code === 11000;
// }

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
//     if (!res || res.matchedCount !== 1) {
//         throw new RpcError('NO_SUCH_' + entity.toUpperCase());
//     }
// }

// function make_object_diff(current, prev) {
//     const set_map = _.pickBy(current, (value, key) => !_.isEqual(value, prev[key]));
//     const unset_map = _.pickBy(prev, (value, key) => !(key in current));
//     const diff = {};
//     if (!_.isEmpty(set_map)) diff.$set = set_map;
//     if (!_.isEmpty(unset_map)) diff.$unset = _.mapValues(unset_map, () => 1);
//     return diff;
// }

// async function get_db_stats(client) {
//     if (!client.promise) {
//         throw new Error('get_db_stats: client is not connected');
//     }

//     // Wait for the client to connect.
//     await client.promise;

//     // return the stats.
//     return client.db().command({ dbStats: 1 });
// }

// // EXPORTS
// exports.mongo_operators = mongo_operators;
// exports.obj_ids_difference = obj_ids_difference;
// exports.uniq_ids = uniq_ids;
// exports.populate = populate;
// exports.resolve_object_ids_recursive = resolve_object_ids_recursive;
// exports.resolve_object_ids_paths = resolve_object_ids_paths;
// exports.new_object_id = new_object_id;
// exports.parse_object_id = parse_object_id;
// exports.fix_id_type = fix_id_type;
exports.is_object_id = is_object_id;
// exports.is_err_duplicate_key = is_err_duplicate_key;
// exports.is_err_namespace_exists = is_err_namespace_exists;
// exports.check_duplicate_key_conflict = check_duplicate_key_conflict;
// exports.check_entity_not_found = check_entity_not_found;
// exports.check_entity_not_deleted = check_entity_not_deleted;
// exports.check_update_one = check_update_one;
// exports.make_object_diff = make_object_diff;
// exports.get_db_stats = get_db_stats;
