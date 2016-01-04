'use strict';

var _ = require('lodash');
var P = require('../../util/promise');

module.exports = {
    uniq_ids: uniq_ids,
    populate: populate
};

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
        console.log('POPULATE:', collection.modelName, ids);
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
