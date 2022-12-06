/* Copyright (C) 2022 NooBaa */
"use strict";

const S3_CEPH_TEST_STEMS = [
    's3tests.functional.test_headers.',
    's3tests.functional.test_s3.',
    's3tests.fuzz.test.test_fuzzer.',
    's3tests.functional.test_s3_website.',
    's3tests.tests.test_realistic.',
    's3tests_boto3.functional.test_headers.',
    's3tests_boto3.functional.test_s3select.',
    's3tests_boto3.functional.test_s3.',
    's3tests_boto3.fuzz.test.test_fuzzer.',
    's3tests_boto3.functional.test_s3_website.',
    's3tests_boto3.tests.test_realistic.',
];

const S3_CEPH_TEST_SIGV4 = [
    'check_can_test_multiregion',
    'test_bucket_create_bad_amz_date_after_today_aws4',
    'test_bucket_create_bad_amz_date_before_epoch_aws4',
    'test_bucket_create_bad_amz_date_before_today_aws4',
    'test_bucket_create_bad_amz_date_empty_aws4',
    'test_bucket_create_bad_amz_date_invalid_aws4',
    'test_bucket_create_bad_amz_date_none_aws4',
    'test_bucket_create_bad_amz_date_unreadable_aws4',
    'test_bucket_create_bad_authorization_invalid_aws4',
    'test_bucket_create_bad_date_after_today_aws4',
    'test_bucket_create_bad_date_before_epoch_aws4',
    'test_bucket_create_bad_date_before_today_aws4',
    'test_bucket_create_bad_date_empty_aws4',
    'test_bucket_create_bad_date_invalid_aws4',
    'test_bucket_create_bad_date_none_aws4',
    'test_bucket_create_bad_date_unreadable_aws4',
    'test_bucket_create_bad_ua_empty_aws4',
    'test_bucket_create_bad_ua_none_aws4',
    'test_bucket_create_bad_ua_unreadable_aws4',
    'test_object_create_bad_amz_date_after_end_aws4',
    'test_object_create_bad_amz_date_after_today_aws4',
    'test_object_create_bad_amz_date_before_epoch_aws4',
    'test_object_create_bad_amz_date_before_today_aws4',
    'test_object_create_bad_amz_date_empty_aws4',
    'test_object_create_bad_amz_date_invalid_aws4',
    'test_object_create_bad_amz_date_none_aws4',
    'test_object_create_bad_amz_date_unreadable_aws4',
    'test_object_create_bad_authorization_incorrect_aws4',
    'test_object_create_bad_authorization_invalid_aws4',
    'test_object_create_bad_contentlength_mismatch_below_aws4',
    'test_object_create_bad_date_after_end_aws4',
    'test_object_create_bad_date_after_today_aws4',
    'test_object_create_bad_date_before_epoch_aws4',
    'test_object_create_bad_date_before_today_aws4',
    'test_object_create_bad_date_empty_aws4',
    'test_object_create_bad_date_invalid_aws4',
    'test_object_create_bad_date_none_aws4',
    'test_object_create_bad_date_unreadable_aws4',
    'test_object_create_bad_md5_invalid_garbage_aws4',
    'test_object_create_bad_ua_empty_aws4',
    'test_object_create_bad_ua_none_aws4',
    'test_object_create_bad_ua_unreadable_aws4',
    'test_object_create_missing_signed_custom_header_aws4',
    'test_object_create_missing_signed_header_aws4',
    'test_object_raw_get_x_amz_expires_not_expired',
    'test_object_raw_get_x_amz_expires_out_max_range',
    'test_object_raw_get_x_amz_expires_out_positive_range',
    'test_object_raw_get_x_amz_expires_out_range_zero',
    'test_region_bucket_create_master_access_remove_secondary',
    'test_region_bucket_create_secondary_access_remove_master',
    'test_region_copy_object',
    'test_sse_kms_barb_transfer_13b',
    'test_sse_kms_barb_transfer_1b',
    'test_sse_kms_barb_transfer_1kb',
    'test_sse_kms_barb_transfer_1MB'
];

const CEPH_TEST = {
    test_dir: 'src/test/system_tests/ceph_s3_tests/',
    s3_test_dir: 's3-tests/',
    ceph_config: 'test_ceph_s3_config.conf',
    new_account_params: {
        name: 'cephalt',
        email: 'ceph.alt@noobaa.com',
        has_login: false,
        s3_access: true,
    },
    new_account_params_tenant: {
        name: 'cephtenant',
        email: 'ceph.tenant@noobaa.com',
        has_login: false,
        s3_access: true,
    },
};

const DEFAULT_NUMBER_OF_WORKERS = 5; //5 was the number of workers in the previous CI/CD process


exports.S3_CEPH_TEST_STEMS = S3_CEPH_TEST_STEMS;
exports.S3_CEPH_TEST_SIGV4 = S3_CEPH_TEST_SIGV4;
exports.CEPH_TEST = CEPH_TEST;
exports.DEFAULT_NUMBER_OF_WORKERS = DEFAULT_NUMBER_OF_WORKERS;
