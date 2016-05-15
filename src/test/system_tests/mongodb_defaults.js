/* global db */
/*
 * mongodb script to restore the initial state of the database
 *
 * usage: mongo nbcore mongodb_init.js
 *
 */
db.datablocks.remove({});
db.datachunks.remove({});
db.objectparts.remove({});
db.objectmds.remove({});
db.tiers.update({
    name: {
        $nin: [/files#.*/]
    }
}, {
    $set: {
        pool: db.pools.find({
            name: 'default_pool'
        })[0]._id
    }
});
db.pools.remove({
    name: {
        $ne: 'default_pool'
    }
});
db.tiers.remove({
    name: {
        $nin: [/files#.*/]
    }
});
db.tieringpolicies.remove({
    name: {
        $nin: [/files#.*/]
    }
});
db.buckets.remove({
    name: {
        $ne: 'files'
    }
});
// We assign all of the nodes to the default_pool, because we've removed all of the pools
db.nodes.update({}, {
    $set: {
        pool: db.pools.find({
            name: 'default_pool'
        })[0]._id
    }
}, {
    multi: true
});
