/* Copyright (C) 2020 NooBaa */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const buffer_utils = require('../../../util/buffer_utils');
const native_fs_utils = require('../../../util/native_fs_utils');
const { FileReader } = require('../../../util/file_reader');
const { multi_buffer_pool } = require('../../../sdk/namespace_fs');

const fs_context = {};

describe('FileReader', () => {

    const test_files = fs.readdirSync(__dirname).map(file => path.join(__dirname, file));

    /**
     * @param {(file_path: string, start?: number, end?: number) => void} tester
     */
    function describe_read_cases(tester) {
        describe('list files and read entire', () => {
            for (const file_path of test_files) {
                tester(file_path);
            }
        });
        describe('skip start cases', () => {
            tester(__filename, 1, Infinity);
            tester(__filename, 3, Infinity);
            tester(__filename, 11, Infinity);
            tester(__filename, 1023, Infinity);
            tester(__filename, 1024, Infinity);
            tester(__filename, 1025, Infinity);
        });
        describe('edge cases', () => {
            tester(__filename, 0, 1);
            tester(__filename, 0, 2);
            tester(__filename, 0, 3);
            tester(__filename, 1, 2);
            tester(__filename, 1, 3);
            tester(__filename, 2, 3);
            tester(__filename, 0, 1023);
            tester(__filename, 0, 1024);
            tester(__filename, 0, 1025);
            tester(__filename, 1, 1023);
            tester(__filename, 1, 1024);
            tester(__filename, 1, 1025);
            tester(__filename, 1023, 1024);
            tester(__filename, 1023, 1025);
            tester(__filename, 1024, 1025);
            tester(__filename, 123, 345);
            tester(__filename, 1000000000, Infinity);
        });
    }

    describe('as stream.Readable', () => {

        describe_read_cases(tester);

        function tester(file_path, start = 0, end = Infinity) {
            const basename = path.basename(file_path);
            it(`test read ${start}-${end} ${basename}`, async () => {
                await native_fs_utils.use_file({
                    fs_context,
                    bucket_path: file_path,
                    open_path: file_path,
                    scope: async file => {
                        const stat = await file.stat(fs_context);
                        const aborter = new AbortController();
                        const signal = aborter.signal;
                        const file_reader = new FileReader({
                            fs_context,
                            file,
                            file_path,
                            stat,
                            start,
                            end,
                            signal,
                            multi_buffer_pool,
                            highWaterMark: 1024, // bytes
                        });
                        const data = await buffer_utils.read_stream_join(file_reader);
                        const node_fs_stream = fs.createReadStream(file_path, { start, end: end > 0 ? end - 1 : 0 });
                        const node_fs_data = await buffer_utils.read_stream_join(node_fs_stream);
                        assert.strictEqual(data.length, node_fs_data.length);
                        assert.strictEqual(data.toString(), node_fs_data.toString());
                    }
                });
            });
        }
    });

    describe('read_into_stream with buffer pooling', () => {

        describe_read_cases(tester);

        function tester(file_path, start = 0, end = Infinity) {
            const basename = path.basename(file_path);
            it(`test read ${start}-${end} ${basename}`, async () => {
                await native_fs_utils.use_file({
                    fs_context,
                    bucket_path: file_path,
                    open_path: file_path,
                    scope: async file => {
                        const stat = await file.stat(fs_context);
                        const aborter = new AbortController();
                        const signal = aborter.signal;
                        const file_reader = new FileReader({
                            fs_context,
                            file,
                            file_path,
                            stat,
                            start,
                            end,
                            signal,
                            multi_buffer_pool,
                            highWaterMark: 1024, // bytes
                        });
                        const writable = buffer_utils.write_stream();
                        await file_reader.read_into_stream(writable);
                        const data = writable.join();
                        const node_fs_stream = fs.createReadStream(file_path, { start, end: end > 0 ? end - 1 : 0 });
                        const node_fs_data = await buffer_utils.read_stream_join(node_fs_stream);
                        assert.strictEqual(data.length, node_fs_data.length);
                        assert.strictEqual(data.toString(), node_fs_data.toString());
                    }
                });
            });
        }

    });

});
