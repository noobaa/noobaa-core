'use strict';

/**
 *
 * this module exists to collect all the functions that are
 * serialized and sent to mongodb.
 *
 * The reason they need to be collected in a module is that
 * when running coverage (istanbul) it injects statements into the code
 * which gets serialized as well and breaks the mongodb execution
 * with ReferenceError.
 *
 * This file is excluded from the coverage code injection in gulpfile.
 *
 */

module.exports = {
    map_size: map_size,
    map_node_size: map_node_size,
    map_aggregate_nodes: map_aggregate_nodes,
    map_aggregate_objects: map_aggregate_objects,
    map_key_with_prefix_delimiter: map_key_with_prefix_delimiter,
    map_nodes_groups: map_nodes_groups,
    reduce_sum: reduce_sum,
    reduce_noop: reduce_noop,
    reduce_node_groups: reduce_node_groups,
};

// declare names that these functions expect to have in scope
// so that lint tools will not give warnings.
let emit;
let minimum_online_heartbeat;
let prefix;
let delimiter;
let group_by;

function map_size() {
    /* jshint validthis: true */
    emit('size', this.size);
}

function map_node_size() {
    /* jshint validthis: true */
    emit(this.node, this.size);
}

function map_aggregate_nodes() {
    /* jshint validthis: true */
    emit(['', 'total'], this.storage.total);
    emit(['', 'free'], this.storage.free);
    emit(['', 'used'], this.storage.used);
    emit(['', 'alloc'], this.storage.alloc);
    emit(['', 'count'], 1);
    var online = (!this.srvmode && this.heartbeat >= minimum_online_heartbeat);
    if (online) {
        emit(['', 'online'], 1);
    }
    if (this.pool) {
        emit([this.pool, 'total'], this.storage.total);
        emit([this.pool, 'free'], this.storage.free);
        emit([this.pool, 'used'], this.storage.used);
        emit([this.pool, 'alloc'], this.storage.alloc);
        emit([this.pool, 'count'], 1);
        if (online) {
            emit([this.pool, 'online'], 1);
        }
    }
}

function map_aggregate_objects() {
    /* jshint validthis: true */
    emit(['', 'size'], this.size);
    emit(['', 'count'], 1);
    emit([this.bucket, 'size'], this.size);
    emit([this.bucket, 'count'], 1);
}


function map_key_with_prefix_delimiter() {
    /* jshint validthis: true */
    var suffix = this.key.slice(prefix.length);
    var pos = suffix.indexOf(delimiter);
    if (pos >= 0) {
        emit(suffix.slice(0, pos), undefined);
    }
}



// a map-reduce part for summing up
// this function must be self contained to be able to send to mongo mapReduce()
// so not using any functions or constants from above.
function reduce_sum(key, values) {
    var PETABYTE = 1024 * 1024 * 1024 * 1024 * 1024;
    var n = 0;
    var peta = 0;
    values.forEach(function(v) {
        if (typeof(v) === 'number') {
            n += v;
        } else if (v) {
            n += v.n;
            peta += v.peta;
        }
        while (n >= PETABYTE) {
            n -= PETABYTE;
            peta += 1;
        }
    });
    return peta ? {
        n: n,
        peta: peta,
    } : n;
}

function reduce_noop() {}


function map_nodes_groups() {
    /* jshint validthis: true */
    var key = {};
    if (group_by.pool) {
        key.p = this.pool;
    }
    if (group_by.geolocation) {
        key.g = this.geolocation;
    }
    var online = (!this.srvmode && this.heartbeat >= minimum_online_heartbeat);
    var val = {
        // count
        c: 1,
        // online
        o: online ? 1 : 0,
        // allocated
        a: this.storage.alloc || 0,
        // used
        u: this.storage.used || 0,
    };
    emit(key, val);
}

function reduce_node_groups(key, values) {
    var c = []; // count
    var o = []; // online
    var a = []; // allocated
    var u = []; // used
    values.forEach(function(v) {
        c.push(v.c);
        o.push(v.o);
        a.push(v.a);
        u.push(v.u);
    });
    return {
        c: reduce_sum(key, c),
        o: reduce_sum(key, o),
        a: reduce_sum(key, a),
        u: reduce_sum(key, u),
    };
}
