/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const util = require('util');
const assert = require('assert');
const buffer_utils = require('../../util/buffer_utils');
const NamespaceFS = require('../../sdk/namespace_fs');

const inspect = (x, max_arr = 5) => util.inspect(x, { colors: true, depth: null, maxArrayLength: max_arr });

mocha.describe('namespace_fs', function() {

    const nsfs = new NamespaceFS({ data_path: '.' });

    mocha.it('list_objects', async function() {
        const res = await nsfs.list_objects({
            bucket: 'src',
            prefix: '',
            key_marker: '',
            delimiter: '/',
            limit: 5,
        });
        console.log(inspect(res, res.length));
        let prev_key = '';
        for (const { key } of res.objects) {
            if (res.next_marker) {
                assert(key < res.next_marker, 'bad next_marker at key ' + key);
            }
            assert(prev_key <= key, 'objects not sorted at key ' + key);
            prev_key = key;
        }
        prev_key = '';
        for (const key of res.common_prefixes) {
            if (res.next_marker) {
                assert(key < res.next_marker, 'next_marker at key ' + key);
            }
            assert(prev_key <= key, 'prefixes not sorted at key ' + key);
            prev_key = key;
        }
    });

    mocha.it('list_uploads', async function() {
        const res = await nsfs.list_uploads({
            bucket: 'src',
            prefix: '',
            key_marker: '',
            delimiter: '/',
            limit: 5,
        });
        console.log(inspect(res, res.length));
    });

    mocha.it('list_object_versions', async function() {
        const res = await nsfs.list_object_versions({
            bucket: 'src',
            prefix: '',
            key_marker: '',
            delimiter: '/',
            limit: 5,
        });
        console.log(inspect(res, res.length));
    });

    mocha.it('read_object_md', async function() {
        const res = await nsfs.read_object_md({
            bucket: 'src',
            key: 'test/unit_tests/test_namespace_fs.js',
        });
        console.log(inspect(res));
    });

    mocha.it('read_object_stream full', async function() {
        const stream = await nsfs.read_object_stream({
            bucket: 'src',
            key: 'test/unit_tests/test_namespace_fs.js',
        });
        const res = (await buffer_utils.read_stream_join(stream)).toString();
        assert.strict.equal(res.slice(13, 28), '(C) 2016 NooBaa');
        assert.strict.equal(res.slice(37, 43), 'strict');
    });

    mocha.it('read_object_stream range', async function() {
        const stream = await nsfs.read_object_stream({
            bucket: 'src',
            key: 'test/unit_tests/test_namespace_fs.js',
            start: 13,
            end: 28,
        });
        const res = (await buffer_utils.read_stream_join(stream)).toString();
        assert.strict.equal(res, '(C) 2016 NooBaa');
    });

    mocha.it('read_object_stream range above size', async function() {
        const too_high = 1000000000;
        const stream = await nsfs.read_object_stream({
            bucket: 'src',
            key: 'test/unit_tests/test_namespace_fs.js',
            start: too_high,
            end: too_high + 10,
        });
        const res = (await buffer_utils.read_stream_join(stream)).toString();
        assert.strict.equal(res, '');
    });

    mocha.it('upload_object', async function() {
        const upload_res = await nsfs.upload_object({
            bucket: 'src',
            key: 'test/unit_tests/test_namespace_fs.upload_object',
            source_stream: buffer_utils.buffer_to_read_stream(Buffer.from('abc'))
        });
        console.log(inspect(upload_res));

        const stream = await nsfs.read_object_stream({
            bucket: 'src',
            key: 'test/unit_tests/test_namespace_fs.upload_object',
            source_stream: buffer_utils.buffer_to_read_stream(Buffer.from('abc'))
        });
        const res = (await buffer_utils.read_stream_join(stream)).toString();
        assert.strict.equal(res, 'abc');

        const delete_res = await nsfs.delete_object({
            bucket: 'src',
            key: 'test/unit_tests/test_namespace_fs.upload_object',
        });
        console.log(inspect(delete_res));
    });

});
