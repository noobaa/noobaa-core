/* Copyright (C) 2023 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

const log_parser = require('../../../server/bg_services/replication_log_parser');
const server_rpc = require('../../../server/server_rpc');
const auth_server = require('../../../server/common_services/auth_server');
const rpc_client = server_rpc.rpc.new_client({
    auth_token: auth_server.make_auth_token({}),
});
const { LogReplicationScanner } = require('../../../server/bg_services/log_replication_scanner.js');

// @ts-ignore
const mock_fn = jest.fn();

describe('AWS S3 server log parsing tests', () => {
    // Pagination test
    it('Test AWS S3 server log parsing for BATCH.DELETE and REST.PUT actions', async () => {
        const logs = [];
        const example_log = { Body: `
        aaa test.bucket [13/Feb/2023:15:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT test - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -
        aaa test.bucket [13/Feb/2023:15:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT test.js - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -
        aaa test.bucket [13/Feb/2023:16:08:56 +0000] 0.0.0.0 arn:aws:iam::111:user/user AAA REST.PUT.OBJECT code2 "PUT /test.bucket/code2?X-Amz-Security-Token=AAAAAAAAAAAAAAA=20230213T160856Z&X-Amz-AAAAAA HTTP/1.1" 200 - - 1 1 1 "https://s3.console.aws.amazon.com/s3/upload/test.bucket?region=us-east-2" "AAA/5.0 (AAA 1.1; AAA; AAA) AAA/1.1 (KHTML, like Gecko) AAA/1.1 AAA/1.1" - AAAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 QueryString s3.us-east-2.amazonaws.com TLSv1.2 - -
        aaa test.bucket [13/Feb/2023:15:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT test2 - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -
        aaa test.bucket [13/Feb/2023:15:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT testfile.js - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -
        aaa test.bucket [13/Feb/2023:15:25:00 +0000] 0.0.0.0 arn:aws:iam::111:user/user AAA REST.PUT.OBJECT empty "PUT /test.bucket/empty?X-Amz-Security-Token=AAAAAAAAAAAAAAA=20230213T152500Z&X-Amz-AAAAAA HTTP/1.1" 200 - - 1 1 1 "https://s3.console.aws.amazon.com/s3/upload/test.bucket?region=us-east-2" "AAA/5.0 (AAA 1.1; AAA; AAA) AAA/1.1 (KHTML, like Gecko) AAA/1.1 AAA/1.1" - AAAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 QueryString s3.us-east-2.amazonaws.com TLSv1.2 - -
        aaa test.bucket [13/Feb/2023:15:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT text.txt - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -
        ` };
        const action_dictionary = { 'test': 'delete', 'test.js': 'delete', 'code2': 'copy', 'test2': 'delete', 'testfile.js': 'delete', 'empty': 'copy', 'text.txt': 'delete' };
        log_parser.aws_parse_log_object(logs, example_log, true);
        // Make sure the test doesn't pass in case the parsing fails
        expect(logs.length).toEqual(Object.keys(action_dictionary).length);
        // Make sure all expected actions are mapped to the appropriate keys
        logs.forEach(item => {
            expect(item.action).toEqual(action_dictionary[item.key]);
        });
        // Test with sync_deletions set to false
        logs.length = 0;
        log_parser.aws_parse_log_object(logs, example_log, false);
        // Delete all action_dictionary keys whose value is delete
        Object.keys(action_dictionary).forEach(key => {
            if (action_dictionary[key] === 'delete') {
                delete action_dictionary[key];
            }
        });
        expect(logs.length).toEqual(Object.keys(action_dictionary).length);
    });

    it('Test AWS S3 server log parsing when a DELETE is logged before a PUT, but occurs after it', async () => {
        const logs = [];
        const example_log = { Body: `
        aaa test.bucket [13/Feb/2023:19:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT test - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -
        aaa test.bucket [13/Feb/2023:09:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT other_obj - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -
        aaa test.bucket [13/Feb/2023:09:08:56 +0000] 0.0.0.0 arn:aws:iam::111:user/user AAA REST.PUT.OBJECT test "PUT /test.bucket/test?X-Amz-Security-Token=AAAAAAAAAAAAAAA=20230213T160856Z&X-Amz-AAAAAA HTTP/1.1" 200 - - 1 1 1 "https://s3.console.aws.amazon.com/s3/upload/test.bucket?region=us-east-2" "AAA/5.0 (AAA 1.1; AAA; AAA) AAA/1.1 (KHTML, like Gecko) AAA/1.1 AAA/1.1" - AAAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 QueryString s3.us-east-2.amazonaws.com TLSv1.2 - -
        ` };
        log_parser.aws_parse_log_object(logs, example_log, true);
        const candidates = log_parser.create_candidates(logs);
        // DELETE log should be the latest log present inside the candidate, as candidate storing only latest log per key
        expect(candidates.test.action).toEqual('delete');
    });
});

describe('Azure blob log parsing tests', () => {
    // Pagination test
    it('Test Azure blob log parsing for Write and Delete actions', async () => {
        const logs = [];
        const example_log = {
            "tables": [{
                "rows": [
                    [new Date(1), 'Write', 'mt/folder1/nmt.txt'],
                    [new Date(2), 'Delete', 'Final Revision - including fixes (2) - FINAL.txt'],
                    [new Date(3), 'Write', 'noobaa_blocks/646bdc5e46ce2a0028749d7e/blocks_tree/other.blocks/_test_store_perf'],
                    [new Date(4), 'Delete', 'mt/folder1/nmt.txt'],
                    [new Date(5), 'Write', 'noobaa_blocks/646bdc5e46ce2a0028749d7e/blocks_tree/other.blocks/_test_store_perf']
                ]
            }]
        };
        const action_dictionary = { 'mt/folder1/nmt.txt': 'delete', 'Final Revision - including fixes (2) - FINAL.txt': 'delete', 'noobaa_blocks/646bdc5e46ce2a0028749d7e/blocks_tree/other.blocks/_test_store_perf': 'copy' };
        log_parser.azure_parse_log_object(logs, example_log, true);
        // Verify that test doesn't pass in case the parsing fails
        expect(logs.length).toBe(example_log.tables[0].rows.length);
        // Verify that create_candidates parses the logs correctly
        const candidates = log_parser.create_candidates(logs);
        expect(Object.keys(candidates).length).toBe(Object.keys(action_dictionary).length);
    });
});

describe('AWS S3 server logs parsing/processing tests', () => {
    let log_scanner;
    let response;
    beforeEach(() => {
        log_scanner = new LogReplicationScanner({
            name: "log_replication_scanner",
            client: rpc_client
        });
        response = [
            {
                key: "test",
                data: {
                    action: 'conflict',
                    time: '2023-02-13T19:08:28.000Z'
                },
                src_object_info: {
                    AcceptRanges: 'bytes',
                    LastModified: '2023-06-30T12:34:56.000Z',
                    ContentLength: 1024,
                    ETag: "\"abcdef1234567890\"",
                    ContentType: "text/plain",
                    Metadata: {
                      "custom-metadata-key": "custom-metadata-value"
                    }
                },
                dst_object_info: null
            },
            {
                key: "other_obj",
                data: {
                    action: 'delete',
                    time: '2023-02-13T09:08:28.000Z'
                },
                src_object_info: null,
                dst_object_info: {
                    "AcceptRanges": "bytes",
                    "LastModified": "2023-06-30T12:34:56.000Z",
                    "ContentLength": 1024,
                    "ETag": "\"abcdef1234567890\"",
                    "ContentType": "text/plain",
                    "Metadata": {
                      "custom-metadata-key": "custom-metadata-value"
                    }
                }
            },
            {
                key: "test.js",
                data: {
                    action: 'conflict',
                    time: '2023-02-13T15:08:28.000Z'
                },
                src_object_info: {
                    "AcceptRanges": "bytes",
                    "LastModified": "2023-06-30T12:34:56.000Z",
                    "ContentLength": 1024,
                    "ETag": "\"abcdef1234567890\"",
                    "ContentType": "text/plain",
                    "Metadata": {
                      "custom-metadata-key": "custom-metadata-value"
                    }
                },
                dst_object_info: null
            },
            {
                key: "code2",
                data: {
                    action: 'conflict',
                    time: '2023-02-13T16:08:56.000Z'
                },
                src_object_info: {
                    "AcceptRanges": "bytes",
                    "LastModified": "2023-06-30T12:34:56.000Z",
                    "ContentLength": 1024,
                    "ETag": "\"abcdef1234567890\"",
                    "ContentType": "text/plain",
                    "Metadata": {
                      "custom-metadata-key": "custom-metadata-value"
                    }
                },
                dst_object_info: null
            },
            {
                key: "test2",
                data: {
                    action: 'delete',
                    time: '2023-02-13T15:08:28.000Z'
                },
                src_object_info: null,
                dst_object_info: {
                    "AcceptRanges": "bytes",
                    "LastModified": "2023-06-30T12:34:56.000Z",
                    "ContentLength": 1024,
                    "ETag": "\"abcdef1234567890\"",
                    "ContentType": "text/plain",
                    "Metadata": {
                      "custom-metadata-key": "custom-metadata-value"
                    }
                }
            },
            {
                key: "testfile.js",
                data: {
                    action: 'delete',
                    time: '2023-02-13T15:08:28.000Z'
                },
                src_object_info: null,
                dst_object_info: {
                    "AcceptRanges": "bytes",
                    "LastModified": "2023-06-30T12:34:56.000Z",
                    "ContentLength": 1024,
                    "ETag": "\"abcdef1234567890\"",
                    "ContentType": "text/plain",
                    "Metadata": {
                      "custom-metadata-key": "custom-metadata-value"
                    }
                }
            },
            {
                key: "empty",
                data: {
                    action: 'copy',
                    time: '2023-02-13T15:25:00.000Z'
                },
                src_object_info: {
                    AcceptRanges: 'bytes',
                    LastModified: new Date('2021-06-30T12:34:56.000Z'),
                    ContentLength: 1024,
                    ETag: "\"abcdef1234567890\"",
                    ContentType: "text/plain",
                    Metadata: {
                      "custom-metadata-key": "custom-metadata-value"
                    }
                },
                dst_object_info: null
            },
            {
                key: "text.txt",
                data: {
                    action: 'delete',
                    time: '2023-02-13T15:08:28.000Z'
                },
                src_object_info: null,
                dst_object_info: {
                    "AcceptRanges": "bytes",
                    "LastModified": "2023-06-30T12:34:56.000Z",
                    "ContentLength": 1024,
                    "ETag": "\"abcdef1234567890\"",
                    "ContentType": "text/plain",
                    "Metadata": {
                      "custom-metadata-key": "custom-metadata-value"
                    }
                }
            }
        ];
    });
    it('Test AWS S3 server log parsing and processing', async () => {
        const logs = [];
        const src_bucket = "src-bucket";
        const dst_bucket = "dst-bucket";
        const example_log = {Body: `
            aaa test.bucket [13/Feb/2023:19:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT test - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -
            aaa test.bucket [13/Feb/2023:09:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT other_obj - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -
            aaa test.bucket [13/Feb/2023:19:08:28 +0000] 0.0.0.0 arn:aws:iam::111:user/user AAA REST.PUT.OBJECT test "PUT /test.bucket/code2?X-Amz-Security-Token=AAAAAAAAAAAAAAA=20230213T160856Z&X-Amz-AAAAAA HTTP/1.1" 200 - - 1 1 1 "https://s3.console.aws.amazon.com/s3/upload/test.bucket?region=us-east-2" "AAA/5.0 (AAA 1.1; AAA; AAA) AAA/1.1 (KHTML, like Gecko) AAA/1.1 AAA/1.1" - AAAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 QueryString s3.us-east-2.amazonaws.com TLSv1.2 - -
            aaa test.bucket [13/Feb/2023:15:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT test - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -
            aaa test.bucket [13/Feb/2023:15:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT test.js - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -
            aaa test.bucket [13/Feb/2023:16:08:56 +0000] 0.0.0.0 arn:aws:iam::111:user/user AAA REST.PUT.OBJECT code2 "PUT /test.bucket/code2?X-Amz-Security-Token=AAAAAAAAAAAAAAA=20230213T160856Z&X-Amz-AAAAAA HTTP/1.1" 200 - - 1 1 1 "https://s3.console.aws.amazon.com/s3/upload/test.bucket?region=us-east-2" "AAA/5.0 (AAA 1.1; AAA; AAA) AAA/1.1 (KHTML, like Gecko) AAA/1.1 AAA/1.1" - AAAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 QueryString s3.us-east-2.amazonaws.com TLSv1.2 - -
            aaa test.bucket [13/Feb/2023:15:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT test2 - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -
            aaa test.bucket [13/Feb/2023:15:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT testfile.js - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -
            aaa test.bucket [13/Feb/2023:15:25:00 +0000] 0.0.0.0 arn:aws:iam::111:user/user AAA REST.PUT.OBJECT empty "PUT /test.bucket/empty?X-Amz-Security-Token=AAAAAAAAAAAAAAA=20230213T152500Z&X-Amz-AAAAAA HTTP/1.1" 200 - - 1 1 1 "https://s3.console.aws.amazon.com/s3/upload/test.bucket?region=us-east-2" "AAA/5.0 (AAA 1.1; AAA; AAA) AAA/1.1 (KHTML, like Gecko) AAA/1.1 AAA/1.1" - AAAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 QueryString s3.us-east-2.amazonaws.com TLSv1.2 - -
            aaa test.bucket [13/Feb/2023:15:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT text.txt - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -
            aaa test.bucket [12/Feb/2023:09:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT test - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -            aaa test.bucket [13/Feb/2023:09:08:56 +0000] 0.0.0.0 arn:aws:iam::111:user/user AAA REST.PUT.OBJECT test "PUT /test.bucket/test?X-Amz-Security-Token=AAAAAAAAAAAAAAA=20230213T160856Z&X-Amz-AAAAAA HTTP/1.1" 200 - - 1 1 1 "https://s3.console.aws.amazon.com/s3/upload/test.bucket?region=us-east-2" "AAA/5.0 (AAA 1.1; AAA; AAA) AAA/1.1 (KHTML, like Gecko) AAA/1.1 AAA/1.1" - AAAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 QueryString s3.us-east-2.amazonaws.com TLSv1.2 - -
            aaa test.bucket [12/Feb/2023:15:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT test - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -
            aaa test.bucket [13/Feb/2023:15:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT test.js - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -
            aaa test.bucket [13/Feb/2023:16:08:56 +0000] 0.0.0.0 arn:aws:iam::111:user/user AAA REST.PUT.OBJECT code2 "PUT /test.bucket/code2?X-Amz-Security-Token=AAAAAAAAAAAAAAA=20230213T160856Z&X-Amz-AAAAAA HTTP/1.1" 200 - - 1 1 1 "https://s3.console.aws.amazon.com/s3/upload/test.bucket?region=us-east-2" "AAA/5.0 (AAA 1.1; AAA; AAA) AAA/1.1 (KHTML, like Gecko) AAA/1.1 AAA/1.1" - AAAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 QueryString s3.us-east-2.amazonaws.com TLSv1.2 - -            aaa test.bucket [13/Feb/2023:15:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT testfile.js - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -            aaa test.bucket [13/Feb/2023:15:08:28 +0000] 1.1.1.1 arn:aws:iam::111:user/user AAA BATCH.DELETE.OBJECT text.txt - 204 - - 1 - - - - - AAA SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader s3.us-east-2.amazonaws.com TLSv1.2 - -
        `};


        log_parser.aws_parse_log_object(logs, example_log, true);
        // Make sure the test doesn't pass in case the parsing fails
        expect(logs.length).toEqual(14);

        const candidates = log_parser.create_candidates(logs);

        // Make sure all expected action candidates are mapped to appropriate candidates action
        const action_candidates = {'test': 'conflict', 'other_obj': 'delete', 'test.js': 'conflict', 'code2': 'conflict', 'test2': 'delete', 'testfile.js': 'delete', 'empty': 'copy', 'text.txt': 'delete'};
        for (const key in candidates) {
            if (candidates[key][0]) {
                expect(candidates[key][0].action).toEqual(action_candidates[key]);
            }
        }

        // Mocking head_objects to return expected response
        jest.spyOn(log_scanner, 'head_objects').mockResolvedValue(response);

        // Mocking both copy_objects and delete_objects method as we are not copying or deleting actual object here
        log_scanner.copy_objects = mock_fn.mockReturnThis();
        log_scanner.delete_objects = mock_fn.mockReturnThis();

        // Make sure processing of all the candidates working as expected
        const { copy_keys, delete_keys } = await log_scanner.process_candidates(src_bucket, dst_bucket, candidates);

        expect(Object.keys(copy_keys).length).toEqual(4);
        expect(delete_keys.length).toEqual(4);
    });
});
