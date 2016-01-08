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
    self.get_system_info_for_request = function(req) {
        req.system_store = self;
        return self.get().then(function(system_info) {
            req.system_info = system_info;
        });
    };
}


SystemStore.prototype.get = function() {
    var self = this;
    return P.fcall(function() {
        var load_time = 0;
        if (self.system_info) {
            load_time = self.system_info.time;
        }
        var since_load = Date.now() - load_time;
        if (since_load < self.START_REFRESH_THRESHOLD) {
            return self.system_info;
        } else if (since_load < self.FORCE_REFRESH_THRESHOLD) {
            self.load();
            return self.system_info;
        } else {
            return self.load();
        }
    });
};


SystemStore.prototype.get_nonblocking = function() {
    var self = this;
    var load_time = 0;
    if (self.system_info) {
        load_time = self.system_info.time;
    }
    var since_load = Date.now() - load_time;
    if (since_load < self.FORCE_REFRESH_THRESHOLD) {
        return self.system_info;
    }
    throw new Error('cannot return system info nonblocking');
};


SystemStore.prototype.load = function() {
    var self = this;
    if (self._load_promise) return self._load_promise;
    dbg.log0('SystemStore: fetching ...');
    var system_info = new SystemInfo();
    var millistamp = time_utils.millistamp();
    self._load_promise = self.fetch_data(system_info)
        .then(function() {
            dbg.log0('SystemStore: fetch took', time_utils.millitook(millistamp));
            dbg.log0('SystemStore: fetch size', size_utils.human_size(JSON.stringify(system_info).length));
            millistamp = time_utils.millistamp();
            system_info.rebuild();
            self.system_info = system_info;
            dbg.log0('SystemStore: rebuild took', time_utils.millitook(millistamp));
            dbg.log0('SystemStore: system_info', system_info);
            return self.system_info;
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
    this.system_info = null;
};


SystemStore.prototype.fetch_data = function(target) {
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
 *      insert: {...}            <or array of inserts>,
 *      update: {_id:123, ...}   <or array of updates>,
 *      remove: 789              <or array of ids to remove>,
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
        if (change.insert) {
            if (_.isArray(change.insert)) {
                _.each(change.insert, function(insert) {
                    bulk.insert(insert);
                });
            } else {
                bulk.insert(change.insert);
            }
        }
        if (change.update) {
            if (_.isArray(change.update)) {
                _.each(change.update, function(update) {
                    bulk.find({
                        _id: update._id
                    }).updateOne({
                        $set: update
                    });
                });
            } else {
                bulk.find({
                    _id: change.update._id
                }).updateOne({
                    $set: change.update
                });
            }
        }
        if (change.remove) {
            if (_.isArray(change.remove)) {
                _.each(change.remove, function(id) {
                    bulk.find({
                        _id: id
                    }).removeOne();
                });
            } else {
                bulk.find({
                    _id: change.remove
                }).removeOne();
            }
        }
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
 * SystemInfo
 *
 */
function SystemInfo(data) {
    this.time = Date.now();
}

SystemInfo.prototype.rebuild = function() {
    this.rebuild_idmap();
    this.rebuild_object_links();
    this.rebuild_indexes();
    this.rebuild_custom();
};

SystemInfo.prototype.rebuild_idmap = function() {
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

SystemInfo.prototype.rebuild_object_links = function() {
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


SystemInfo.prototype.rebuild_indexes = function() {
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
                    dbg.error('SystemInfo: system index collision on',
                        index.name, key, val, map[key]);
                } else {
                    map[key] = val;
                }
            }
        });
    });
};

SystemInfo.prototype.rebuild_custom = function() {
    // var self = this;
};

SystemInfo.prototype.get_by_id = function(id) {
    return id ? this.idmap[id.toString()] : null;
};

SystemInfo.prototype.get_system_by_name = function(name) {
    return this.systems_by_name[name];
};
