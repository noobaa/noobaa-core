/* global db */
'use strict';

/* Upade mongo structures and values with new things since the latest version*/


db.systems.find().forEach(function(sys) {
    if (!sys.resources.linux_agent_installer) {
        db.systems.update({
            _id: sys._id
        }, {
            $set: {
                resources: {
                    linux_agent_installer: 'noobaa-setup',
                    agent_installer: 'noobaa-setup.exe',
                    s3rest_installer: 'noobaa-s3rest.exe'
                }
            }
        });
    }
});


/* upgrade to 4.0 adding tiering layer*/

var nodes_array = [];
db.nodes.find({}, {
    name: 1,
    _id: 0
}).forEach(function(node) {
    nodes_array.push(node.name);
});
var mypool = db.pools.findOne();
var sys_id = db.systems.findOne()._id;

if (mypool) {
    print('pool already exists, nothing to do');
} else {
    print('(upgrade to 4.0) add tiering layer');
    db.pools.insert({
        'name': 'default_pool',
        'nodes': nodes_array,
        'system': sys_id
    });
    var pools_array = [];
    db.pools.find({}, {
        _id: 1
    }).forEach(function(pool) {
        pools_array.push(pool._id);
    });
    db.tiers.update({}, {
        $set: {
            "data_placement": "SPREAD",
            "replicas": 3,
            "data_fragments": 1,
            "nodes": [],
            "pools": pools_array,
        }
    });
    var tier_id = db.tiers.findOne()._id;
    db.tieringpolicies.insert({
        "name": "default_tiering",
        "system": sys_id,
        "tiers": [{
            "order": 0,
            "tier": tier_id
        }]
    });
    var tiering_policy_id = db.tieringpolicies.findOne()._id;

    db.buckets.find().forEach(function(bucket) {
        db.buckets.update({
            _id: bucket._id
        }, {
            $set: {
                tiering: tiering_policy_id
            }
        });
    });

    var parts = [];
    db.objectmds.find({
        deleted:null
    }).forEach(function(obj) {
        db.objectparts.find({
            obj: obj._id,
            deleted:null
        }).forEach(function(part){
            parts.push(part._id);
        });
    });

    var buckets = [];

    db.datachunks.find({deleted:null}).forEach(function(chunk) {
        db.objectparts.find({
            "chunk": chunk._id,
            _id: {
                $in: parts
            },
            deleted:null
        }).forEach(function(part) {

            db.objectmds.find({
                "_id": part.obj,
                deleted:null
            }).forEach(function(obj) {
                var bucket_id = obj.bucket;

                if (!buckets[bucket_id]){
                    buckets.push(bucket_id);
                    buckets[bucket_id] ={
                        chunks : []
                    };
                }
                buckets[bucket_id].chunks.push(chunk._id);
                //print('bububu',buckets[bucket_id].chunks);

                //print ('chunks in bucket '+bucket_id+' : '+JSON.stringify(buckets[bucket_id].chunks));
                //              print ('setting chunk with id:'+chunk._id +' with bucket '+obj.bucket +' part:'+part.obj+' obj:'+ obj._id);
            });
        });
    });

    print('buckets',buckets.length);

    for (var i = 0; i < buckets.length; i++) {

        db.datachunks.update({
            _id: {
                $in: buckets[buckets[i]].chunks
            }
        }, {
            $set: {
                bucket: buckets[i]
            }
        });

    }
}
