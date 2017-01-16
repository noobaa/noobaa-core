/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

let _ = require('lodash');
let mocha = require('mocha');
let assert = require('assert');
let argv = require('minimist')(process.argv);

let P = require('../../util/promise');
// let dbg = require('../../util/debug_module')(__filename);
let ObjectIO = require('../../api/object_io');
let SliceReader = require('../../util/slice_reader');
let promise_utils = require('../../util/promise_utils');

let chance_seed = argv.seed || Date.now();
console.log('using seed', chance_seed);
let chance = require('chance')(chance_seed);

mocha.describe('object_io', function() {

    let client = coretest.new_test_client();
    let object_io = new ObjectIO();
    object_io.set_verification_mode();

    const SYS = 'test-object-system';
    const BKT = 'files'; // the default bucket name
    const KEY = 'test-object-key';
    const EMAIL = 'test-object-email@mail.mail';
    const PASSWORD = 'test-object-password';
    // const NODE = 'test-node';

    mocha.before(function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(30000);

        return P.resolve()
            .then(() => client.system.create_system({
                activation_code: '1111',
                name: SYS,
                email: EMAIL,
                password: PASSWORD
            }))
            .then(res => {
                client.options.auth_token = res.token;
            })
            .then(() => client.create_auth_token({
                email: EMAIL,
                password: PASSWORD,
                system: SYS,
            }))
            .delay(2000)
            .then(() => coretest.init_test_nodes(client, SYS, 20));
    });

    mocha.after(function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(30000);

        return coretest.clear_test_nodes();
    });


    mocha.it('works', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(30000);

        let key = KEY + Date.now();
        return P.resolve()
            .then(() => client.object.create_object_upload({
                bucket: BKT,
                key: key,
                content_type: 'application/octet-stream',
            }))
            .then(create_reply => client.object.complete_object_upload({
                bucket: BKT,
                key: key,
                upload_id: create_reply.upload_id,
            }))
            .then(() => client.object.read_object_md({
                bucket: BKT,
                key: key,
            }))
            .then(() => client.object.update_object_md({
                bucket: BKT,
                key: key,
                content_type: 'text/plain',
            }))
            .then(() => client.object.list_objects({
                bucket: BKT,
                prefix: key,
            }))
            .then(() => client.object.delete_object({
                bucket: BKT,
                key: key,
            }));
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
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(30000);

            let key = KEY + Date.now();
            let size;
            let data;
            return P.resolve()
                .then(() => client.node.list_nodes({}))
                .then(nodes => console.log("list_nodes in use", nodes))
                .then(() => {
                    // randomize size with equal chance on KB sizes
                    size = (OBJ_PART_SIZE * chance.integer(CHANCE_PART_NUM)) +
                        chance.integer(CHANCE_PART_OFFSET);
                    // randomize a buffer
                    console.log('random object size', size);
                    data = new Buffer(size);
                    for (let i = 0; i < size; i++) {
                        data[i] = chance.integer(CHANCE_BYTE);
                    }
                    return object_io.upload_object({
                        client: client,
                        bucket: BKT,
                        key: key,
                        size: size,
                        content_type: 'application/octet-stream',
                        source_stream: new SliceReader(data),
                    });
                })
                .then(() => object_io.read_entire_object({
                    client: client,
                    bucket: BKT,
                    key: key,
                    start: 0,
                    end: size,
                }))
                .then(read_buf => {

                    // verify the read buffer equals the written buffer
                    assert.strictEqual(data.length, read_buf.length);
                    for (let i = 0; i < size; i++) {
                        assert.strictEqual(data[i], read_buf[i]);
                    }
                    console.log('READ SUCCESS');

                })
                .then(() => client.object.read_object_mappings({
                    bucket: BKT,
                    key: key,
                    adminfo: true
                }))
                .then(res => {
                    // testing mappings that nodes don't repeat in the same fragment
                    _.each(res.parts, function(part) {
                        let blocks = _.flatten(_.map(part.fragments, 'blocks'));
                        let blocks_per_node = _.groupBy(blocks, function(block) {
                            return block.adminfo.node_name;
                        });
                        console.log('VERIFY MAPPING UNIQUE ON NODE', blocks_per_node);
                        _.each(blocks_per_node, function(b, node_name) {
                            assert.strictEqual(b.length, 1);
                        });
                    });
                });
        });
    });


    mocha.describe('multipart upload', function() {

        mocha.it('should list_multiparts', function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(30000);

            let upload_id;
            let key = KEY + Date.now();
            let part_size = 1024;
            let num_parts = 10;
            let data = new Buffer(num_parts * part_size);
            for (let i = 0; i < data.length; i++) {
                data[i] = chance.integer(CHANCE_BYTE);
            }
            return P.resolve()
                .then(() => client.object.create_object_upload({
                    bucket: BKT,
                    key: key,
                    content_type: 'test/test'
                }))
                .then(create_reply => {
                    upload_id = create_reply.upload_id;
                })
                .then(() => client.object.list_multiparts({
                    bucket: BKT,
                    key: key,
                    upload_id: upload_id,
                }))
                .tap(list => console.log('list_multiparts reply', list))
                .then(list => promise_utils.loop(num_parts, i => object_io.upload_multipart({
                    client: client,
                    bucket: BKT,
                    key: key,
                    upload_id: upload_id,
                    num: i + 1,
                    size: part_size,
                    source_stream: new SliceReader(data, {
                        start: i * part_size,
                        end: (i + 1) * part_size
                    }),
                })))
                .then(() => client.object.list_multiparts({
                    bucket: BKT,
                    key: key,
                    upload_id: upload_id,
                }))
                .tap(list => console.log('list_multiparts reply', list))
                .then(list => client.object.complete_object_upload({
                    bucket: BKT,
                    key: key,
                    upload_id: upload_id,
                    multiparts: _.map(list.multiparts, p => ({
                        num: p.num,
                        etag: p.etag,
                    }))
                }))
                .then(() => object_io.read_entire_object({
                    client: client,
                    bucket: BKT,
                    key: key,
                }))
                .then(read_buf => {
                    assert.strictEqual(data.length, read_buf.length, "mismatch data length");
                    for (let i = 0; i < data.length; i++) {
                        assert.strictEqual(data[i], read_buf[i], "mismatch data at offset " + i);
                    }
                });
        });

    });

});
