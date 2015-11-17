'use strict';

var _ = require('lodash');

module.exports = {
    uniq_ids: uniq_ids,
    populate: populate
};

/**
 * make a list of ObjectId unique by indexing their string value
 * this is needed since ObjectId is an object so === comparison is not
 * logically correct for it even for two objects with the same id.
 */
function uniq_ids(ids) {
    var map = {};
    _.each(ids, function(id) {
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
        return collection.find({
                _id: {
                    $in: uniq_ids(_.map(docs, function(doc) {
                        return _.get(doc, doc_path);
                    }))
                }
            })
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
