'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var util = require('util');
var mongodb = require('mongodb');
var mongo_client = require('./mongo_client');
var time_utils = require('../../util/time_utils');
var size_utils = require('../../util/size_utils');
var dbg = require('../../util/debug_module')(__filename);
// var promise_utils = require('../../util/promise_utils');

// a singleton
module.exports = new SystemStore();


var COLLECTIONS = {
    clusters: {},
    systems: {},
    roles: {},
    accounts: {},
    buckets: {},
    tiering_policies: {},
    tiers: {},
    pools: {},
};

var INDEXES = [{
    name: 'systems_by_name',
    collection: 'systems',
    key: 'name'
}, {
    name: 'accounts_by_email',
    collection: 'accounts',
    key: 'email'
}, {
    context: 'system',
    name: 'buckets_by_name',
    collection: 'buckets',
    key: 'name'
}, {
    context: 'system',
    name: 'tiering_policies_by_name',
    collection: 'tiering_policies',
    key: 'name'
}, {
    context: 'system',
    name: 'tiers_by_name',
    collection: 'tiers',
    key: 'name'
}, {
    context: 'system',
    name: 'pools_by_name',
    collection: 'pools',
    key: 'name'
}, {
    context: 'system',
    name: 'roles_by_account',
    collection: 'roles',
    key: 'account._id',
    val: 'role',
    val_array: true,
}, {
    context: 'account',
    name: 'roles_by_system',
    collection: 'roles',
    key: 'system._id',
    val: 'role',
    val_array: true,
}];


/**
 *
 * SystemStore
 *
 * loads date from the database and keeps in memory optimized way.
 *
 */
function SystemStore() {
    var self = this;
    self.START_REFRESH_THRESHOLD = 10000;
    self.FORCE_REFRESH_THRESHOLD = 60000;
}


SystemStore.prototype.refresh = function() {
    var self = this;
    return P.fcall(function() {
        var load_time = 0;
        if (self.data) {
            load_time = self.data.time;
        }
        var since_load = Date.now() - load_time;
        if (since_load < self.START_REFRESH_THRESHOLD) {
            return self.data;
        } else if (since_load < self.FORCE_REFRESH_THRESHOLD) {
            self.load();
            return self.data;
        } else {
            return self.load();
        }
    });
};


SystemStore.prototype.load = function() {
    var self = this;
    if (self._load_promise) return self._load_promise;
    dbg.log0('SystemStore: fetching ...');
    var new_data = new SystemStoreData();
    var millistamp = time_utils.millistamp();
    self._load_promise = self.read_data_from_db(new_data)
        .then(function() {
            dbg.log0('SystemStore: fetch took', time_utils.millitook(millistamp));
            dbg.log0('SystemStore: fetch size', size_utils.human_size(JSON.stringify(new_data).length));
            millistamp = time_utils.millistamp();
            new_data.rebuild();
            self.data = new_data;
            dbg.log0('SystemStore: rebuild took', time_utils.millitook(millistamp));
            dbg.log0('SystemStore: new_data', new_data);
            return self.data;
        })
        .catch(function(err) {
            dbg.error('SystemStore: load failed', err.stack || err);
            // TODO submit retry?
            throw err;
        })
        .finally(function() {
            self._load_promise = null;
        });
    return self._load_promise;
};


SystemStore.prototype.read_data_from_db = function(target) {
    // var self = this;
    var non_deleted_query = {
        deleted: null
    };
    return P.all(_.map(COLLECTIONS, function(schema, collection) {
        return mongo_client.db.collection(collection).find(non_deleted_query).toArray()
            .then(function(res) {
                target[collection] = res;
            });
    }));
};


/**
 *
 * make_changes
 *
 * send batch of changes to the system db. example:
 *
 * make_changes({
 *   insert: {
 *      systems: [{...}],
 *      buckets: [{...}],
 *   },
 *   update: {
 *      systems: [{_id:123, ...}],
 *      buckets: [{_id:456, ...}],
 *   },
 *   remove: {
 *      systems: [123, 789],
 *   }
 * })
 *
 */
SystemStore.prototype.make_changes = function(changes) {
    var self = this;
    var bulk_per_collection = {};
    var now = new Date();
    console.log('SystemStore.make_changes:', util.inspect(changes, {
        depth: 3
    }));

    function get_bulk(collection) {
        if (!(collection in COLLECTIONS)) {
            throw new Error('SystemStore: make_changes bad collection name - ' + collection);
        }
        var bulk =
            bulk_per_collection[collection] =
            bulk_per_collection[collection] ||
            mongo_client.db.collection(collection).initializeUnorderedBulkOp();
        return bulk;
    }

    return self.load()
        .then(function(data) {

            _.each(changes.insert, function(list, collection) {
                var bulk = get_bulk(collection);
                _.each(list, function(item) {
                    self.check_schema(collection, item);
                    data.check_indexes(collection, item);
                    bulk.insert(item);
                });
            });
            _.each(changes.update, function(list, collection) {
                var bulk = get_bulk(collection);
                _.each(list, function(item) {
                    self.check_schema(collection, item);
                    data.check_indexes(collection, item);
                    bulk.find({
                        _id: item._id
                    }).updateOne({
                        $set: item
                    });
                });
            });
            _.each(changes.remove, function(list, collection) {
                var bulk = get_bulk(collection);
                _.each(list, function(id) {
                    bulk.find({
                        _id: id
                    }).updateOne({
                        $set: {
                            deleted: now
                        }
                    });
                });
            });

            return P.all(_.map(bulk_per_collection, function(bulk) {
                return P.ninvoke(bulk, 'execute');
            }));
        })
        .then(function() {
            return self.load();
        });
};

SystemStore.prototype.check_schema = function(collection, item) {
    // TODO SystemStore.check_schema
};


/**
 *
 * SystemStoreData
 *
 */
function SystemStoreData(data) {
    this.time = Date.now();
}

SystemStoreData.prototype.get_by_id = function(id) {
    return id ? this.idmap[id.toString()] : null;
};

SystemStoreData.prototype.rebuild = function() {
    this.rebuild_idmap();
    this.rebuild_object_links();
    this.rebuild_indexes();
};

SystemStoreData.prototype.rebuild_idmap = function() {
    var self = this;
    self.idmap = {};
    _.each(COLLECTIONS, function(schema, collection) {
        var items = self[collection];
        _.each(items, function(item) {
            self.idmap[item._id.toString()] = item;
            // keep backward compatible since mongoose exposes 'id'
            // for the sake of existing code that uses it
            // item.id = item._id;
        });
    });
};

SystemStoreData.prototype.rebuild_object_links = function() {
    var self = this;
    _.each(COLLECTIONS, function(schema, collection) {
        var items = self[collection];
        _.each(items, function(item) {
            resolve_object_ids_recursive(item, self.idmap);
        });
    });

    function resolve_object_ids_recursive(item, idmap) {
        _.each(item, function(val, key) {
            if (val instanceof mongodb.ObjectId) {
                if (key !== '_id' && key !== 'id') {
                    var obj = idmap[val];
                    if (obj) {
                        item[key] = obj;
                    }
                }
            } else if (_.isObject(val) && !_.isString(val)) {
                resolve_object_ids_recursive(val, idmap);
            }
        });
    }
};


SystemStoreData.prototype.rebuild_indexes = function() {
    var self = this;
    _.each(INDEXES, function(index) {
        _.each(self[index.collection], function(item) {
            var key = _.get(item, index.key || '_id');
            var val = index.val ? _.get(item, index.val) : item;
            var context = index.context ? _.get(item, index.context) : self;
            var map = context[index.name] = context[index.name] || {};
            if (index.val_array) {
                map[key] = map[key] || [];
                map[key].push(val);
            } else {
                if (key in map) {
                    dbg.error('SystemStoreData: system index collision on',
                        index.name, key, val, map[key]);
                } else {
                    map[key] = val;
                }
            }
        });
    });
};

SystemStoreData.prototype.check_indexes = function(collection, item) {
    var self = this;
    _.each(INDEXES, function(index) {
        if (index.collection !== collection) return;
        var key = _.get(item, index.key || '_id');
        var context = index.context ? _.get(item, index.context) : self;
        var map = context[index.name] = context[index.name] || {};
        if (!index.val_array) {
            var existing = map[key];
            if (existing && String(existing._id) !== String(item._id)) {
                var err = new Error('collision in ' + index.name);
                err.rpc_code = 'CONFLICT';
                throw err;
            }
        }
    });
};
