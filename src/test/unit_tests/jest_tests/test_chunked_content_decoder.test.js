/* Copyright (C) 2025 NooBaa */
'use strict';

const stream = require('stream');
const assert = require('assert');
const ChunkedContentDecoder = require('../../../util/chunked_content_decoder');
const buffer_utils = require('../../../util/buffer_utils');

describe('ChunkedContentDecoder', function() {

    // Reminder about chunk structure:
    // <hex bytes of data>\r\n
    // <data>
    //....
    // the end of the chunk:
    // 0\r\n
    // \r\n
    //
    // The following example was copied from:
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Transfer-Encoding
    // 7\r\n
    // Mozilla\r\n
    // 11\r\n
    // Developer Network\r\n
    // 0\r\n
    // \r\n

    // for easier debugging you can set the number of iteration here:
    const NUMBER_OF_ITERATIONS_IMPORTANT_CASE = 100;
    const NUMBER_OF_ITERATIONS_DEFAULT = 2;

    describe('expected to parse the input', function() {
        test_parse_output({
            name: 'one_chunk',
            input:
                '3\r\n' +
                'foo\r\n' +
                '0\r\n' +
                '\r\n',
            output: 'foo',
            iterations: NUMBER_OF_ITERATIONS_DEFAULT,
        });

        test_parse_output({
            name: 'two_chunks',
            input:
                '3\r\n' +
                'foo\r\n' +
                '3\r\n' +
                'bar\r\n' +
                '0\r\n' +
                '\r\n',
            output: 'foobar',
            iterations: NUMBER_OF_ITERATIONS_IMPORTANT_CASE,
        });

        test_parse_output({
            name: 'three_chunks_with_trailers',
            input:
                '3\r\n' +
                'foo\r\n' +
                '6\r\n' +
                'barbaz\r\n' +
                'ff\r\n' +
                'f'.repeat(255) + '\r\n' +
                '0\r\n' +
                'x-trailer-1:value\r\n' +
                'x-trailer-2:value\r\n' +
                '\r\n',
            output: 'foobarbaz' + 'f'.repeat(255),
            iterations: NUMBER_OF_ITERATIONS_IMPORTANT_CASE,
            check: decoder => {
                assert.deepStrictEqual(decoder.trailers, [
                    'x-trailer-1:value',
                    'x-trailer-2:value',
                ]);
            },
        });

    test_parse_output({
        name: 'no_chunk_with_trailers',
        input:
            '0\r\n' +
            'movie:trailer\r\n' +
            'semi:trailer\r\n' +
            '\r\n',
        output: '',
        iterations: NUMBER_OF_ITERATIONS_IMPORTANT_CASE,
        check: decoder => {
            assert.deepStrictEqual(decoder.trailers, [
                'movie:trailer',
                'semi:trailer',
            ]);
        },
    });

    test_parse_output({
        name: 'one_chunk_with_extension',
        input:
            '3;crc=1a2b3c4d\r\n' +
            'EXT\r\n' +
            '0\r\n' +
            '\r\n',
        output: 'EXT',
        iterations: NUMBER_OF_ITERATIONS_IMPORTANT_CASE,
    });

    test_parse_output({
        name: 'one_chunk_with_extension_and_trailer',
        input:
            '3;crc=1a2b3c4d\r\n' +
            'EXT\r\n' +
            '0\r\n' +
            create_trailers(1) +
            '\r\n',
        output: 'EXT',
        iterations: NUMBER_OF_ITERATIONS_IMPORTANT_CASE,
    });

    test_parse_output({
        name: 'one_chunk_with_trailers', // lower than MAX_CHUNK_HEADER_SIZE
        input:
            '3\r\n' +
            'foo\r\n' +
            '0\r\n' +
            create_trailers(19) +
            '\r\n',
        output: 'foo',
        iterations: NUMBER_OF_ITERATIONS_DEFAULT,
    });

    });

    describe('expected to have an error on parse', function() {

        test_parse_error({
            name: 'chunk_size_not_hex',
            input: 'invalid\r\n\r\n',
            error_pos: 7, // end of header
            iterations: NUMBER_OF_ITERATIONS_IMPORTANT_CASE,
        });

        test_parse_error({
            name: 'chunk_size_too_big', // according to MAX_CHUNK_SIZE
            input: '10000000001\r\n\r\n',
            error_pos: 11, // end of header
            iterations: NUMBER_OF_ITERATIONS_IMPORTANT_CASE,
        });

        test_parse_error({
            name: 'header_too_long', // according to MAX_CHUNK_HEADER_SIZE
            input: '0' + ';'.repeat(1024) + '\r\n\r\n',
            error_pos: 1025, // end of header
            iterations: NUMBER_OF_ITERATIONS_IMPORTANT_CASE,
        });

        test_parse_error({
            name: 'too_many_trailers', // according to MAX_CHUNK_HEADER_SIZE
            input:
            '3\r\n' +
            'foo\r\n' +
            '0\r\n' +
            create_trailers(21) +
            '\r\n',
            error_pos: 420, // last trailer position
            iterations: NUMBER_OF_ITERATIONS_DEFAULT,
        });

    });

    /**
     * @param {{
     *      name: string,
     *      input: string,
     *      output: string,
     *      iterations?: number
     *      check?: (decoder: ChunkedContentDecoder) => void,
     * }} params
     */
    function test_parse_output({ name, input, output, check, iterations = NUMBER_OF_ITERATIONS_DEFAULT}) {
        it(name, async function() {
            for (let i = 0; i < iterations; ++i) {
                const decoder = new ChunkedContentDecoder();
                console.log(`test_parse_output(${name}): decoder input`, input, decoder.get_debug_info());
                const readable = new stream.Readable({
                    read() {
                        // split at random position
                        const sp = Math.floor(input.length * Math.random());
                        this.push(input.slice(0, sp));
                        this.push(input.slice(sp));
                        this.push(null);
                    }
                });
                const writable = buffer_utils.write_stream();
                await stream.promises.pipeline(readable, decoder, writable);
                const decoded = buffer_utils.join(writable.buffers, writable.total_length);
                console.log(`test_parse_output(${name}): decoder returned`, decoded, decoder.get_debug_info());
                assert.deepStrictEqual(decoded, Buffer.from(output));
                if (check) check(decoder);
            }
        });
    }

    /**
     * @param {{
     *      name: string,
     *      input: string,
     *      error_pos?: number,
     *      iterations?: number
     * }} params
     */
    function test_parse_error({ name, input, error_pos, iterations = NUMBER_OF_ITERATIONS_DEFAULT }) {
        it(name, async function() {
            for (let i = 0; i < iterations; ++i) {
                const decoder = new ChunkedContentDecoder();
                console.log(`test_parse_error(${name}): decoder input`, input, decoder.get_debug_info());
                console.log(name, 'decode', decoder);
                try {
                    const readable = new stream.Readable({
                        read() {
                            // split at random position
                            const sp = Math.floor(input.length * Math.random());
                            this.push(input.slice(0, sp));
                            this.push(input.slice(sp));
                            this.push(null);
                        }
                    });
                    const writable = buffer_utils.write_stream();
                    await stream.promises.pipeline(readable, decoder, writable);
                    const decoded = buffer_utils.join(writable.buffers, writable.total_length);
                    console.log(`test_parse_error(${name}): decoder returned`, decoded, decoder.get_debug_info());
                    assert.fail('Should have failed');
                } catch (err) {
                    if (err.message === 'Should have failed') throw err;
                    console.log(`test_parse_error(${name}): decoder caught`, err, decoder.get_debug_info());
                    if (error_pos !== undefined) {
                        assert.strictEqual(decoder.stream_pos, error_pos);
                    }
                }
            }
        });
    }


    /**
     * create_trailers will return a single string with the number of trailers
     * @param {number} number_of_trailers
     * @returns string
     */
    function create_trailers(number_of_trailers) {
        const trailers = [];
        for (let index = 1; index <= number_of_trailers; ++index) {
            const trailer = `x-trailer-${index}:value\r\n`;
            trailers.push(trailer);
        }
        return trailers.join('');
    }

});
