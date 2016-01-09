'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
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
    self.START_REFRESH_THRESHOLD = 60000;
    self.FORCE_REFRESH_THRESHOLD = 120000;
}


SystemStore.prototype.get = function() {
    var self = this;
    return P.fcall(function() {
        var load_time = 0;
        if (self.system_store_data) {
            load_time = self.system_store_data.time;
        }
        var since_load = Date.now() - load_time;
        if (since_load < self.START_REFRESH_THRESHOLD) {
            return self.system_store_data;
        } else if (since_load < self.FORCE_REFRESH_THRESHOLD) {
            self.load();
            return self.system_store_data;
        } else {
            return self.load();
        }
    });
};


SystemStore.prototype.get_nonblocking = function() {
    var self = this;
    var load_time = 0;
    if (self.system_store_data) {
        load_time = self.system_store_data.time;
    }
    var since_load = Date.now() - load_time;
    if (since_load < self.FORCE_REFRESH_THRESHOLD) {
        return self.system_store_data;
    }
    throw new Error('cannot return system store nonblocking');
};


SystemStore.prototype.load = function() {
    var self = this;
    if (self._load_promise) return self._load_promise;
    dbg.log0('SystemStore: fetching ...');
    var system_store_data = new SystemStoreData();
    var millistamp = time_utils.millistamp();
    self._load_promise = self.read_data_from_db(system_store_data)
        .then(function() {
            dbg.log0('SystemStore: fetch took', time_utils.millitook(millistamp));
            dbg.log0('SystemStore: fetch size', size_utils.human_size(JSON.stringify(system_store_data).length));
            millistamp = time_utils.millistamp();
            system_store_data.rebuild();
            self.system_store_data = system_store_data;
            dbg.log0('SystemStore: rebuild took', time_utils.millitook(millistamp));
            dbg.log0('SystemStore: system_store_data', system_store_data);
            return self.system_store_data;
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


SystemStore.prototype.invalidate = function() {
    this.system_store_data = null;
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
 *   systems: {
 *      insert: [{...}]            <array of inserts>,
 *      update: [{_id:123, ...}]   <array of updates>,
 *      remove: [789]              <array of ids to remove>,
 *   },
 *   buckets: { insert, update, remove },
 * })
 *
 */
SystemStore.prototype.make_changes = function(changes) {
    var self = this;
    self.invalidate();
    var bulk_per_collection = {};
    _.each(changes, function(change, collection) {
        if (!(collection in COLLECTIONS)) {
            throw new Error('SystemStore: make_changes bad collection name' + collection);
        }
        var bulk =
            bulk_per_collection[collection] =
            bulk_per_collection[collection] ||
            mongo_client.db.collection(collection).initializeUnorderedBulkOp();
        _.each(change.insert, function(insert) {
            bulk.insert(insert);
        });
        _.each(change.update, function(update) {
            bulk.find({
                _id: update._id
            }).updateOne({
                $set: update
            });
        });
        _.each(change.remove, function(id) {
            bulk.find({
                _id: id
            }).removeOne();
        });
    });
    return P.all(_.map(bulk_per_collection, function(bulk) {
            return P.ninvoke(bulk, 'execute');
        }))
        .finally(function() {
            self.invalidate();
        });
};


/**
 *
 * SystemStoreData
 *
 */
function SystemStoreData(data) {
    this.time = Date.now();
}

SystemStoreData.prototype.rebuild = function() {
    this.rebuild_idmap();
    this.rebuild_object_links();
    this.rebuild_indexes();
    this.rebuild_custom();
};

SystemStoreData.prototype.rebuild_idmap = function() {
    var self = this;
    self.idmap = {};
    _.each(COLLECTIONS, function(schema, collection) {
        var items = self[collection];
        _.each(items, function(item) {
            // add to idmap
            self.idmap[item._id.toString()] = item;
            // we keep backward compatible since mongoose exposes 'id'
            // and we have existing code that uses it
            item.id = item._id;
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

SystemStoreData.prototype.rebuild_custom = function() {
    // var self = this;
};

SystemStoreData.prototype.get_by_id = function(id) {
    return id ? this.idmap[id.toString()] : null;
};

SystemStoreData.prototype.get_system_by_name = function(name) {
    return this.systems_by_name[name];
};
