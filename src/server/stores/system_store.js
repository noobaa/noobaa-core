'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var util = require('util');
var mongodb = require('mongodb');
var mongo_client = require('./mongo_client');
var time_utils = require('../../util/time_utils');
var size_utils = require('../../util/size_utils');
var bg_worker = require('../server_rpc').bg_worker;
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
    tieringpolicies: {},
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
    name: 'buckets_by_name',
    collection: 'buckets',
    context: 'system',
    key: 'name'
}, {
    name: 'tiering_policies_by_name',
    collection: 'tieringpolicies',
    context: 'system',
    key: 'name'
}, {
    name: 'tiers_by_name',
    collection: 'tiers',
    context: 'system',
    key: 'name'
}, {
    name: 'pools_by_name',
    collection: 'pools',
    context: 'system',
    key: 'name'
}, {
    name: 'roles_by_account',
    collection: 'roles',
    context: 'system',
    key: 'account._id',
    val: 'role',
    val_array: true,
}, {
    name: 'roles_by_system',
    collection: 'roles',
    context: 'account',
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
    self.START_REFRESH_THRESHOLD = 10 * 60 * 1000;
    self.FORCE_REFRESH_THRESHOLD = 60 * 60 * 1000;
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
    self._load_promise = P.fcall(function() {
            return self.register_for_changes();
        })
        .then(function() {
            return self.read_data_from_db(new_data);
        })
        .then(function() {
            dbg.log0('SystemStore: fetch took', time_utils.millitook(millistamp));
            dbg.log0('SystemStore: fetch size', size_utils.human_size(JSON.stringify(new_data).length));
            millistamp = time_utils.millistamp();
            dbg.log0('SystemStore: fetch data', util.inspect(new_data, {
                depth: 4
            }));
            new_data.rebuild();
            dbg.log0('SystemStore: rebuild took', time_utils.millitook(millistamp));
            self.data = new_data;
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


SystemStore.prototype.register_for_changes = function() {
    return bg_worker.redirector.register_to_cluster();
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

SystemStore.prototype.generate_id = function() {
    return new mongodb.ObjectId();
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
    dbg.log0('SystemStore.make_changes:', util.inspect(changes, {
        depth: 4
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

    return P.when(self.refresh())
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
                    var updates = _.omit(item, '_id');
                    var first_key;
                    _.forOwn(updates, function(val, key) {
                        first_key = key;
                        return false; // break loop immediately
                    });
                    if (first_key[0] !== '$') {
                        updates = {
                            $set: updates
                        };
                    }
                    bulk.find({
                        _id: item._id
                    }).updateOne(updates);
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
            // notify all the cluster (including myself) to reload
            return bg_worker.redirector.publish_to_cluster({
                method_api: 'cluster_api',
                method_name: 'load_system_store',
                target: ''
            });
        });
};

SystemStore.prototype.make_changes_in_background = function(changes) {
    var self = this;
    self.bg_changes = self.bg_changes || {};
    _.mergeWith(self.bg_changes, changes, function(a, b) {
        if (_.isArray(a) && _.isArray(b)) {
            return a.concat(b);
        }
    });
    if (!self.bg_timeout) {
        self.bg_timeout = setTimeout(function() {
            var bg_changes = self.bg_changes;
            self.bg_changes = null;
            self.bg_timeout = null;
            self.make_changes(bg_changes);
        }, 3000);
    }
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
            var idstr = item._id.toString();
            var existing = self.idmap[idstr];
            if (existing) {
                dbg.error('SystemStoreData: id collision', item, existing);
            } else {
                self.idmap[idstr] = item;
            }
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
                    dbg.error('SystemStoreData:', index.name,
                        'collision on key', key, val, map[key]);
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
        if (!context) return;
        var map = context[index.name] = context[index.name] || {};
        if (!index.val_array) {
            var existing = map[key];
            if (existing && String(existing._id) !== String(item._id)) {
                var err = new Error(index.name + ' collision on key ' + key);
                err.rpc_code = 'CONFLICT';
                throw err;
            }
        }
    });
};
