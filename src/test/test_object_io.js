'use strict';

let _ = require('lodash');
let P = require('../util/promise');
let mocha = require('mocha');
let assert = require('assert');
let argv = require('minimist')(process.argv);
let promise_utils = require('../util/promise_utils');
let coretest = require('./coretest');
let ObjectIO = require('../api/object_io');
let SliceReader = require('../util/slice_reader');

let chance_seed = argv.seed || Date.now();
console.log('using seed', chance_seed);
let chance = require('chance')(chance_seed);

let dbg = require('../util/debug_module')(__filename);
dbg.set_level(5, 'core');

mocha.describe('object_io', function() {

    let client = coretest.new_test_client();
    let object_io = new ObjectIO();
    object_io.set_verification_mode();

    let SYS = 'test-object-system';
    let BKT = 'files'; // the default bucket name
    let KEY = 'test-object-key';
    let EMAIL = 'test-object-email@mail.mail';
    let PASSWORD = 'test-object-password';

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
        // return coretest.clear_test_nodes();
    });


    mocha.it('works', function() {
        this.timeout(30000);
        let key = KEY + Date.now();
        return P.fcall(function() {
            return client.object.create_object_upload({
                bucket: BKT,
                key: key,
                size: 0,
                content_type: 'application/octet-stream',
            });
        }).then(function(create_reply) {
            return client.object.complete_object_upload({
                bucket: BKT,
                key: key,
                upload_id: create_reply.upload_id,
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
                prefix: key,
            });
        }).then(function() {
            return client.object.delete_object({
                bucket: BKT,
                key: key,
            });
        });
    });

    let CHANCE_BYTE = {
        min: 0,
        max: 255,
    };


    mocha.describe('object IO', function() {

        let OBJ_NUM_PARTS = 16;
        let OBJ_PART_SIZE = 128 * 1024;
        let CHANCE_PART_NUM = {
            min: 0,
            max: OBJ_NUM_PARTS,
        };
        let CHANCE_PART_OFFSET = {
            min: 0,
            max: OBJ_PART_SIZE - 1,
        };


        mocha.it('should write and read object data', function() {
            this.timeout(30000);
            let key = KEY + Date.now();
            let size, data;
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
                    for (let i = 0; i < size; i++) {
                        data[i] = chance.integer(CHANCE_BYTE);
                    }
                    return object_io.upload_stream({
                        client: client,
                        bucket: BKT,
                        key: key,
                        size: size,
                        content_type: 'application/octet-stream',
                        source_stream: new SliceReader(data),
                        calculate_md5: true,
                    });
                }).then(function() {
                    return object_io.read_entire_object({
                        client: client,
                        bucket: BKT,
                        key: key,
                        start: 0,
                        end: size,
                    });
                }).then(function(read_buf) {

                    // verify the read buffer equals the written buffer
                    assert.strictEqual(data.length, read_buf.length);
                    for (let i = 0; i < size; i++) {
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
                            let blocks = _.flatten(_.map(part.fragments, 'blocks'));
                            let blocks_per_node = _.groupBy(blocks, function(block) {
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
            let upload_id;
            let key = KEY + Date.now();
            let part_size = 1024;
            let num_parts = 10;
            let data = new Buffer(num_parts * part_size);
            for (let i = 0; i < data.length; i++) {
                data[i] = chance.integer(CHANCE_BYTE);
            }
            return P.fcall(function() {
                    return client.object.create_object_upload({
                        bucket: BKT,
                        key: key,
                        size: num_parts * part_size,
                        content_type: 'test/test'
                    });
                })
                .then(function(create_reply) {
                    upload_id = create_reply.upload_id;
                    return client.object.list_multipart_parts({
                            bucket: BKT,
                            key: key,
                            upload_id: upload_id,
                        })
                        .then(function(res) {
                            console.log('list_multipart_parts reply', res);
                        });
                })
                .then(function() {
                    let i = -1;
                    return promise_utils.loop(10, function() {
                        i++;
                        return object_io.upload_stream_parts({
                            client: client,
                            bucket: BKT,
                            key: key,
                            upload_id: upload_id,
                            upload_part_number: i,
                            size: part_size,
                            source_stream: new SliceReader(data, {
                                start: i * part_size,
                                end: (i + 1) * part_size
                            }),
                            calculate_md5: true,
                        })
                        .then((md5_digest) => client.object.complete_part_upload({
                            bucket: BKT,
                            key: key,
                            upload_id: upload_id,
                            upload_part_number: i,
                            etag: md5_digest.md5.toString('hex')
                        }));
                    });
                })
                .then(function() {
                    return client.object.list_multipart_parts({
                            bucket: BKT,
                            key: key,
                            upload_id: upload_id,
                            part_number_marker: 1,
                            max_parts: 1
                        })
                        .then(function(res) {
                            console.log('list_multipart_parts reply', res);
                        });
                })
                .then(function() {
                    return client.object.complete_object_upload({
                        bucket: BKT,
                        key: key,
                        upload_id: upload_id,
                        fix_parts_size: true
                    });
                })
                .then(function() {
                    return object_io.read_entire_object({
                        client: client,
                        bucket: BKT,
                        key: key,
                    });
                })
                .then(function(read_buf) {
                    assert.strictEqual(data.length, read_buf.length, "mismatch data length");
                    for (let i = 0; i < data.length; i++) {
                        assert.strictEqual(data[i], read_buf[i], "mismatch data at offset " + i);
                    }
                });
        });

    });

});
