/* Copyright (C) 2023 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

const { BucketDiff } = require('../../../server/utils/bucket_diff.js');
const replication_utils = require('../../../server/utils/replication_utils');

// @ts-ignore
const mock_fn = jest.fn();
const mock_fn2 = jest.fn();

describe('fail on improper constructor call', () => {
    it('should fail when there is no connection and no s3_params', () => {
        const params = {
            first_bucket: 'first-bucket',
            second_bucket: 'second-bucket',
            version: true,
            for_replication: false,
            for_deletion: false,
        };
        expect(() => new BucketDiff(params)).toThrow('Expected s3_params');
    });
});

describe('BucketDiff', () => {
    describe('get_objects', () => {
        describe('get_objects with version', () => {
            let bucketDiff;
            let response;
            let expected;
            beforeEach(() => {
                const s3_params = {
                    accessKeyId: 'YOUR_ACCESS_KEY_ID',
                    secretAccessKey: 'YOUR_SECRET_ACCESS_KEY'
                };
                bucketDiff = new BucketDiff({
                    first_bucket: 'first-bucket',
                    second_bucket: 'second-bucket',
                    version: true,
                    s3_params: s3_params,
                    for_replication: false,
                    for_deletion: false,
                });
            });
            describe('multiple key names', () => {
                beforeEach(() => {
                    response = {
                        Versions: [
                            { ETag: 'etag1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: true, },
                            { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, },
                            { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                            { ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, },
                            { ETag: 'etag3', Size: 24599, Key: '3', VersionId: 'v3', IsLatest: true, },
                            { ETag: 'etag4', Size: 24599, Key: '4', VersionId: 'v4', IsLatest: true, },
                        ],
                        DeleteMarkers: [],
                    };
                    expected = {
                        "1": [
                            { ETag: 'etag1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: true, },
                            { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, },
                            { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                        ],
                        "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
                        "3": [{ ETag: 'etag3', Size: 24599, Key: '3', VersionId: 'v3', IsLatest: true, }],

                    };
                });
                it('list truncated - should return bucket contents minus last key and continuation token as the last returned key name', async () => {
                    response.IsTruncated = true;
                    response.NextContinuationToken = '3';
                    // Mocking the _list_objects method to return a response
                    bucketDiff._list_objects = mock_fn.mockResolvedValue(response);
                    const result = await bucketDiff.get_objects('bucket-name', '', 100, '');

                    expect(result.bucket_contents_left).toEqual(expected);
                    expect(result.bucket_cont_token).toEqual('3');
                });
                it('list is not truncated - should return bucket contents and continuation token', async () => {
                    response.IsTruncated = false;
                    response.NextContinuationToken = '';
                    // Mocking the _list_objects method to return a response
                    bucketDiff._list_objects = mock_fn.mockResolvedValue(response);
                    const result = await bucketDiff.get_objects('bucket-name', '', 100, '');

                    expected[4] = [{ ETag: 'etag4', Size: 24599, Key: '4', VersionId: 'v4', IsLatest: true, }];
                    expect(result.bucket_contents_left).toEqual(expected);
                    expect(result.bucket_cont_token).toEqual('');
                });
            });
            describe('single key name', () => {
                beforeEach(() => {
                    response = {
                        Versions: [
                            { ETag: 'etag1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: true, },
                            { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, },
                            { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                        ],
                        DeleteMarkers: [],
                    };
                    expected = {
                        "1": [
                            { ETag: 'etag1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: true, },
                            { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, },
                            { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                        ],
                    };
                });
                it('list truncated - should return bucket contents and continuation token', async () => {
                    response.IsTruncated = true;
                    response.NextContinuationToken = '1';
                    // Mocking the _list_objects method to return a response
                    bucketDiff._list_objects = mock_fn.mockResolvedValue(response);
                    const result = await bucketDiff.get_objects('bucket-name', '', 100, '');

                    expect(result.bucket_contents_left).toEqual(expected);
                    expect(result.bucket_cont_token).toEqual('1');
                });
                it('list is not truncated - should return bucket contents and continuation token', async () => {
                    response.IsTruncated = false;
                    response.NextContinuationToken = '';
                    // Mocking the _list_objects method to return a response
                    bucketDiff._list_objects = mock_fn.mockResolvedValue(response);
                    const result = await bucketDiff.get_objects('bucket-name', '', 100, '');

                    expect(result.bucket_contents_left).toEqual(expected);
                    expect(result.bucket_cont_token).toEqual('');
                });
            });
        });
        describe('get_objects with version for for_deletion enabled', () => {
            let bucketDiff;
            let response;
            let expected;
            beforeEach(() => {
                const s3_params = {
                    accessKeyId: 'YOUR_ACCESS_KEY_ID',
                    secretAccessKey: 'YOUR_SECRET_ACCESS_KEY'
                };
                bucketDiff = new BucketDiff({
                    first_bucket: 'first-bucket',
                    second_bucket: 'second-bucket',
                    version: true,
                    s3_params: s3_params,
                    for_replication: false,
                    for_deletion: true,
                });
            });
            describe('multiple key names', () => {
                beforeEach(() => {
                    response = {
                        Versions: [],
                        DeleteMarkers: [
                            { Key: '1', VersionId: 'v1.3', IsLatest: true, LastModified: '2022-02-29T10:45:00.000Z', },
                            { Key: '1', VersionId: 'v1.2', IsLatest: false, LastModified: '2022-02-28T10:45:00.000Z', },
                            { Key: '1', VersionId: 'v1.1', IsLatest: false, LastModified: '2022-02-27T10:45:00.000Z', },
                            { Key: '2', VersionId: 'v2', IsLatest: true, LastModified: '2022-02-27T10:45:00.000Z', },
                            { Key: '3', VersionId: 'v3', IsLatest: true, LastModified: '2022-02-27T10:45:00.000Z', },
                            { Key: '4', VersionId: 'v4', IsLatest: true, LastModified: '2022-02-27T10:45:00.000Z', },
                        ],
                    };
                    expected = {
                        "1": [
                            { Key: '1', VersionId: 'v1.3', IsLatest: true, LastModified: '2022-02-29T10:45:00.000Z', },
                            { Key: '1', VersionId: 'v1.2', IsLatest: false, LastModified: '2022-02-28T10:45:00.000Z', },
                            { Key: '1', VersionId: 'v1.1', IsLatest: false, LastModified: '2022-02-27T10:45:00.000Z', },
                        ],
                        "2": [{ Key: '2', VersionId: 'v2', IsLatest: true, LastModified: '2022-02-27T10:45:00.000Z', }],
                        "3": [{ Key: '3', VersionId: 'v3', IsLatest: true, LastModified: '2022-02-27T10:45:00.000Z', }],
                    };
                });
                it('list truncated - should return bucket contents minus last key and continuation token as the last returned key name', async () => {
                    response.IsTruncated = true;
                    response.NextContinuationToken = '3';
                    // Mocking the _list_objects method to return a response
                    bucketDiff._list_objects = mock_fn.mockResolvedValue(response);
                    const result = await bucketDiff.get_objects('bucket-name', '', 100, '');
                    expect(result.bucket_contents_left).toEqual(expected);
                    expect(result.bucket_cont_token).toEqual('3');
                });
                it('list is not truncated - should return bucket contents and continuation token', async () => {
                    response.IsTruncated = false;
                    response.NextContinuationToken = '';
                    // Mocking the _list_objects method to return a response
                    bucketDiff._list_objects = mock_fn.mockResolvedValue(response);
                    const result = await bucketDiff.get_objects('bucket-name', '', 100, '');

                    expected[4] = [{ Key: '4', VersionId: 'v4', IsLatest: true, LastModified: '2022-02-27T10:45:00.000Z', }];
                    expect(result.bucket_contents_left).toEqual(expected);
                    expect(result.bucket_cont_token).toEqual('');
                });
            });
            describe('single key name', () => {
                beforeEach(() => {
                    response = {
                        Versions: [],
                        DeleteMarkers: [
                            { Key: '1', VersionId: 'v1.3', IsLatest: true, LastModified: '2022-02-29T10:45:00.000Z', },
                            { Key: '1', VersionId: 'v1.2', IsLatest: false, LastModified: '2022-02-28T10:45:00.000Z', },
                            { Key: '1', VersionId: 'v1.1', IsLatest: false, LastModified: '2022-02-27T10:45:00.000Z', },
                        ],
                    };
                    expected = {
                        "1": [
                            { Key: '1', VersionId: 'v1.3', IsLatest: true, LastModified: '2022-02-29T10:45:00.000Z', },
                            { Key: '1', VersionId: 'v1.2', IsLatest: false, LastModified: '2022-02-28T10:45:00.000Z', },
                            { Key: '1', VersionId: 'v1.1', IsLatest: false, LastModified: '2022-02-27T10:45:00.000Z', },
                        ],
                    };
                });
                it('list truncated - should return bucket contents and continuation token', async () => {
                    response.IsTruncated = true;
                    response.NextContinuationToken = '1';
                    // Mocking the _list_objects method to return a response
                    bucketDiff._list_objects = mock_fn.mockResolvedValue(response);
                    const result = await bucketDiff.get_objects('bucket-name', '', 100, '');

                    expect(result.bucket_contents_left).toEqual(expected);
                    expect(result.bucket_cont_token).toEqual('1');
                });
                it('list is not truncated - should return bucket contents and continuation token', async () => {
                    response.IsTruncated = false;
                    response.NextContinuationToken = '';
                    // Mocking the _list_objects method to return a response
                    bucketDiff._list_objects = mock_fn.mockResolvedValue(response);
                    const result = await bucketDiff.get_objects('bucket-name', '', 100, '');

                    expect(result.bucket_contents_left).toEqual(expected);
                    expect(result.bucket_cont_token).toEqual('');
                });
            });
        });
        describe('get_objects without version', () => {
            let bucketDiff;
            let response;
            let expected;
            beforeEach(() => {
                const s3_params = {
                    accessKeyId: 'YOUR_ACCESS_KEY_ID',
                    secretAccessKey: 'YOUR_SECRET_ACCESS_KEY'
                };
                bucketDiff = new BucketDiff({
                    first_bucket: 'first-bucket',
                    second_bucket: 'second-bucket',
                    version: false,
                    s3_params: s3_params,
                    for_replication: false,
                    for_deletion: false,
                });
                response = {
                    Contents: [
                        { Key: 'key1', Size: 100 },
                        { Key: 'key2', Size: 200 }
                    ],
                };
                expected = {
                    key1: [{ Key: 'key1', Size: 100 }],
                    key2: [{ Key: 'key2', Size: 200 }]
                };
            });
            it('list truncated - should return bucket contents and continuation token', async () => {
                response.IsTruncated = true;
                response.NextContinuationToken = 'next-token';
                // Mocking the _list_objects method to return a response
                bucketDiff._list_objects = mock_fn.mockResolvedValue(response);
                const result = await bucketDiff.get_objects('bucket-name', '', 100, '');

                expect(result.bucket_contents_left).toEqual(expected);
                expect(result.bucket_cont_token).toEqual('next-token');
            });
            it('list is not truncated - should return bucket contents and continuation token', async () => {
                response.IsTruncated = false;
                response.NextContinuationToken = '';
                // Mocking the _list_objects method to return a response
                bucketDiff._list_objects = mock_fn.mockResolvedValue(response);
                const result = await bucketDiff.get_objects('bucket-name', '', 100, '');

                expect(result.bucket_contents_left).toEqual(expected);
                expect(result.bucket_cont_token).toEqual('');
            });
        });
    });

    describe('_process_keys_out_of_range', () => {
        let ans;
        let bucketDiff;
        beforeEach(() => {
            ans = {
                keys_diff_map: {},
                keep_listing_second_bucket: false,
            };
            const s3_params = {
                accessKeyId: 'YOUR_ACCESS_KEY_ID',
                secretAccessKey: 'YOUR_SECRET_ACCESS_KEY'
            };
            bucketDiff = new BucketDiff({
                first_bucket: 'first-bucket',
                second_bucket: 'second-bucket',
                version: false,
                s3_params: s3_params,
                for_replication: false,
                for_deletion: false,
            });
        });

        it('should update keys_diff_map , clean keys_contents_left and return true when second bucket list is empty', () => {

            ans.keys_contents_left = {
                "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
                "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
            };
            const second_bucket_keys = {};

            const stop_compare = bucketDiff._process_keys_out_of_range(ans, second_bucket_keys);

            expect(stop_compare).toBe(true);
            expect(ans.keys_diff_map).toEqual({
                "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
                "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
            });
            expect(ans.keys_contents_left).toEqual({});
        });

        it('should update keys_diff_map , clean keys_contents_left and return true when all keys in first bucket are lexicographic smaller', () => {
            ans.keys_contents_left = {
                "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
                "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
            };
            const second_bucket_keys = {
                "3": [{ ETag: "etag3", Key: "3", Size: 300 }],
                "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
            };

            const stop_compare = bucketDiff._process_keys_out_of_range(ans, second_bucket_keys);

            expect(stop_compare).toBe(true);
            expect(ans.keys_diff_map).toEqual({
                "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
                "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
            });
            expect(ans.keys_contents_left).toEqual({});
        });

        it('should retain ans and return false when keys in first bucket are not lexicographic smaller', () => {
            ans.keys_contents_left = {
                "3": [{ ETag: "etag3", Key: "3", Size: 300 }],
                "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
            };
            const second_bucket_keys = {
                "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
                "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
            };

            const stop_compare = bucketDiff._process_keys_out_of_range(ans, second_bucket_keys);

            expect(stop_compare).toBe(false);
            expect(ans.keys_diff_map).toEqual({});
            expect(ans.keys_contents_left).toEqual({
                "3": [{ ETag: "etag3", Key: "3", Size: 300 }],
                "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
            });
        });
    });

});


describe('_process_keys_in_range with version', () => {
    let ans;
    let s3_params;
    let bucketDiff;
    let second_bucket_cont_token;
    beforeEach(() => {
        s3_params = {
            accessKeyId: 'YOUR_ACCESS_KEY_ID',
            secretAccessKey: 'YOUR_SECRET_ACCESS_KEY'
        };

        bucketDiff = new BucketDiff({
            first_bucket: 'first-bucket',
            second_bucket: 'second-bucket',
            version: true,
            s3_params: s3_params,
            for_replication: false,
            for_deletion: false,
        });

        ans = {
            keys_diff_map: {},
            keep_listing_second_bucket: false,
        };
        second_bucket_cont_token = '';
        const metadata = {
            Metadata: {
                custom_key: "metadata",
            }
        };
        mock_fn2.mockRestore();
        replication_utils.get_object_md = mock_fn2.mockReturnValueOnce(metadata).mockReturnValueOnce(metadata);
    });

    it('case 3: should update keys_diff_map and keys_contents_left when etag appear only once in earlier version', async () => {
        ans.keys_contents_left = {
            "1": [
                { ETag: 'etag1.1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: true, },
                { ETag: 'etag1.2', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
            "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
        };
        const second_bucket_keys = {
            "1": [{ ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, }, ],
            "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
        };

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: {
                "1": [
                    { ETag: 'etag1.1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: true, },
                    { ETag: 'etag1.2', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, }
                ]
            },
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });

    it('case 3: should not update keys_diff_map when etag (not in pos 0) appear only once in the latest version', async () => {
        ans.keys_contents_left = {
            "1": [
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: true, },
                { ETag: 'etag1.2', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, },
                { ETag: 'etag1.1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: false, },
            ],
            "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
            "3": [{ ETag: 'etag3', Size: 24599, Key: '3', VersionId: 'v3', IsLatest: true, }],

        };
        const second_bucket_keys = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
            "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
            "3": [{ ETag: 'etag3', Size: 24599, Key: '3', VersionId: 'v3', IsLatest: true, }],
        };

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: {},
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });

    it('case 3: should update keys_diff_map when etag (not in pos 0) appear only once in the not in the latest version', async () => {
        ans.keys_contents_left = {
            "1": [
                { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: true, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                { ETag: 'etag1.2', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, },
                { ETag: 'etag1.1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: false, },
            ],
            "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
            "3": [{ ETag: 'etag3', Size: 24599, Key: '3', VersionId: 'v3', IsLatest: true, }],

        };
        const second_bucket_keys = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
            "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
            "3": [{ ETag: 'etag3', Size: 24599, Key: '3', VersionId: 'v3', IsLatest: true, }],
        };

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: {
                "1": [
                    { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: true, },
                ]
            },
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });

    it('case 3: should update keys_diff_map when non of the etag appear in the second bucket', async () => {
        ans.keys_contents_left = {
            "1": [
                { ETag: 'etag1.8', Size: 89317, Key: '1', VersionId: 'v1.8', IsLatest: true, },
                { ETag: 'etag1.7', Size: 89317, Key: '1', VersionId: 'v1.7', IsLatest: false, },
                { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: false, },
            ],
            "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
            "3": [{ ETag: 'etag3', Size: 24599, Key: '3', VersionId: 'v3', IsLatest: true, }],

        };
        const second_bucket_keys = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
            "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
            "3": [{ ETag: 'etag3', Size: 24599, Key: '3', VersionId: 'v3', IsLatest: true, }],
        };

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: {
                "1": [
                    { ETag: 'etag1.8', Size: 89317, Key: '1', VersionId: 'v1.8', IsLatest: true, },
                    { ETag: 'etag1.7', Size: 89317, Key: '1', VersionId: 'v1.7', IsLatest: false, },
                    { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: false, },
                ],
            },
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });

    it('case 3: multiple ETags, only consecutive, latest is latest in the first bucket', async () => {
        ans.keys_contents_left = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
            "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
            "3": [{ ETag: 'etag3', Size: 24599, Key: '3', VersionId: 'v3', IsLatest: true, }],

        };
        const second_bucket_keys = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
            "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
            "3": [{ ETag: 'etag3', Size: 24599, Key: '3', VersionId: 'v3', IsLatest: true, }],
        };

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: {},
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });

    it('case 3: multiple ETags, only consecutive, latest is not the latest in the first bucket', async () => {
        ans.keys_contents_left = {
            "1": [
                { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: true, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
            "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
            "3": [{ ETag: 'etag3', Size: 24599, Key: '3', VersionId: 'v3', IsLatest: true, }],

        };
        const second_bucket_keys = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
            "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
            "3": [{ ETag: 'etag3', Size: 24599, Key: '3', VersionId: 'v3', IsLatest: true, }],
        };

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: {
                "1": [
                    { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: true, }
                ],
            },
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });

    it('case 3: should update on process_non_consecutive_etags', async () => {
        ans.keys_contents_left = {
            "1": [
                { ETag: 'etag1.8', Size: 89317, Key: '1', VersionId: 'v1.8', IsLatest: true, },
                { ETag: 'etag1.7', Size: 89317, Key: '1', VersionId: 'v1.7', IsLatest: false, },
                { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: false, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
        };
        const second_bucket_keys = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: false, },
            ],
        };

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: {
                "1": [
                    { ETag: 'etag1.8', Size: 89317, Key: '1', VersionId: 'v1.8', IsLatest: true, },
                    { ETag: 'etag1.7', Size: 89317, Key: '1', VersionId: 'v1.7', IsLatest: false, },
                    { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: false, },
                ],
            },
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });

    it('case 3: should not update on process_non_consecutive_etags', async () => {
        ans.keys_contents_left = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
        };
        const second_bucket_keys = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: false, },
            ],
        };

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: {},
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });

    it('case 3: should update keys_diff_map and keys_contents_left when LastModified in the first bucket is newer', async () => {
        bucketDiff = new BucketDiff({
            first_bucket: 'first-bucket',
            second_bucket: 'second-bucket',
            version: true,
            s3_params: s3_params,
            for_replication: true,
            for_deletion: false,
        });

        ans.keys_contents_left = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', LastModified: '2023-06-25T10:49:16.000Z', IsLatest: true, },
            ],
        };

        const second_bucket_keys = {
            "1": [
                { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.5', LastModified: '2023-06-25T10:49:13.000Z', IsLatest: true, },
            ],
        };

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: {
                "1": [
                    { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', LastModified: '2023-06-25T10:49:16.000Z', IsLatest: true, },
                ],
            },
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });

    it('case 3: should update only keys_contents_left when LastModified in the second bucket is newer', async () => {
        bucketDiff = new BucketDiff({
            first_bucket: 'first-bucket',
            second_bucket: 'second-bucket',
            version: true,
            s3_params: s3_params,
            for_replication: true,
            for_deletion: false,
        });

        ans.keys_contents_left = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', LastModified: '2023-06-25T10:49:13.000Z', IsLatest: true, },
            ],
        };

        const second_bucket_keys = {
            "1": [
                { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.5', LastModified: '2023-06-25T10:49:16.000Z', IsLatest: true, },
            ],
        };

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: {},
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });

});

describe('_process_keys_in_range with version for for_deletion enabled', () => {
    let ans;
    let s3_params;
    let bucketDiff;
    let second_bucket_cont_token;
    beforeEach(() => {
        s3_params = {
            accessKeyId: 'YOUR_ACCESS_KEY_ID',
            secretAccessKey: 'YOUR_SECRET_ACCESS_KEY'
        };

        bucketDiff = new BucketDiff({
            first_bucket: 'first-bucket',
            second_bucket: 'second-bucket',
            version: true,
            s3_params: s3_params,
            for_replication: false,
            for_deletion: true,
        });

        ans = {
            keys_diff_map: {},
            keep_listing_second_bucket: false,
        };
        second_bucket_cont_token = '';
    });
    it('case 3: should update keys_diff_map when last modified in first bucket is latest', async () => {
        ans.keys_contents_left = {
            "1": [
                { Key: '1', VersionId: 'v1.3', IsLatest: true, LastModified: '2022-02-29T10:45:00.000Z', },
                { Key: '1', VersionId: 'v1.2', IsLatest: false, LastModified: '2022-02-28T10:45:00.000Z', },
                { Key: '1', VersionId: 'v1.1', IsLatest: false, LastModified: '2022-02-27T10:45:00.000Z', },
            ],
            "2": [{ Key: '2', VersionId: 'v2', IsLatest: true, LastModified: '2022-02-27T10:45:00.000Z', }],
            "3": [{ Key: '3', VersionId: 'v3', IsLatest: true, LastModified: '2022-02-27T10:45:00.000Z', }],
        };
        const second_bucket_keys = {
            "1": [
                { Key: '1', VersionId: 'v1.3', IsLatest: false, LastModified: '2022-02-28T10:45:00.000Z', },
                { Key: '1', VersionId: 'v1.2', IsLatest: false, LastModified: '2022-02-27T10:45:00.000Z', },
                { Key: '1', VersionId: 'v1.1', IsLatest: false, LastModified: '2022-02-26T10:45:00.000Z', },
            ],
            "2": [{ Key: '2', VersionId: 'v2', IsLatest: false, LastModified: '2022-02-27T10:45:00.000Z', }],
        };

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: {
                "1": [
                    { Key: '1', VersionId: 'v1.3', IsLatest: true, LastModified: '2022-02-29T10:45:00.000Z', },
                    { Key: '1', VersionId: 'v1.2', IsLatest: false, LastModified: '2022-02-28T10:45:00.000Z', },
                    { Key: '1', VersionId: 'v1.1', IsLatest: false, LastModified: '2022-02-27T10:45:00.000Z', },
                ],
                "2": [{ Key: '2', VersionId: 'v2', IsLatest: true, LastModified: '2022-02-27T10:45:00.000Z', }],
                "3": [{ Key: '3', VersionId: 'v3', IsLatest: true, LastModified: '2022-02-27T10:45:00.000Z', }],
            },
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });
    it('case 3: should not update keys_diff_map when last modified in first bucket is not latest', async () => {
        ans.keys_contents_left = {
            "1": [
                { Key: '1', VersionId: 'v1.3', IsLatest: false, LastModified: '2022-02-28T10:45:00.000Z', },
                { Key: '1', VersionId: 'v1.2', IsLatest: false, LastModified: '2022-02-27T10:45:00.000Z', },
                { Key: '1', VersionId: 'v1.1', IsLatest: false, LastModified: '2022-02-26T10:45:00.000Z', },
            ],
            "2": [{ Key: '2', VersionId: 'v2', IsLatest: false, LastModified: '2022-02-27T10:45:00.000Z', }],
        };
        const second_bucket_keys = {
            "1": [
                { Key: '1', VersionId: 'v1.3', IsLatest: true, LastModified: '2022-02-29T10:45:00.000Z', },
                { Key: '1', VersionId: 'v1.2', IsLatest: false, LastModified: '2022-02-28T10:45:00.000Z', },
                { Key: '1', VersionId: 'v1.1', IsLatest: false, LastModified: '2022-02-27T10:45:00.000Z', },
            ],
            "2": [{ Key: '2', VersionId: 'v2', IsLatest: true, LastModified: '2022-02-27T10:45:00.000Z', }],
        };

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        console.log("result: ", result);
        expect(result).toEqual({
            keys_diff_map: {},
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });
});

describe('_process_keys_in_range without version', () => {
    let ans;
    let bucketDiff;
    let s3_params;
    let second_bucket_cont_token;
    beforeEach(() => {
        s3_params = {
            accessKeyId: 'YOUR_ACCESS_KEY_ID',
            secretAccessKey: 'YOUR_SECRET_ACCESS_KEY'
        };

        bucketDiff = new BucketDiff({
            first_bucket: 'first-bucket',
            second_bucket: 'second-bucket',
            version: false,
            s3_params: s3_params,
            for_replication: false,
            for_deletion: false,
        });
        ans = {
            keys_diff_map: {},
            keep_listing_second_bucket: false,
        };
        second_bucket_cont_token = '';
    });

    it('case 1: should retain ans and return keep_listing_second_bucket true when second_bucket_cont_token exist', async () => {
        ans.keys_contents_left = {
            "3": [{ ETag: "etag3", Key: "3", Size: 300 }],
            "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
        };
        const second_bucket_keys = {
            "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
            "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
        };
        second_bucket_cont_token = 'second_bucket_cont_token';

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: {},
            keys_contents_left: {
                "3": [{ ETag: "etag3", Key: "3", Size: 300 }],
                "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
            },
            keep_listing_second_bucket: true,
        });
    });

    it('case 1: should replace keys_diff_map and keys_contents_left when second_bucket_cont_token does not exist', async () => {
        ans.keys_diff_map = { "a": [{ ETag: "etag_a", Key: "a", Size: 150 }] };
        ans.keys_contents_left = {
            "3": [{ ETag: "etag3", Key: "3", Size: 300 }],
            "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
        };
        const second_bucket_keys = {
            "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
            "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
        };

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: {
                "a": [{ ETag: "etag_a", Key: "a", Size: 150 }],
                "3": [{ ETag: "etag3", Key: "3", Size: 300 }],
                "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
            },
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });

    it('case 2: should replace keys_diff_map and keys_contents_left', async () => {
        ans.keys_contents_left = {
            "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
            "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
        };
        const second_bucket_keys = {
            "3": [{ ETag: "etag3", Key: "3", Size: 300 }],
            "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
        };

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: {
                "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
                "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
            },
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });

    it('case 3: should update keys_diff_map and keys_contents_left when the key is in the second bucket but with different etag in non version', async () => {
        ans.keys_contents_left = {
            "2": [{ ETag: "etag2", Key: "2", Size: 200 }],
        };
        const second_bucket_keys = {
            "2": [{ ETag: "etag_2", Key: "2", Size: 200 }],
            "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
        };

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: { "2": [{ ETag: "etag2", Key: "2", Size: 200 }] },
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });

    it('case 3: should update keys_diff_map and keys_contents_left when the key is not in the second bucket', async () => {
        ans.keys_contents_left = {
            "2": [{ ETag: "etag2", Key: "2", Size: 200 }],
            "3": [{ ETag: "etag3", Key: "3", Size: 300 }],
        };
        const second_bucket_keys = {
            "2": [{ ETag: "etag2", Key: "2", Size: 200 }],
            "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
        };

        replication_utils.get_object_md = mock_fn2.mockReturnValueOnce('metadata').mockReturnValueOnce('metadata');
        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: { "3": [{ ETag: "etag3", Key: "3", Size: 300 }] },
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });

    it('case 3: should update keys_diff_map and keys_contents_left when LastModified in the first bucket is newer', async () => {
        bucketDiff = new BucketDiff({
            first_bucket: 'first-bucket',
            second_bucket: 'second-bucket',
            version: false,
            s3_params: s3_params,
            for_replication: true,
            for_deletion: false,
        });

        ans.keys_contents_left = { "2": [{ ETag: "etag2", Key: "2", Size: 200, LastModified: '2023-06-25T10:49:16.000Z' }], };
        const second_bucket_keys = { "2": [{ ETag: "etag2.1", Key: "2", Size: 200, LastModified: '2023-06-25T10:49:13.000Z' }], };

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: { "2": [{ ETag: "etag2", Key: "2", Size: 200, LastModified: '2023-06-25T10:49:16.000Z' }] },
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });

    it('case 3: should update only keys_contents_left when LastModified in the second bucket is newer', async () => {
        bucketDiff = new BucketDiff({
            first_bucket: 'first-bucket',
            second_bucket: 'second-bucket',
            version: false,
            s3_params: s3_params,
            for_replication: true,
            for_deletion: false,
        });

        ans.keys_contents_left = { "2": [{ ETag: "etag2", Key: "2", Size: 200, LastModified: '2023-06-25T10:49:12.000Z' }], };
        const second_bucket_keys = { "2": [{ ETag: "etag2.1", Key: "2", Size: 200, LastModified: '2023-06-25T10:49:13.000Z' }], };

        const result = await bucketDiff._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        expect(result).toEqual({
            keys_diff_map: {},
            keys_contents_left: {},
            keep_listing_second_bucket: false,
        });
    });

});

describe('BucketDiff aiding functions', () => {
    describe('_object_grouped_by_key_and_omitted', () => {
        describe('_object_grouped_by_key_and_omitted with version', () => {
            let list;
            let expected;
            let bucketDiff;
            beforeEach(() => {
                const s3_params = {
                    accessKeyId: 'YOUR_ACCESS_KEY_ID',
                    secretAccessKey: 'YOUR_SECRET_ACCESS_KEY'
                };

                bucketDiff = new BucketDiff({
                    first_bucket: 'first-bucket',
                    second_bucket: 'second-bucket',
                    version: true,
                    s3_params: s3_params,
                    for_replication: false,
                    for_deletion: false,
                });
            });

            describe('multiple key names', () => {
                beforeEach(() => {
                    list = {
                        Versions: [
                            { ETag: 'etag1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: true, },
                            { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, },
                            { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                            { ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, },
                            { ETag: 'etag3', Size: 24599, Key: '3', VersionId: 'v3', IsLatest: true, },
                            { ETag: 'etag4', Size: 24599, Key: '4', VersionId: 'v4', IsLatest: true, },
                        ],
                        DeleteMarkers: [],
                    };
                    expected = {
                        "1": [
                            { ETag: 'etag1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: true, },
                            { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, },
                            { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                        ],
                        "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
                        "3": [{ ETag: 'etag3', Size: 24599, Key: '3', VersionId: 'v3', IsLatest: true, }],

                    };
                });
                it('list is not truncated with multiple key names, should return all keys grouped into array by key', async () => {
                    list.IsTruncated = false;
                    expected[4] = [{ ETag: 'etag4', Size: 24599, Key: '4', VersionId: 'v4', IsLatest: true, }];
                    const result = await bucketDiff._object_grouped_by_key_and_omitted(list);
                    expect(result).toEqual(expected);
                });
                it('list is truncated with multiple key names, should omit last key name', async () => {
                    list.IsTruncated = true;
                    const result = await bucketDiff._object_grouped_by_key_and_omitted(list);
                    expect(result).toEqual(expected);
                });
            });

            describe('single key name', () => {
                beforeEach(() => {
                    list = {
                        Versions: [
                            { ETag: 'etag1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: true, },
                            { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, },
                            { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                        ],
                        DeleteMarkers: [],
                    };
                    expected = {
                        "1": [
                            { ETag: 'etag1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: true, },
                            { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, },
                            { ETag: 'etag1', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                        ],
                    };
                });
                it('list is not truncated with single key name, should return all keys grouped into array by key', async () => {
                    list.IsTruncated = false;
                    const result = await bucketDiff._object_grouped_by_key_and_omitted(list);
                    expect(result).toEqual(expected);
                });
                it('list is truncated with single key name, should return all keys grouped into array by key', async () => {
                    list.IsTruncated = true;
                    const result = await bucketDiff._object_grouped_by_key_and_omitted(list);
                    expect(result).toEqual(expected);
                });
            });
        });

        describe('_object_grouped_by_key_and_omitted without version', () => {
            let list;
            let expected;
            let bucketDiff;
            beforeEach(() => {
                const s3_params = {
                    accessKeyId: 'YOUR_ACCESS_KEY_ID',
                    secretAccessKey: 'YOUR_SECRET_ACCESS_KEY'
                };
                bucketDiff = new BucketDiff({
                    first_bucket: 'first-bucket',
                    second_bucket: 'second-bucket',
                    version: false,
                    s3_params: s3_params,
                    for_replication: false,
                    for_deletion: false,
                });
                list = {
                    Contents: [
                        { Key: '1', ETag: 'etag1', Size: 100 },
                        { Key: '2', ETag: 'etag2', Size: 200 },
                    ],
                };
                expected = {
                    "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
                    "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
                };
            });
            it('list is not truncated, should return all keys grouped into array by key', async () => {
                list.IsTruncated = false;
                const result = await bucketDiff._object_grouped_by_key_and_omitted(list, false);
                expect(result).toEqual(expected);
            });
            it('list is truncated, should return all keys grouped into array by key', async () => {
                list.IsTruncated = true;
                const result = await bucketDiff._object_grouped_by_key_and_omitted(list);
                expect(result).toEqual(expected);
            });
        });
    });

    describe('_get_next_key_marker', () => {
        describe('_get_next_key_marker with version', () => {
            let bucketDiff;
            beforeEach(() => {
                const s3_params = {
                    accessKeyId: 'YOUR_ACCESS_KEY_ID',
                    secretAccessKey: 'YOUR_SECRET_ACCESS_KEY'
                };
                bucketDiff = new BucketDiff({
                    first_bucket: 'first-bucket',
                    second_bucket: 'second-bucket',
                    version: true,
                    s3_params: s3_params,
                    for_replication: false,
                    for_deletion: false,
                });
            });
            it('list is truncated, should return the last key as continuation token', async () => {
                const list_objects_response = { IsTruncated: true };
                const list = {
                    key1: [{ ETag: 'etag1', Size: 100 }],
                    key2: [{ ETag: 'etag2', Size: 200 }]
                };
                const result = await bucketDiff._get_next_key_marker(list_objects_response, list);
                expect(result).toEqual('key2');
            });
            it('list is not truncated, should return empty continuation token', async () => {
                const list_objects_response = { IsTruncated: false };
                const result = await bucketDiff._get_next_key_marker(list_objects_response, {});
                expect(result).toEqual('');
            });
        });
        describe('_get_next_key_marker without version', () => {
            let bucketDiff;
            beforeEach(() => {
                const s3_params = {
                    accessKeyId: 'YOUR_ACCESS_KEY_ID',
                    secretAccessKey: 'YOUR_SECRET_ACCESS_KEY'
                };
                bucketDiff = new BucketDiff({
                    first_bucket: 'first-bucket',
                    second_bucket: 'second-bucket',
                    version: false,
                    s3_params: s3_params,
                    for_replication: false,
                    for_deletion: false,
                });
            });
            it('should return continuation token', async () => {
                const list_objects_response = { NextContinuationToken: 'next-token' };
                const result = await bucketDiff._get_next_key_marker(list_objects_response, {});
                expect(result).toEqual('next-token');
            });
        });
    });

    describe('_get_etag_pos', () => {
        let bucketDiff;
        beforeEach(() => {
            const s3_params = {
                accessKeyId: 'YOUR_ACCESS_KEY_ID',
                secretAccessKey: 'YOUR_SECRET_ACCESS_KEY'
            };
            bucketDiff = new BucketDiff({
                first_bucket: 'first-bucket',
                second_bucket: 'second-bucket',
                version: false,
                s3_params: s3_params,
                for_replication: false,
                for_deletion: false,
            });
        });
        it('should return an array of indexes when ETag exists in second_obj', () => {
            const pos = 1;
            const first_obj = [{ ETag: 'etag1' }, { ETag: 'etag2' }, { ETag: 'etag3' }];
            const second_obj = [{ ETag: 'etag4' }, { ETag: 'etag2' }, { ETag: 'etag3' }, { ETag: 'etag2' }];

            const result = bucketDiff._get_etag_pos(pos, first_obj, second_obj);

            expect(result).toEqual([1, 3]);
        });

        it('should return an empty array when ETag does not exist in second_obj', () => {
            const pos = 2;
            const first_obj = [{ ETag: 'etag1' }, { ETag: 'etag2' }, { ETag: 'etag3' }];
            const second_obj = [{ ETag: 'etag4' }, { ETag: 'etag5' }, { ETag: 'etag6' }];

            const result = bucketDiff._get_etag_pos(pos, first_obj, second_obj);

            expect(result).toEqual([]);
        });

        it('should return an empty array when first_obj is empty', () => {
            const pos = 0;
            const first_obj = [];
            const second_obj = [{ ETag: 'etag1' }, { ETag: 'etag2' }, { ETag: 'etag3' }];

            const result = bucketDiff._get_etag_pos(pos, first_obj, second_obj);

            expect(result).toEqual([]);
        });

        it('should return an empty array when second_obj is empty', () => {
            const pos = 0;
            const first_obj = [{ ETag: 'etag1' }, { ETag: 'etag2' }, { ETag: 'etag3' }];
            const second_obj = [];

            const result = bucketDiff._get_etag_pos(pos, first_obj, second_obj);

            expect(result).toEqual([]);
        });
    });

    describe('_is_same_user_metadata', () => {
        let bucketDiff;
        const pos = 0;
        const cur_first_bucket_key = 'key';
        const first_bucket_curr_obj = {};
        const second_bucket_curr_obj = {};
        beforeEach(() => {
            const s3_params = {
                accessKeyId: 'YOUR_ACCESS_KEY_ID',
                secretAccessKey: 'YOUR_SECRET_ACCESS_KEY'
            };
            bucketDiff = new BucketDiff({
                first_bucket: 'first-bucket',
                second_bucket: 'second-bucket',
                version: false,
                s3_params: s3_params,
                for_replication: false,
                for_deletion: false,
            });

        });

        afterEach(() => {
            mock_fn2.mockRestore();
        });

        it('should return true when metadata is the same', async () => {
            const first_metadata = {
                Metadata: {
                    custom_key: "metadata",
                }
            };
            const second_metadata = {
                Metadata: {
                    custom_key: "metadata",
                }
            };
            mock_fn2.mockRestore();
            replication_utils.get_object_md = mock_fn2.mockReturnValueOnce(first_metadata).mockReturnValueOnce(second_metadata);
            const result = await bucketDiff._is_same_user_metadata(
                pos, cur_first_bucket_key, first_bucket_curr_obj, second_bucket_curr_obj);
            expect(result).toBe(true);
        });

        it('should return true when both metadata are undefined', async () => {
            const first_metadata = { Metadata: {} };
            const second_metadata = { Metadata: {} };
            replication_utils.get_object_md = mock_fn2.mockReturnValueOnce(first_metadata).mockReturnValueOnce(second_metadata);
            const result = await bucketDiff._is_same_user_metadata(
                pos, cur_first_bucket_key, first_bucket_curr_obj, second_bucket_curr_obj);
            expect(result).toBe(true);
        });

        it('should return false when only the first metadata is undefined', async () => {
            const first_metadata = { Metadata: {} };
            const second_metadata = {
                Metadata: {
                    custom_key: "metadata",
                }
            };
            replication_utils.get_object_md = mock_fn2.mockReturnValueOnce(first_metadata).mockReturnValueOnce(second_metadata);
            const result = await bucketDiff._is_same_user_metadata(
                pos, cur_first_bucket_key, first_bucket_curr_obj, second_bucket_curr_obj);
            expect(result).toBe(false);
        });

        it('should return false when only second metadata is undefined', async () => {
            const first_metadata = {
                Metadata: {
                    custom_key: "metadata",
                }
            };
            const second_metadata = { Metadata: {} };
            replication_utils.get_object_md = mock_fn2.mockReturnValueOnce(first_metadata).mockReturnValueOnce(second_metadata);
            const result = await bucketDiff._is_same_user_metadata(
                pos, cur_first_bucket_key, first_bucket_curr_obj, second_bucket_curr_obj);
            expect(result).toBe(false);
        });

        it('should return false when metadata objects have different values', async () => {
            const first_metadata = {
                Metadata: {
                    custom_key: "metadata",
                }
            };
            const second_metadata = {
                Metadata: {
                    custom_key: "metadata2",
                }
            };
            replication_utils.get_object_md = mock_fn2.mockReturnValueOnce(first_metadata).mockReturnValueOnce(second_metadata);
            const result = await bucketDiff._is_same_user_metadata(
                pos, cur_first_bucket_key, first_bucket_curr_obj, second_bucket_curr_obj);
            expect(result).toBe(false);
        });
    });

});

describe('BucketDiff get_keys_diff case 3 with version', () => {
    let bucketDiff;
    let second_bucket_cont_token;
    beforeEach(() => {
        const s3_params = {
            accessKeyId: 'YOUR_ACCESS_KEY_ID',
            secretAccessKey: 'YOUR_SECRET_ACCESS_KEY'
        };

        bucketDiff = new BucketDiff({
            first_bucket: 'first-bucket',
            second_bucket: 'second-bucket',
            version: true,
            s3_params: s3_params,
            for_replication: false,
            for_deletion: false,
        });
        second_bucket_cont_token = '';
        replication_utils.get_object_md = mock_fn2.mockReturnValueOnce('metadata').mockReturnValueOnce('metadata');
    });

    afterEach(() => {
        mock_fn2.mockRestore();
    });

    it('case 3: etag appear only once in earlier version', async () => {
        const first_bucket_keys = {
            "1": [
                { ETag: 'etag1.1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: true, },
                { ETag: 'etag1.2', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
            "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
        };
        const second_bucket_keys = {
            "1": [{ ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, }, ],
            "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
        };

        const result = await bucketDiff.get_keys_diff(first_bucket_keys, second_bucket_keys, second_bucket_cont_token);
        expect(result.keys_diff_map).toEqual({
            "1": [
                { ETag: 'etag1.1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: true, },
                { ETag: 'etag1.2', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, }
            ]
        });
        expect(result.keys_contents_left).toEqual({});
        expect(result.keep_listing_second_bucket).toEqual(false);
    });

    it('case 3: etag appear only once in earlier version but metadata is different', async () => {
        const first_bucket_keys = {
            "1": [
                { ETag: 'etag1.1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: true, },
                { ETag: 'etag1.2', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
            "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
        };
        const second_bucket_keys = {
            "1": [{ ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, }, ],
            "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }],
        };
        mock_fn2.mockRestore();
        const first_metadata = {
            Metadata: {
                custom_key: "metadata",
            }
        };
        const second_metadata = {
            Metadata: {
                custom_key: "metadata2",
            }
        };
        replication_utils.get_object_md = mock_fn2
            .mockReturnValueOnce(first_metadata)
            .mockReturnValueOnce(second_metadata)
            .mockReturnValueOnce(first_metadata)
            .mockReturnValueOnce(second_metadata);
        const result = await bucketDiff.get_keys_diff(first_bucket_keys, second_bucket_keys, second_bucket_cont_token);
        expect(result.keys_diff_map).toEqual({
            "1": [
                { ETag: 'etag1.1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: true, },
                { ETag: 'etag1.2', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, }
            ],
            "2": [{ ETag: 'etag2', Size: 24599, Key: '2', VersionId: 'v2', IsLatest: true, }]
        });
        expect(result.keys_contents_left).toEqual({});
        expect(result.keep_listing_second_bucket).toEqual(false);
    });

    it('case 3: etag (not in pos 0) appear only once in the latest version', async () => {
        const first_bucket_keys = {
            "1": [
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: true, },
                { ETag: 'etag1.2', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, },
                { ETag: 'etag1.1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: false, },
            ],
        };
        const second_bucket_keys = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
        };
        const result = await bucketDiff.get_keys_diff(first_bucket_keys, second_bucket_keys, second_bucket_cont_token);
        expect(result.keys_diff_map).toEqual({});
        expect(result.keys_contents_left).toEqual({});
        expect(result.keep_listing_second_bucket).toEqual(false);
    });

    it('case 3: etag (not in pos 0) appear only once in the not in the latest version', async () => {
        const first_bucket_keys = {
            "1": [
                { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: true, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                { ETag: 'etag1.2', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, },
                { ETag: 'etag1.1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: false, },
            ],
        };
        const second_bucket_keys = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
        };
        const result = await bucketDiff.get_keys_diff(first_bucket_keys, second_bucket_keys, second_bucket_cont_token);
        expect(result.keys_diff_map).toEqual({
            "1": [
                { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: true, },
            ]
        });
        expect(result.keys_contents_left).toEqual({});
        expect(result.keep_listing_second_bucket).toEqual(false);
    });

    it('case 3: non of the etag appear in the second bucket', async () => {
        const first_bucket_keys = {
            "1": [
                { ETag: 'etag1.8', Size: 89317, Key: '1', VersionId: 'v1.8', IsLatest: true, },
                { ETag: 'etag1.7', Size: 89317, Key: '1', VersionId: 'v1.7', IsLatest: false, },
                { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: false, },
            ],
        };
        const second_bucket_keys = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
        };
        const result = await bucketDiff.get_keys_diff(first_bucket_keys, second_bucket_keys, second_bucket_cont_token);
        expect(result.keys_diff_map).toEqual({
            "1": [
                { ETag: 'etag1.8', Size: 89317, Key: '1', VersionId: 'v1.8', IsLatest: true, },
                { ETag: 'etag1.7', Size: 89317, Key: '1', VersionId: 'v1.7', IsLatest: false, },
                { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: false, },
            ],
        });
        expect(result.keys_contents_left).toEqual({});
        expect(result.keep_listing_second_bucket).toEqual(false);
    });

    it('case 3: multiple ETags, only consecutive, latest is latest in the first bucket', async () => {
        const first_bucket_keys = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
        };
        const second_bucket_keys = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
        };
        const result = await bucketDiff.get_keys_diff(first_bucket_keys, second_bucket_keys, second_bucket_cont_token);
        expect(result.keys_diff_map).toEqual({});
        expect(result.keys_contents_left).toEqual({});
        expect(result.keep_listing_second_bucket).toEqual(false);
    });

    it('case 3: multiple ETags, only consecutive, latest is not the latest in the first bucket', async () => {
        const first_bucket_keys = {
            "1": [
                { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: true, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
        };
        const second_bucket_keys = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
        };
        const result = await bucketDiff.get_keys_diff(first_bucket_keys, second_bucket_keys, second_bucket_cont_token);
        expect(result.keys_diff_map).toEqual({
            "1": [
                { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: true, }
            ],
        });
        expect(result.keys_contents_left).toEqual({});
        expect(result.keep_listing_second_bucket).toEqual(false);
    });

    it('case 3: update on process_non_consecutive_etags', async () => {
        const first_bucket_keys = {
            "1": [
                { ETag: 'etag1.8', Size: 89317, Key: '1', VersionId: 'v1.8', IsLatest: true, },
                { ETag: 'etag1.7', Size: 89317, Key: '1', VersionId: 'v1.7', IsLatest: false, },
                { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: false, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
        };
        const second_bucket_keys = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: false, },
            ],
        };
        const result = await bucketDiff.get_keys_diff(first_bucket_keys, second_bucket_keys, second_bucket_cont_token);
        expect(result.keys_diff_map).toEqual({
            "1": [
                { ETag: 'etag1.8', Size: 89317, Key: '1', VersionId: 'v1.8', IsLatest: true, },
                { ETag: 'etag1.7', Size: 89317, Key: '1', VersionId: 'v1.7', IsLatest: false, },
                { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: false, },
            ],
        });
        expect(result.keys_contents_left).toEqual({});
        expect(result.keep_listing_second_bucket).toEqual(false);
    });

    it('case 3: do not update on process_non_consecutive_etags', async () => {
        const first_bucket_keys = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
            ],
        };
        const second_bucket_keys = {
            "1": [
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: true, },
                { ETag: 'etag1.4', Size: 24599, Key: '1', VersionId: 'v1.4', IsLatest: false, },
                { ETag: 'etag1.3', Size: 89317, Key: '1', VersionId: 'v1.3', IsLatest: false, },
                { ETag: 'etag1.5', Size: 89317, Key: '1', VersionId: 'v1.5', IsLatest: false, },
                { ETag: 'etag1.6', Size: 89317, Key: '1', VersionId: 'v1.6', IsLatest: false, },
            ],
        };
        const result = await bucketDiff.get_keys_diff(first_bucket_keys, second_bucket_keys, second_bucket_cont_token);
        expect(result.keys_diff_map).toEqual({});
        expect(result.keys_contents_left).toEqual({});
        expect(result.keep_listing_second_bucket).toEqual(false);
    });

});

describe('BucketDiff get_keys_diff', () => {
    let bucketDiff;
    let second_bucket_cont_token;
    beforeEach(() => {
        const s3_params = {
            accessKeyId: 'YOUR_ACCESS_KEY_ID',
            secretAccessKey: 'YOUR_SECRET_ACCESS_KEY'
        };

        bucketDiff = new BucketDiff({
            first_bucket: 'first-bucket',
            second_bucket: 'second-bucket',
            version: false,
            s3_params: s3_params,
            for_replication: false,
            for_deletion: false,
        });
        second_bucket_cont_token = '';
        replication_utils.get_object_md = mock_fn2.mockReturnValueOnce('metadata').mockReturnValueOnce('metadata');
    });

    describe('get_keys_diff _process_keys_out_of_range flow', () => {
        it('second bucket list is empty', async () => {
            const first_bucket_keys = {
                "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
                "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
            };
            const second_bucket_keys = {};
            const result = await bucketDiff.get_keys_diff(first_bucket_keys, second_bucket_keys, second_bucket_cont_token);
            expect(result.keys_diff_map).toEqual({
                "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
                "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
            });
            expect(result.keys_contents_left).toEqual({});
            expect(result.keep_listing_second_bucket).toEqual(false);
        });

        it('all keys in first bucket are lexicographic smaller', async () => {
            const first_bucket_keys = {
                "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
                "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
            };
            const second_bucket_keys = {
                "3": [{ ETag: "etag3", Key: "3", Size: 300 }],
                "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
            };
            const result = await bucketDiff.get_keys_diff(first_bucket_keys, second_bucket_keys, second_bucket_cont_token);
            expect(result.keys_diff_map).toEqual({
                "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
                "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
            });
            expect(result.keys_contents_left).toEqual({});
            expect(result.keep_listing_second_bucket).toEqual(false);
        });
    });

    describe('get_keys_diff _process_keys_in_range flow', () => {
        it('case 1: second_bucket_cont_token exist', async () => {
            const first_bucket_keys = {
                "3": [{ ETag: "etag3", Key: "3", Size: 300 }],
                "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
            };
            const second_bucket_keys = {
                "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
                "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
            };
            second_bucket_cont_token = 'second_bucket_cont_token';
            const result = await bucketDiff.get_keys_diff(first_bucket_keys, second_bucket_keys, second_bucket_cont_token);
            expect(result.keys_diff_map).toEqual({});
            expect(result.keys_contents_left).toEqual({
                "3": [{ ETag: "etag3", Key: "3", Size: 300 }],
                "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
            });
            expect(result.keep_listing_second_bucket).toEqual(true);
        });

        it('case 1: second_bucket_cont_token does not exist', async () => {
            const first_bucket_keys = {
                "3": [{ ETag: "etag3", Key: "3", Size: 300 }],
                "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
            };
            const second_bucket_keys = {
                "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
                "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
            };
            const result = await bucketDiff.get_keys_diff(first_bucket_keys, second_bucket_keys, second_bucket_cont_token);
            expect(result.keys_diff_map).toEqual({
                "3": [{ ETag: "etag3", Key: "3", Size: 300 }],
                "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
            });
            expect(result.keys_contents_left).toEqual({});
            expect(result.keep_listing_second_bucket).toEqual(false);
        });

        it('case 2: replace keys_diff_map and keys_contents_left', async () => {
            const first_bucket_keys = {
                "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
                "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
            };
            const second_bucket_keys = {
                "3": [{ ETag: "etag3", Key: "3", Size: 300 }],
                "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
            };
            const result = await bucketDiff.get_keys_diff(first_bucket_keys, second_bucket_keys, second_bucket_cont_token);
            expect(result.keys_diff_map).toEqual({
                "1": [{ ETag: "etag1", Key: "1", Size: 100 }],
                "2": [{ ETag: "etag2", Key: "2", Size: 200 }]
            });
            expect(result.keys_contents_left).toEqual({});
            expect(result.keep_listing_second_bucket).toEqual(false);
        });

        it('case 3: the key is in the second bucket but with different etag', async () => {
            const first_bucket_keys = {
                "2": [{ ETag: "etag2", Key: "2", Size: 200 }],
            };
            const second_bucket_keys = {
                "2": [{ ETag: "etag_2", Key: "2", Size: 200 }],
                "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
            };
            const result = await bucketDiff.get_keys_diff(first_bucket_keys, second_bucket_keys, second_bucket_cont_token);
            expect(result.keys_diff_map).toEqual({ "2": [{ ETag: "etag2", Key: "2", Size: 200 }] });
            expect(result.keys_contents_left).toEqual({});
            expect(result.keep_listing_second_bucket).toEqual(false);
        });
        it('case 3: when the key is not in the second bucket', async () => {
            const first_bucket_keys = {
                "2": [{ ETag: "etag2", Key: "2", Size: 200 }],
                "3": [{ ETag: "etag3", Key: "3", Size: 300 }],
            };
            const second_bucket_keys = {
                "2": [{ ETag: "etag2", Key: "2", Size: 200 }],
                "4": [{ ETag: "etag4", Key: "4", Size: 400 }]
            };
            const result = await bucketDiff.get_keys_diff(first_bucket_keys, second_bucket_keys, second_bucket_cont_token);
            expect(result.keys_diff_map).toEqual({ "3": [{ ETag: "etag3", Key: "3", Size: 300 }] });
            expect(result.keys_contents_left).toEqual({});
            expect(result.keep_listing_second_bucket).toEqual(false);
        });
    });
});

describe('BucketDiff get_buckets_diff', () => {
    let params;
    let bucketDiff;
    beforeEach(() => {
        const s3_params = {
            accessKeyId: 'YOUR_ACCESS_KEY_ID',
            secretAccessKey: 'YOUR_SECRET_ACCESS_KEY'
        };

        bucketDiff = new BucketDiff({
            first_bucket: 'first-bucket',
            second_bucket: 'second-bucket',
            version: false,
            s3_params: s3_params,
            for_replication: true,
            for_deletion: false,
        });

        params = {
            prefix: '',
            max_keys: 100,
            version: false,
            current_first_bucket_cont_token: '',
            current_second_bucket_cont_token: '',
        };
        replication_utils.get_object_md = mock_fn2.mockReturnValueOnce('metadata').mockReturnValueOnce('metadata');

    });


    it('update first_bucket_cont_token', async () => {
        // Mocking the _list_objects method to return an empty response
        bucketDiff._list_objects = mock_fn.mockResolvedValue({ NextContinuationToken: 'next-token' });
        const result = await bucketDiff.get_buckets_diff(params);

        expect(result.keys_diff_map).toEqual({});
        expect(result.first_bucket_cont_token).toEqual('next-token');
        expect(result.second_bucket_cont_token).toEqual('');
    });

    it('return when first bucket list is empty', async () => {
        // Mocking the _list_objects method to return an empty response
        bucketDiff._list_objects = mock_fn.mockResolvedValue({});
        const result = await bucketDiff.get_buckets_diff(params);

        expect(result.keys_diff_map).toEqual({});
        expect(result.first_bucket_cont_token).toEqual('');
        expect(result.second_bucket_cont_token).toEqual('');
    });

    it('keep listing second bucket on continuation token', async () => {
        // Mocking the _list_objects for the first bucket call
        mock_fn.mockResolvedValueOnce({
            Contents: [
                { Key: 'key3', Size: 300 },
                { Key: 'key4', Size: 400 }
            ],
            IsTruncated: false,
            NextContinuationToken: '',
        });

        // Mocking the _list_objects for the first response of the second  bucket call
        mock_fn.mockResolvedValueOnce({
                Contents: [
                    { Key: 'key1', Size: 100 },
                    { Key: 'key2', Size: 200 }
                ],
                IsTruncated: true,
                NextContinuationToken: 'next-token'
            })
            // Mocking the _list_objects for the second response of the second  bucket call
            .mockResolvedValueOnce({
                Contents: [
                    { Key: 'key3', Size: 300 }
                ],
                IsTruncated: false,
                NextContinuationToken: '',
            });

        bucketDiff._list_objects = mock_fn;
        const result = await bucketDiff.get_buckets_diff(params);

        expect(result.keys_diff_map).toEqual({ key4: [{ Key: 'key4', Size: 400 }] });
        expect(result.first_bucket_cont_token).toEqual('');
        expect(result.second_bucket_cont_token).toEqual('');
    });

    it('do not iterate when there is no continuation token in the second bucket', async () => {
        // Mocking the _list_objects for the first bucket call
        mock_fn.mockResolvedValueOnce({
            Contents: [
                { Key: 'key3', Size: 300 },
                { Key: 'key4', Size: 400 }
            ],
            IsTruncated: false,
            NextContinuationToken: 'first_token',
        });

        // Mocking the _list_objects for the first response of the second  bucket call
        mock_fn.mockResolvedValueOnce({
                Contents: [
                    { Key: 'key1', Size: 100 },
                    { Key: 'key2', Size: 200 }
                ],
                IsTruncated: true,
                NextContinuationToken: ''
            })
            // should never get here: Mocking the _list_objects for the second response of the second  bucket call
            .mockResolvedValueOnce({
                Contents: [
                    { Key: 'key3', Size: 300 }
                ],
                IsTruncated: false,
                NextContinuationToken: '',
            });

        bucketDiff._list_objects = mock_fn;
        const result = await bucketDiff.get_buckets_diff(params);

        expect(result.keys_diff_map).toEqual({
            key3: [{ Key: 'key3', Size: 300 }],
            key4: [{ Key: 'key4', Size: 400 }]
        });
        expect(result.first_bucket_cont_token).toEqual('first_token');
        expect(result.second_bucket_cont_token).toEqual('');
    });

    it('no diff should be found', async () => {
        // Mocking the _list_objects for the first bucket call
        mock_fn.mockResolvedValueOnce({
            Contents: [
                { Key: 'key3', Size: 300 },
                { Key: 'key4', Size: 400 }
            ],
            IsTruncated: false,
            NextContinuationToken: '',
        });

        // Mocking the _list_objects for the first response of the second bucket call
        mock_fn.mockResolvedValueOnce({
            Contents: [
                { Key: 'key1', Size: 100 },
                { Key: 'key2', Size: 200 }
            ],
            IsTruncated: false,
            NextContinuationToken: 'next-token'
        });

        //this is not needed actually as the jest call will iterate on the to results above
        // We are adding this for better visibility/readability 
        mock_fn.mockResolvedValueOnce({
            Contents: [
                { Key: 'key3', Size: 300 },
                { Key: 'key4', Size: 400 }
            ],
            IsTruncated: false,
            NextContinuationToken: '',
        });

        bucketDiff._list_objects = mock_fn;
        replication_utils.get_object_md = mock_fn2
            .mockResolvedValueOnce('metadata_key3')
            .mockResolvedValueOnce('metadata_key3')
            .mockResolvedValueOnce('metadata_key4')
            .mockResolvedValueOnce('metadata_key4');

        const result = await bucketDiff.get_buckets_diff(params);

        expect(result.keys_diff_map).toEqual({});
        expect(result.first_bucket_cont_token).toEqual('');
        expect(result.second_bucket_cont_token).toEqual('');
    });

});
