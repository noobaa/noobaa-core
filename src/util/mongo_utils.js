'use strict';

const _ = require('lodash');
const util = require('util');
const mongodb = require('mongodb');
const mongoose = require('mongoose');

const P = require('./promise');
const RpcError = require('../rpc/rpc_error');

/*
 *@param base - the array to subtract from
 *@param values - array of values to subtract from base
 *@out - return an array of string containing values in base which did no appear in values
 */
function obj_ids_difference(base, values) {
    let map_base = {};
    for (let i = 0; i < base.length; ++i) {
        map_base[base[i]] = base[i];
    }
    for (let i = 0; i < values.length; ++i) {
        delete map_base[values[i]];
    }
    return _.values(map_base);
}

/**
 * make a list of ObjectId unique by indexing their string value
 * this is needed since ObjectId is an object so === comparison is not
 * logically correct for it even for two objects with the same id.
 */
function uniq_ids(docs, doc_path) {
    let map = {};
    _.each(docs, doc => {
        let id = _.get(doc, doc_path);
        if (id) {
            map[id.toString()] = id;
        }
    });
    return _.values(map);
}

/**
 * populate a certain doc path which contains object ids to another collection
 */
function populate(docs, doc_path, collection, fields) {
    let docs_list = _.isArray(docs) ? docs : [docs];
    let ids = uniq_ids(docs_list, doc_path);
    collection = collection.collection || collection;
    if (!ids.length) return docs;
    return P.resolve(collection.find({
            _id: {
                $in: ids
            }
        }, {
            fields: fields
        }).toArray())
        .then(items => {
            let idmap = _.keyBy(items, '_id');
            _.each(docs_list, doc => {
                let item;
                let id = _.get(doc, doc_path);
                if (id) {
                    item = idmap[id.toString()];
                }
                if (item) {
                    _.set(doc, doc_path, item);
                }
            });
            return docs;
        });
}


function resolve_object_ids_recursive(idmap, item) {
    _.each(item, (val, key) => {
        if (val instanceof mongodb.ObjectId) {
            if (key !== '_id') {
                let obj = idmap[val];
                if (obj) {
                    item[key] = obj;
                }
            }
        } else if (_.isObject(val) && !_.isString(val)) {
            resolve_object_ids_recursive(idmap, val);
        }
    });
    return item;
}

function resolve_object_ids_paths(idmap, item, paths, allow_missing) {
    _.each(paths, path => {
        let ref = _.get(item, path);
        if (is_object_id(ref)) {
            let obj = idmap[ref];
            if (obj) {
                _.set(item, path, obj);
            } else if (!allow_missing) {
                throw new Error('resolve_object_ids_paths missing ref to ' +
                    path + ' - ' + ref + ' from item ' + util.inspect(item));
            }
        } else if (!allow_missing) {
            if (!ref || !is_object_id(ref._id)) {
                throw new Error('resolve_object_ids_paths missing ref id to ' +
                    path + ' - ' + ref + ' from item ' + util.inspect(item));
            }
        }
    });
    return item;
}

// apparently mongoose defined it's own class of ObjectID
// instead of using the class from mongodb driver,
// so we have to check both for now,
// until we can get rid of mongoose completely.
function is_object_id(id) {
    return (id instanceof mongodb.ObjectId) ||
        (id instanceof mongoose.Types.ObjectId);
}

function is_err_duplicate_key(err) {
    return err && err.code === 11000;
}

function check_duplicate_key_conflict(err, entity) {
    if (is_err_duplicate_key(err)) {
        throw new RpcError('CONFLICT', entity + ' already exists');
    } else {
        throw err;
    }
}

function check_entity_not_found(doc, entity) {
    if (doc) {
        return doc;
    }
    throw new RpcError('NO_SUCH_' + entity.toUpperCase());
}

function check_entity_not_deleted(doc, entity) {
    if (doc && !doc.deleted) {
        return doc;
    }
    throw new RpcError('NO_SUCH_' + entity.toUpperCase());
}

// EXPORTS
exports.obj_ids_difference = obj_ids_difference;
exports.uniq_ids = uniq_ids;
exports.populate = populate;
exports.resolve_object_ids_recursive = resolve_object_ids_recursive;
exports.resolve_object_ids_paths = resolve_object_ids_paths;
exports.is_object_id = is_object_id;
exports.is_err_duplicate_key = is_err_duplicate_key;
exports.check_duplicate_key_conflict = check_duplicate_key_conflict;
exports.check_entity_not_found = check_entity_not_found;
exports.check_entity_not_deleted = check_entity_not_deleted;
