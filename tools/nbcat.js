'use strict';

var moment = require('moment');
var size_utils = require('../src/util/size_utils');
var api = require('../src/api');
var ObjectIO = require('../src/api/object_io_client');
var dbg = require('../src/util/debug_module')(__filename);
dbg.set_level(5);

var bkt = process.argv[2];
var key = process.argv[3];
var start = parseInt(process.argv[4], 10) || 0;
var end = parseInt(process.argv[5], 10) || Infinity;
var output = process.stdout;
var rpc = api.new_rpc();
var client = rpc.new_client();
var object_io = new ObjectIO(client);

if (!bkt) {
    init_api().then(function() {
        return client.bucket.list_buckets();
    }).then(function(res) {
        output.write('\nLIST BUCKETS:\n\n');
        res.buckets.forEach(function(bucket) {
            output.write('    ' +
                ' ' + bucket.name +
                '\n');
        });
        output.write('\n-------------\n\n');
        rpc.disconnect_all();
    });
} else if (!key) {
    init_api().then(function() {
        return client.object.list_objects({
            bucket: bkt
        });
    }).then(function(res) {
        output.write('\nLIST OBJECTS:\n\n');
        res.objects.forEach(function(obj) {
            output.write('    ' +
                ' ' + moment(new Date(obj.info.create_time)).format('YYYY MMM D HH:mm:ss') +
                ', ' + size_utils.human_size(obj.info.size) +
                ', ' + obj.key +
                // JSON.stringify(obj)+
                '\n');
        });
        output.write('\n-------------\n\n');
        rpc.disconnect_all();
    });
} else {
    init_api().then(function() {
        return object_io.open_read_stream({
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
}


function init_api() {
    return client.create_auth_token({
        email: 'demo@noobaa.com',
        password: 'DeMo',
        system: 'demo',
    });
}
