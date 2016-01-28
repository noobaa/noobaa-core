'use strict';

var api = require('../src/api');
var dbg = require('../src/util/debug_module')(__filename);
dbg.set_level(5);

var bkt = process.argv[2];
var key = process.argv[3];
var start = parseInt(process.argv[4], 10) || 0;
var end = parseInt(process.argv[5], 10) || Infinity;
var output = process.stderr;

if (!bkt) {
    init_api().then(function() {
        return api.client.bucket.list_buckets();
    }).then(function(res) {
        output.write('\nLIST BUCKETS:\n\n');
        res.buckets.forEach(function(bucket) {
            output.write('> ' + bucket.name + '\n');
        });
        output.write('\n---\n\n');
        api.rpc.disconnect_all();
    });
} else if (!key) {
    init_api().then(function() {
        return api.client.object.list_objects({
            bucket: bkt
        });
    }).then(function(res) {
        output.write('\nLIST OBJECTS:\n\n');
        res.objects.forEach(function(obj) {
            output.write('> ' + obj.key + ' ' + JSON.stringify(obj.info) + '\n');
        });
        output.write('\n---\n\n');
        api.rpc.disconnect_all();
    });
} else {
    init_api().then(function() {
        return api.client.object_driver_lazy().open_read_stream({
            bucket: bkt,
            key: key,
            start: start,
            end: end
        })
        .on('end', function() {
            api.rpc.disconnect_all();
        })
        .pipe(output);
    });
}


function init_api() {
    api.client = new api.Client();
    api.rpc.base_address = 'ws://127.0.0.1:5001';
    // api.rpc.register_n2n_transport();
    return api.client.create_auth_token({
        email: 'demo@noobaa.com',
        password: 'DeMo',
        system: 'demo',
    });
}
