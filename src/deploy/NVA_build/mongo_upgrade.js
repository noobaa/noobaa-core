/* global db, print, printjson, ObjectId, setVerboseShell */
'use strict';
setVerboseShell(true);
upgrade();

/* Upade mongo structures and values with new things since the latest version*/
function upgrade() {
    update_systems_resource_links();
    var mypool = db.pools.findOne();
    if (mypool) {
        print('\n*** v0.4 detected, not upgrade needed (detected by the existance of a pool)');
        upgrade_to_0_4();
    } else {
        upgrade_to_0_4();
    }
    print('\nUPGRADE DONE.');
}

function update_systems_resource_links() {
    print('\n*** updating systems resources links ...');
    db.systems.find().forEach(function(sys) {
        if (sys.resources.linux_agent_installer) {
            print('keep resources of system', sys.name);
            printjson(sys);
        } else {
            print('updating system', sys.name, '...');
            printjson(sys);
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
}


/* upgrade to 4.0 adding tiering layer*/
function upgrade_to_0_4() {
    print('\n*** upgrading to 0.4 - add tiering layer ...');

    print('\n*** finding system id ...');
    var sys_id = db.systems.findOne()._id;
    print('found system id', sys_id);

    print('\n*** finding nodes names ...');
    var nodes_array = [];
    db.nodes.find({}, {
        name: 1,
        _id: 0
    }).forEach(function(node) {
        nodes_array.push(node.name);
    });
    print('found nodes', nodes_array);

    print('\n*** inserting default pool ...');
    db.pools.insert({
        'name': 'default_pool',
        'nodes': nodes_array,
        'system': sys_id
    });

    print('\n*** finding pools ...');
    var pools_array = [];
    db.pools.find({}, {
        _id: 1
    }).forEach(function(pool) {
        pools_array.push(pool._id);
    });
    print('found pools', pools_array);

    print('\n*** updating all tiers to use default pool ...');
    db.tiers.update({}, {
        $set: {
            "data_placement": "SPREAD",
            "replicas": 3,
            "data_fragments": 1,
            "nodes": [],
            "pools": pools_array,
        }
    });

    print('\n*** finding tier id ...');
    var tier_id = db.tiers.findOne()._id;
    print('found tier id', tier_id);

    print('\n*** inserting tiering policy ...');
    db.tieringpolicies.insert({
        "name": "default_tiering",
        "system": sys_id,
        "tiers": [{
            "order": 0,
            "tier": tier_id
        }]
    });

    print('\n*** finding tiering policy id ...');
    var tiering_policy_id = db.tieringpolicies.findOne()._id;
    print('found tiering policy id', tiering_policy_id);

    print('\n*** updating all buckets to use tiering policy ...');
    db.buckets.update({}, {
        $set: {
            tiering: tiering_policy_id
        }
    }, {
        multi: true
    });

    update_bucket_for_chunks();
}

function update_bucket_for_chunks() {
    print('\n*** updating bucket for chunks ...');

    // find all the objects and map them to buckets
    // notice that the map keeps strings, and not object ids
    // in order to correctly match equal ids
    var map_obj_to_bucket = {};
    db.objectmds.find({
        deleted: null
    }, {
        _id: 1,
        bucket: 1,
    }).forEach(function(obj) {
        map_obj_to_bucket[obj._id.valueOf()] = obj.bucket.valueOf();
    });

    print('map_obj_to_bucket:');
    printjson(map_obj_to_bucket);

    // find all parts in order to map chunks to objects and therefore to buckets
    var map_chunk_to_bucket = {};
    db.objectparts.find({
        deleted: null
    }, {
        _id: 1,
        obj: 1,
        chunk: 1
    }).forEach(function(part) {
        var obj_id = part.obj.valueOf();
        var chunk_id = part.chunk.valueOf();
        var obj_bucket = map_obj_to_bucket[obj_id] || '';
        var chunk_bucket = map_chunk_to_bucket[chunk_id] || '';
        if (chunk_bucket && obj_bucket !== chunk_bucket) {
            print('OHHH NO not sure which bucket to use for chunk',
                'obj_bucket', obj_bucket,
                'chunk_bucket', chunk_bucket,
                'part._id', part._id,
                'part.obj', part.obj,
                'part.chunk', part.chunk);
        } else {
            map_chunk_to_bucket[chunk_id] = obj_bucket;
        }
    });

    print('map_chunk_to_bucket:');
    printjson(map_chunk_to_bucket);

    // invert the map of chunks to bucket to have a map of bucket to array of chunks
    // which allows to send single batch update command for all the chunks per bucket.
    var bucket;
    var chunk;
    var bucket_to_chunks = {};
    for (chunk in map_chunk_to_bucket) {
        bucket = map_chunk_to_bucket[chunk];
        bucket_to_chunks[bucket] = bucket_to_chunks[bucket] || [];
        // notice we have to convert the strings back to object id
        // so that when sending to the update query it will find the relevant chunks
        bucket_to_chunks[bucket].push(new ObjectId(chunk));
    }

    print('bucket_to_chunks:');
    printjson(bucket_to_chunks);

    for (bucket in bucket_to_chunks) {
        var chunks = bucket_to_chunks[bucket];
        print('updating bucket', bucket, 'for all these chunks:');
        printjson(chunks);
        db.datachunks.update({
            _id: {
                $in: chunks
            }
        }, {
            $set: {
                bucket: bucket
            }
        }, {
            multi: true
        });
    }
}
