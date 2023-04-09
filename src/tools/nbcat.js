/* Copyright (C) 2016 NooBaa */
'use strict';

const moment = require('moment');
const size_utils = require('../util/size_utils');
const api = require('../api');
const ObjectIO = require('../sdk/object_io');
const dbg = require('../util/debug_module')(__filename);
dbg.set_module_level(5);

const bkt = process.argv[2];
const key = process.argv[3];
const start = Number(process.argv[4]) || 0;
const end = Number(process.argv[5]) || Infinity;
const output = process.stdout;
const rpc = api.new_rpc();
const client = rpc.new_client();
const object_io = new ObjectIO();

if (!bkt) {
    init_api().then(function() {
            return client.bucket.list_buckets();
        })
        .then(function(res) {
            output.write('\nLIST BUCKETS:\n\n');
            res.buckets.forEach(function(bucket) {
                output.write('    ' +
                    ' ' + bucket.name +
                    '\n');
            });
            output.write('\n-------------\n\n');
            rpc.disconnect_all();
        });
} else if (key) {
    init_api().then(function() {
        return object_io.read_object_stream({
                client: client,
                bucket: bkt,
                key: key,
                start: start,
                end: end
            })
            .on('end', function() {
                rpc.disconnect_all();
            })
            .pipe(output);
    });
} else {
    init_api().then(function() {
            return client.object.list_objects_admin({
                bucket: bkt
            });
        })
        .then(function(res) {
            output.write('\nLIST OBJECTS:\n\n');
            res.objects.forEach(function(obj) {
                output.write('    ' +
                    ' ' + moment(new Date(obj.create_time)).format('YYYY MMM D HH:mm:ss') +
                    ', ' + size_utils.human_size(obj.size) +
                    ', ' + obj.key +
                    // JSON.stringify(obj)+
                    '\n');
            });
            output.write('\n-------------\n\n');
            rpc.disconnect_all();
        });
}


function init_api() {
    return client.create_auth_token({
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo',
    });
}
