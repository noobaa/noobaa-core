'use strict';

var _ = require('lodash');
var P = require('./promise');

module.exports = {
    obj_ids_difference: obj_ids_difference,
    uniq_ids: uniq_ids,
    populate: populate
};

/*
 *@param base - the array to subtract from
 *@param values - array of values to subtract from base
 *@out - return an array of string containing values in base which did no appear in values
 */
function obj_ids_difference(base, values) {
    var map_base = {};
    for (var i = 0; i < base.length; ++i) {
        map_base[base[i]] = base[i];
    }
    for (i = 0; i < values.length; ++i) {
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
    var map = {};
    _.each(docs, function(doc) {
        var id = _.get(doc, doc_path);
        if (id) {
            map[id.toString()] = id;
        }
    });
    return _.values(map);
}

/**
 * populate a certain doc path which contains object ids to another collection
 */
function populate(doc_path, collection) {
    return function(docs) {
        var ids = uniq_ids(docs, doc_path);
        collection = collection.collection || collection;
        console.log('POPULATE:', collection.collectionName, ids);
        if (!docs.length || !ids.length) return docs;
        return P.when(collection.collection.find({
                _id: {
                    $in: ids
                }
            }).toArray())
            .then(function(items) {
                var items_by_idstr = _.indexBy(items, '_id');
                _.each(docs, function(doc) {
                    var item;
                    var id = _.get(doc, doc_path);
                    if (id) {
                        item = items_by_idstr[id.toString()];
                    }
                    if (item) {
                        _.set(doc, doc_path, item);
                    }
                });
                return docs;
            });
    };
}
