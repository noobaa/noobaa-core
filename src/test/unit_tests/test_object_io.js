/* Copyright (C) 2016 NooBaa */
/*eslint max-lines-per-function: ["error", 600]*/
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

const _ = require('lodash');
const mocha = require('mocha');
const util = require('util');
const crypto = require('crypto');
const assert = require('assert');
const stream = require('stream');

const ObjectIO = require('../../sdk/object_io');
const { crypto_random_string } = require('../../util/string_utils');

const { rpc_client } = coretest;
const object_io = new ObjectIO();
object_io.set_verification_mode();

const seed = crypto.randomBytes(16);
const generator = crypto.createCipheriv('aes-128-gcm', seed, Buffer.alloc(12));

coretest.describe_mapper_test_case({
    name: 'object_io',
    bucket_name_prefix: 'test-object-io',
}, ({
    test_name,
    bucket_name,
    data_placement,
    num_pools,
    replicas,
    data_frags,
    parity_frags,
    total_frags,
    total_blocks,
    total_replicas,
    chunk_coder_config,
}) => {

    // TODO we need to create more nodes and pools to support all MAPPER_TEST_CASES
    if (data_placement !== 'SPREAD' || num_pools !== 1 || total_blocks > 10) return;
    // if (total_blocks > 10) return;

    const bucket = bucket_name;
    const KEY = 'test-object-io-key';

    let nodes_list;
    let key_counter = 1;
    let small_loops = 1;
    let medium_loops = 1;
    let big_loops = 0;
    if ((replicas === 3 && data_frags === 1 && parity_frags === 0) ||
        (replicas === 1 && data_frags === 4 && parity_frags === 2)) {
        small_loops = 10;
        medium_loops = 3;
        big_loops = 3;
    }

    mocha.before(async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const { nodes } = await rpc_client.node.list_nodes({});
        nodes_list = nodes;
    });

    mocha.it('empty object', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const key = `${KEY}-${key_counter}`;
        key_counter += 1;
        const content_type = 'application/octet-stream';
        const content_type2 = 'text/plain';
        const { obj_id } = await rpc_client.object.create_object_upload({ bucket, key, content_type });
        await rpc_client.object.complete_object_upload({ obj_id, bucket, key });
        const object_md = await rpc_client.object.read_object_md({ bucket, key, adminfo: {} });
        assert.strictEqual(object_md.num_parts, 0);
        assert.strictEqual(object_md.capacity_size, 0);
        await rpc_client.object.update_object_md({ bucket, key, content_type: content_type2 });
        await rpc_client.object.list_objects_admin({ bucket, prefix: key });
        await rpc_client.object.delete_object({ bucket, key });
    });

    mocha.it('upload_and_verify', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        for (let i = 0; i < small_loops; ++i) await upload_and_verify(61);
        for (let i = 0; i < medium_loops; ++i) await upload_and_verify(4015);
        for (let i = 0; i < big_loops; ++i) await upload_and_verify(10326);
    });

    mocha.it('multipart_upload_and_verify', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        for (let i = 0; i < small_loops; ++i) await multipart_upload_and_verify(45, 7);
        for (let i = 0; i < medium_loops; ++i) await multipart_upload_and_verify(3245, 5);
        for (let i = 0; i < big_loops; ++i) await multipart_upload_and_verify(7924, 3);
    });

    /*
    *  cached_parts:         [  data  ]      [  data     ]        [  data    ]
    *  read_range:                              [   ]
    */
    mocha.it('range_part_upload_and_verify_range_in_cache', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        await range_parts_upload_and_verify({
            cached_parts: [{start: 100, end: 200 }, {start: 10, end: 20 }, {start: 400, end: 500 }],
            read_range: { start: 120, end: 130 }
        });
    });

    /*
    *  cached_parts:         [  data  ]      [  data     ]        [  data    ]
    *  read_range:    0[        ]
    */
   mocha.it('range_part_upload_and_verify_partial_range_in_cache_start', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        await range_parts_upload_and_verify({
            cached_parts: [{start: 100, end: 200 }, {start: 10, end: 20 }, {start: 400, end: 500 }],
            read_range: { start: 0, end: 15 }
        });
    });

    /*
    *  cached_parts:         [  data  ]      [  data     ]        [  data    ]
    *  read_range:                        [      ]
    */
    mocha.it('range_part_upload_and_verify_partial_range_in_cache_middle_start', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        await range_parts_upload_and_verify({
            cached_parts: [{start: 100, end: 200 }, {start: 10, end: 20 }, {start: 400, end: 500 }],
            read_range: { start: 50, end: 150 }
        });
    });

   /*
    *  cached_parts:         [  data  ]      [  data     ]        [  data    ]
    *  read_range:                                   [      ]
    */
   mocha.it('range_part_upload_and_verify_partial_range_in_cache_middle_end', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        await range_parts_upload_and_verify({
            cached_parts: [{start: 100, end: 200 }, {start: 10, end: 20 }, {start: 400, end: 500 }],
            read_range: { start: 150, end: 250 }
        });
    });

    /*
    *  cached_parts:         [  data  ]      [  data     ]        [  data    ]
    *  read_range:                                                       [      ]
    */
    mocha.it('range_part_upload_and_verify_partial_range_in_cache_end', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        await range_parts_upload_and_verify({
            cached_parts: [{start: 100, end: 200 }, {start: 10, end: 20 }, {start: 400, end: 500 }],
            read_range: { start: 450, end: 510 }
        });
    });

    /*
    *  cached_parts:         [  data  ]      [  data     ]        [  data    ]
    *  read_range:        [              ]
    */
    mocha.it('range_part_upload_and_verify_partial_range_covering_cache_part', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        await range_parts_upload_and_verify({
            cached_parts: [{start: 100, end: 200 }, {start: 10, end: 20 }, {start: 400, end: 500 }],
            read_range: { start: 5, end: 25 }
        });
    });

    /*
    *  cached_parts:         [   data  ]      [           ]        [          ]
    *  read_range:               [                ]
    */
    mocha.it('range_part_upload_and_verify_range_span_multiple_cached_parts_1', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        await range_parts_upload_and_verify({
            cached_parts: [{start: 100, end: 200 }, {start: 10, end: 20 }, {start: 400, end: 500 }],
            read_range: { start: 15, end: 110 }
        });
    });

    /*
    *  cached_parts:         [  data  ]      [  data     ]        [  data    ]
    *  read_range:               [                           ]
    */
    mocha.it('range_part_upload_and_verify_range_span_multiple_cached_parts_2', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        await range_parts_upload_and_verify({
            cached_parts: [{start: 100, end: 200 }, {start: 10, end: 20 }, {start: 400, end: 500 }],
            read_range: { start: 15, end: 210 }
        });
    });

    /*
    *  cached_parts:         [  data  ]      [  data     ]        [  data    ]
    *  read_range:                        [                                      ]
    */
    mocha.it('range_part_upload_and_verify_range_span_multiple_cached_parts_3', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        await range_parts_upload_and_verify({
            cached_parts: [{start: 100, end: 200 }, {start: 10, end: 20 }, {start: 400, end: 500 }],
            read_range: { start: 50, end: 510 }
        });
    });

    /*
    *  cached_parts:         [  data  ]      [  data     ]        [  data    ]
    *  read_range:       [  ]
    */
    mocha.it('range_part_upload_and_verify_range_not_in_cached_parts_at_start', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        await range_parts_upload_and_verify({
            cached_parts: [{start: 100, end: 200 }, {start: 10, end: 20 }, {start: 400, end: 500 }],
            read_range: { start: 5, end: 10 }
        });
    });

    /*
    *  cached_parts:         [  data  ]      [  data     ]        [  data    ]
    *  read_range:                                         [   ]
    */
    mocha.it('range_part_upload_and_verify_range_not_in_cached_parts_middle', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        await range_parts_upload_and_verify({
            cached_parts: [{start: 100, end: 200 }, {start: 10, end: 20 }, {start: 400, end: 500 }],
            read_range: { start: 220, end: 240 }
        });
    });

   /*
    *  cached_parts:         [  data  ]      [  data     ]        [  data    ]
    *  read_range:                                                             [   ]
    */
   mocha.it('range_part_upload_and_verify_range_not_in_cached_parts_at_end', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        await range_parts_upload_and_verify({
            cached_parts: [{start: 100, end: 200 }, {start: 10, end: 20 }, {start: 400, end: 500 }],
            read_range: { start: 501, end: 510 }
        });
    });

    mocha.it('range_part_upload_and_verify_0_start_range_no_cached_part', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        await range_parts_upload_and_verify({
            cached_parts: [],
            read_range: { start: 0, end: 140 }
        });
    });

    mocha.it('range_part_upload_and_verify_range_middle_no_cached_part', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        await range_parts_upload_and_verify({
            cached_parts: [],
            read_range: { start: 220, end: 240 }
        });
    });

    async function upload_and_verify(size) {
        const data = generator.update(Buffer.alloc(size));
        const key = `${KEY}-${key_counter}`;
        key_counter += 1;
        const params = {
            client: rpc_client,
            bucket,
            key,
            size,
            content_type: 'application/octet-stream',
            source_stream: readable_buffer(data),
        };
        await object_io.upload_object(params);
        await verify_read_mappings(key, size);
        await verify_read_data(key, data, params.obj_id);
        await verify_nodes_mapping();
        await rpc_client.object.delete_object({ bucket, key });
        coretest.log('upload_and_verify: OK', size);
    }

    async function multipart_upload_and_verify(part_size, num_parts) {
        const key = `${KEY}-${key_counter}`;
        key_counter += 1;
        const content_type = 'test/test';
        const size = num_parts * part_size;
        const data = generator.update(Buffer.alloc(size));
        const { obj_id } = await rpc_client.object.create_object_upload({ bucket, key, content_type });

        const mp_list_before = await rpc_client.object.list_multiparts({ obj_id, bucket, key });
        coretest.log('list_multiparts before', mp_list_before);
        assert.strictEqual(mp_list_before.multiparts.length, 0);

        const get_part_slice = i => data.slice(i * part_size, (i + 1) * part_size);

        const upload_multipart = (i, mp_data, split, finish) =>
            object_io.upload_multipart({
                client: rpc_client,
                obj_id,
                bucket,
                key,
                num: i + 1,
                size: mp_data.length,
                source_stream: readable_buffer(mp_data, split, finish),
            });

        // upload multiparts with different data that fail before they finish.
        // this is an attempt to reproduce an issue that left unfinished multiparts,
        // and when left in wrong offsets it will return bad data on read.
        await Promise.all(_.times(num_parts,
            i => upload_multipart(i, generator.update(Buffer.alloc(part_size)), 4, 'fail').catch(err => ({ err }))
        ));

        // upload multiparts with different data that completes.
        // we expect that complete_object_upload will remove these since we do not send their etags.
        await Promise.all(_.times(num_parts,
            i => upload_multipart(i, generator.update(Buffer.alloc(part_size)))
        ));

        // upload the real multiparts we want to complete with
        const multiparts = await Promise.all(_.times(num_parts,
            i => upload_multipart(i, get_part_slice(i))
        ));

        // again upload multiparts with different data that fail before they finish.
        await Promise.all(_.times(num_parts,
            i => upload_multipart(i, generator.update(Buffer.alloc(part_size)), 4, 'fail').catch(err => ({ err }))
        ));

        const mp_list_after = await rpc_client.object.list_multiparts({ obj_id, bucket, key });
        coretest.log('list_multiparts after', mp_list_after);
        assert.strictEqual(mp_list_after.multiparts.length, num_parts);
        assert.deepStrictEqual(
            mp_list_after.multiparts.map(mp => mp.etag),
            multiparts.map(mp => mp.etag)
        );

        await rpc_client.object.complete_object_upload({
            obj_id,
            bucket,
            key,
            multiparts: multiparts.map((mp, i) => ({ num: i + 1, etag: mp.etag }))
        });

        await verify_read_mappings(key, size);
        await verify_read_data(key, data, obj_id);
        await verify_nodes_mapping();
        await rpc_client.object.delete_object({ bucket, key });
        coretest.log('multipart_upload_and_verify: OK', part_size, num_parts);
    }

    async function verify_read_mappings(key, size) {
        /** @type {{ chunks: nb.ChunkInfo[]}} */
        const { chunks } = await rpc_client.object.read_object_mapping_admin({ bucket, key });
        let pos = 0;
        for (const chunk of chunks) {
            const frags = chunk.frags;
            const part = chunk.parts[0];
            const { start, end } = part;
            // coretest.log(`TODO GGG READ PART pos=${pos}`, JSON.stringify(part));
            assert.strictEqual(start, pos);
            pos = end;
            assert.strictEqual(frags.length, total_frags);
            for (const frag of frags) {
                // assert.strictEqual(frag.allocations, undefined);
                assert.strictEqual(frag.blocks.length, replicas, util.inspect(frag));
            }
            // check blocks don't repeat in the same chunk
            const part_blocks = _.flatMap(frags, 'blocks');
            const blocks_per_node = _.groupBy(part_blocks, block => block.adminfo.node_name);
            for (const blocks of Object.values(blocks_per_node)) {
                assert.strictEqual(blocks.length, 1);
            }
        }
        assert.strictEqual(pos, size);
    }

    async function verify_read_data(key, data, obj_id) {
        const object_md = await rpc_client.object.read_object_md({ bucket, key, obj_id });
        const read_buf = await object_io.read_entire_object({ client: rpc_client, object_md });
        // verify the read buffer equals the written buffer
        assert.strictEqual(data.length, read_buf.length);
        for (let i = 0; i < data.length; i++) {
            assert.strictEqual(data[i], read_buf[i], `mismatch data at pos ${i}`);
        }
    }

    async function verify_nodes_mapping() {
        await Promise.all([
            ...nodes_list.map(node =>
                rpc_client.object.read_node_mapping({
                    name: node.name,
                    adminfo: true,
                })
            ),
            ...nodes_list.map(node =>
                rpc_client.object.read_node_mapping({
                    name: `${node.os_info.hostname}#${node.host_seq}`,
                    by_host: true,
                    adminfo: true,
                })
            )
        ]);
    }

    async function range_parts_upload_and_verify(params) {
        coretest.log('range_parts_upload_and_verify: start', params);
        const key = `range-${KEY}-${key_counter}`;
        key_counter += 1;
        const content_type = 'test/test';
        const etag = crypto_random_string(32);
        const { obj_id } = await rpc_client.object.create_object_upload({ bucket, key, content_type,
            complete_upload: true, size: 12345, etag, last_modified_time: (new Date()).getTime() });

        const { cached_parts, read_range } = params;
        for (const part of cached_parts) {
            const part_size = part.end - part.start;
            const data = generator.update(Buffer.alloc(part_size));
            part.data = data;

            await object_io.upload_object_range({
                client: rpc_client,
                obj_id,
                bucket,
                key,
                start: part.start,
                end: part.end,
                size: part_size,
                source_stream: readable_buffer(data),
            });
        }

        await verify_range_read_mappings(key, cached_parts);
        await verify_read_range_data(key, obj_id, cached_parts, read_range);

        await rpc_client.object.delete_object({ bucket, key });
        coretest.log('range_parts_upload_and_verify: OK', params);
    }

    async function verify_range_read_mappings(key, cached_parts) {
        /** @type {{ chunks: nb.ChunkInfo[]}} */
        try {
            const { chunks } = await rpc_client.object.read_object_mapping_admin({ bucket, key });
            for (const chunk of chunks) {
                console.log("verify_range_read_mappings:", chunk.parts);
            }
            const tot_cached_size = _.sumBy(cached_parts, p => p.data.length);
            const tot_chunk_size = _.sumBy(chunks, p => p.parts[0].end - p.parts[0].start);

            assert.strictEqual(tot_cached_size, tot_chunk_size);
        } catch (err) {
            console.log('verify_range_read_mappings: error', { key, err });
            assert.strictEqual(cached_parts.length, 0);
        }
    }

    async function verify_read_range_data(key, obj_id, cached_parts, read_range) {
        const object_md = await rpc_client.object.read_object_md({ bucket, key, obj_id });
        let num_missing_parts_pulled = 0;

        const { buffer, generated_missing_parts } = create_missing_parts(read_range.start, read_range.end, cached_parts);
        coretest.log('verify_read_range_data: generated missing parts:', { key, generated_missing_parts });

        async function missing_part_getter(missing_part_start, missing_part_end) {
            const part = generated_missing_parts[num_missing_parts_pulled];
            console.log('missing_part_getter invoked:', { key, num_missing_parts_pulled, part, missing_part_start, missing_part_end });

            assert.strictEqual(missing_part_start, part.start);
            assert.strictEqual(missing_part_end, part.end);
            num_missing_parts_pulled += 1;
            return part.data;
        }

        const read_buf = await object_io.read_entire_object({ client: rpc_client, object_md, missing_part_getter, ...read_range });

        // verify the read buffer equals the written buffer
        assert.strictEqual(num_missing_parts_pulled, generated_missing_parts.length);
        assert.strictEqual(buffer.length, read_buf.length);
        for (let i = 0; i < buffer.length; i++) {
            assert.strictEqual(buffer[i], read_buf[i], `verify_read_range_data: mismatch data at pos ${i}`);
        }
    }

    function intersection(start1, end1, start2, end2) {
        var start = start1 > start2 ? start1 : start2;
        var end = end1 < end2 ? end1 : end2;
        return (end <= start) ? null : {
            start: start,
            end: end,
        };
    }

    function create_missing_parts(start, end, cached_parts) {
        console.log('create_missing_parts: start', { start, end, cached_parts: _.omit(cached_parts, 'data') });
        if (!cached_parts || !cached_parts.length) {
            const data = generator.update(Buffer.alloc(end - start));
            return {
                buffer: data,
                generated_missing_parts: [ { start, end, data: data } ]
            };
        }

        let pos = start;
        const buffers = [];
        const generated_missing_parts = [];
        cached_parts.sort((a, b) => a.start - b.end);
        for (const part of cached_parts) {
            let part_range = intersection(part.start, part.end, pos, end);
            console.log('create_missing_parts:', { part: _.omit(part, 'data'), part_range, pos });
            if (!part_range) {
                if (end <= part.start) {
                    const data = generator.update(Buffer.alloc(end - pos));
                    buffers.push(data);
                    generated_missing_parts.push({ start: pos, end, data });
                    pos = end;
                    break;
                }
                continue;
            }

            if (pos < part_range.start) {
                const data = generator.update(Buffer.alloc(part_range.start - pos));
                buffers.push(data);
                generated_missing_parts.push({ start: pos, end: part_range.start, data });
            }

            let buffer_start = part_range.start - part.start;
            let buffer_end = part_range.end - part.start;

            pos = part_range.end;
            buffers.push(part.data.slice(buffer_start, buffer_end));

            if (pos >= end) break;
        }
        const last_chunk_end = cached_parts[cached_parts.length - 1].end;
        if ((pos < end && pos > start) || start >= last_chunk_end) {
            const data = generator.update(Buffer.alloc(end - pos));
            buffers.push(data);
            generated_missing_parts.push({ start: pos, end, data });
        }

        const buffer = Buffer.concat(buffers);
        return { buffer, generated_missing_parts };
    }

    function readable_buffer(data, split = 1, finish = 'end') {
        const max = Math.ceil(data.length / split);
        let pos = 0;
        return new stream.Readable({
            read() {
                if (pos < data.length) {
                    const len = Math.min(data.length - pos, max);
                    const buf = data.slice(pos, pos + len);
                    pos += len;
                    setImmediate(() => this.push(buf));
                } else if (finish === 'fail') {
                    this.emit('error', new Error('TEST_OBJECT_IO FAIL ON FINISH'));
                } else {
                    this.push(null);
                }
            }
        });
    }

});
