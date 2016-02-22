'use strict';

let _ = require('lodash');
let P = require('./promise');
let mongodb = require('mongodb');

module.exports = {
    obj_ids_difference: obj_ids_difference,
    uniq_ids: uniq_ids,
    populate: populate,
    resolve_object_ids_recursive: resolve_object_ids_recursive,
    resolve_object_ids_paths: resolve_object_ids_paths,
};

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
    console.log('POPULATE:', collection.collectionName,
        ids.slice(0, 10).join(','), ids.length > 10 ? '(partial list)' : '');
    if (!ids.length) return docs;
    return P.when(collection.find({
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
        if (ref instanceof mongodb.ObjectId) {
            let obj = idmap[ref];
            if (obj) {
                _.set(item, path, obj);
            } else if (!allow_missing) {
                throw new Error('resolve_object_ids_paths missing ref to ' + path + ' - ' + ref);
            }
        } else if (!allow_missing && !(ref && ref._id instanceof mongodb.ObjectId)) {
            throw new Error('resolve_object_ids_paths missing ref id to ' + path + ' - ' + ref);
        }
    });
    return item;
}
