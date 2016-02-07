'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var mocha = require('mocha');
var assert = require('assert');
var argv = require('minimist')(process.argv);
var promise_utils = require('../util/promise_utils');
var coretest = require('./coretest');
var SliceReader = require('../util/slice_reader');

var chance_seed = argv.seed || Date.now();
console.log('using seed', chance_seed);
var chance = require('chance')(chance_seed);

var dbg = require('../util/debug_module')(__filename);
dbg.set_level(5, 'core');

mocha.describe('object_driver', function() {

    var client = coretest.new_test_client();
    var SYS = 'test-object-system';
    var BKT = 'files'; // the default bucket name
    var KEY = 'test-object-key';
    var EMAIL = 'test-object-email@mail.mail';
    var PASSWORD = 'test-object-password';

    mocha.before(function() {
        this.timeout(30000);
        return P.resolve()
            .then(() => client.account.create_account({
                name: SYS,
                email: EMAIL,
                password: PASSWORD,
            }))
            .then(res => client.options.auth_token = res.token)
            .then(() => coretest.init_test_nodes(client, SYS, 5));
    });

    mocha.after(function() {
        this.timeout(30000);
        return coretest.clear_test_nodes();
    });


    mocha.it('works', function() {
        this.timeout(30000);
        var key = KEY + Date.now();
        return P.fcall(function() {
            return client.object.create_multipart_upload({
                bucket: BKT,
                key: key,
                size: 0,
                content_type: 'application/octet-stream',
            });
        }).then(function() {
            return client.object.complete_multipart_upload({
                bucket: BKT,
                key: key,
                fix_parts_size: true
            });
        }).then(function() {
            return client.object.read_object_md({
                bucket: BKT,
                key: key,
            });
        }).then(function() {
            return client.object.update_object_md({
                bucket: BKT,
                key: key,
            });
        }).then(function() {
            return client.object.list_objects({
                bucket: BKT,
                key_s3_prefix: key,
            });
        }).then(function() {
            return client.object.delete_object({
                bucket: BKT,
                key: key,
            });
        });
    });

    var CHANCE_BYTE = {
        min: 0,
        max: 255,
    };


    mocha.describe('object IO', function() {

        var OBJ_NUM_PARTS = 16;
        var OBJ_PART_SIZE = 128 * 1024;
        var CHANCE_PART_NUM = {
            min: 0,
            max: OBJ_NUM_PARTS,
        };
        var CHANCE_PART_OFFSET = {
            min: 0,
            max: OBJ_PART_SIZE - 1,
        };


        mocha.it('should write and read object data', function() {
            this.timeout(30000);
            var key = KEY + Date.now();
            var size, data;
            return P.fcall(function() {
                    return client.node.list_nodes({});
                })
                .then(function(list) {
                    console.log("list_nodes in use", list);
                    // randomize size with equal chance on KB sizes
                    size = OBJ_PART_SIZE * chance.integer(CHANCE_PART_NUM) +
                        chance.integer(CHANCE_PART_OFFSET);
                    // randomize a buffer
                    // console.log('random object size', size);
                    data = new Buffer(size);
                    for (var i = 0; i < size; i++) {
                        data[i] = chance.integer(CHANCE_BYTE);
                    }
                    return client.object_driver_lazy().upload_stream({
                        bucket: BKT,
                        key: key,
                        size: size,
                        content_type: 'application/octet-stream',
                        source_stream: new SliceReader(data),
                    });
                }).then(function() {
                    return client.object_driver_lazy().read_entire_object({
                        bucket: BKT,
                        key: key,
                        start: 0,
                        end: size,
                    });
                }).then(function(read_buf) {

                    // verify the read buffer equals the written buffer
                    assert.strictEqual(data.length, read_buf.length);
                    for (var i = 0; i < size; i++) {
                        assert.strictEqual(data[i], read_buf[i]);
                    }
                    console.log('READ SUCCESS');

                }).then(function() {

                    // testing mappings that nodes don't repeat in the same fragment

                    return client.object.read_object_mappings({
                        bucket: BKT,
                        key: key,
                        adminfo: true
                    }).then(function(res) {
                        _.each(res.parts, function(part) {
                            var blocks = _.flatten(_.map(part.fragments, 'blocks'));
                            var blocks_per_node = _.groupBy(blocks, function(block) {
                                return block.adminfo.node_name;
                            });
                            console.log('VERIFY MAPPING UNIQUE ON NODE', blocks_per_node);
                            _.each(blocks_per_node, function(blocks, node_name) {
                                assert.strictEqual(blocks.length, 1);
                            });
                        });
                    });

                });
        });
    });


    mocha.describe('multipart upload', function() {

        mocha.it('should list_multipart_parts', function() {
            this.timeout(30000);
            var key = KEY + Date.now();
            var part_size = 1024;
            var num_parts = 10;
            var data = new Buffer(num_parts * part_size);
            for (var i = 0; i < data.length; i++) {
                data[i] = chance.integer(CHANCE_BYTE);
            }
            return P.fcall(function() {
                    return client.object.create_multipart_upload({
                        bucket: BKT,
                        key: key,
                        size: num_parts * part_size,
                        content_type: 'test/test'
                    });
                })
                .then(function() {
                    return client.object.list_multipart_parts({
                            bucket: BKT,
                            key: key,
                        })
                        .then(function(res) {
                            console.log('list_multipart_parts reply', res);
                        });
                })
                .then(function() {
                    var i = 0;
                    return promise_utils.loop(10, function() {
                        return client.object_driver_lazy().upload_stream_parts({
                            bucket: BKT,
                            key: key,
                            size: part_size,
                            content_type: 'application/octet-stream',
                            source_stream: new SliceReader(data, {
                                start: i * part_size,
                                end: (i + 1) * part_size
                            }),
                            upload_part_number: (i++)
                        });
                    });
                })
                .then(function() {
                    return client.object.list_multipart_parts({
                            bucket: BKT,
                            key: key,
                            part_number_marker: 1,
                            max_parts: 1
                        })
                        .then(function(res) {
                            console.log('list_multipart_parts reply', res);
                        });
                })
                .then(function() {
                    return client.object.complete_multipart_upload({
                        bucket: BKT,
                        key: key,
                        fix_parts_size: true
                    });
                })
                .then(function() {
                    return client.object_driver_lazy().read_entire_object({
                        bucket: BKT,
                        key: key,
                    });
                })
                .then(function(read_buf) {
                    assert.strictEqual(data.length, read_buf.length, "mismatch data length");
                    for (var i = 0; i < data.length; i++) {
                        assert.strictEqual(data[i], read_buf[i], "mismatch data at offset " + i);
                    }
                });
        });

    });

});
