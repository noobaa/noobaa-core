/* Copyright (C) 2016 NooBaa */
"use strict";


const fs = require('fs');
const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);
if (argv.log_file) {
    dbg.set_log_to_file(argv.log_file);
}
dbg.set_process_name('test_ceph_s3');

const _ = require('lodash');
const P = require('../../util/promise');
const os_utils = require('../../util/os_utils');

require('../../util/dotenv').load();

const {
    pass = 'DeMo1',
        protocol = 'ws',
        mgmt_ip = 'localhost',
        mgmt_port = '8080',
        s3_ip = 'localhost',
        s3_acc_key = 123,
        s3_sec_key = 'abc',
} = argv;

let {
    email = 'demo@noobaa.com',
        system_name = 'demo',
} = argv;

const api = require('../../api');
const rpc = api.new_rpc();

const client = rpc.new_client({
    address: `${protocol}://${mgmt_ip}:${mgmt_port}`
});

// if (process.platform !== 'darwin') {
//     email = 'admin@noobaa.io';
//     system_name = 'noobaa';
// }

const auth_params = { email, password: `${pass}`, system: `${system_name}` };

const CEPH_TEST = {
    test_dir: 'src/test/system_tests/',
    s3_test_dir: 's3-tests/',
    ceph_config: 'ceph_s3_config.conf',
    ceph_deploy: 'ceph_s3_tests_deploy.sh',
    pool: 'test-pool',
    new_account_params: {
        name: 'cephalt',
        email: 'ceph.alt@noobaa.com',
        //password: 'ceph',
        has_login: false,
        s3_access: true,
    },
    new_account_params_tenant: {
        name: 'cephtenant',
        email: 'ceph.tenant@noobaa.com',
        //password: 'ceph',
        has_login: false,
        s3_access: true,
    }
};

let stats = {
    pass: [],
    fail: [],
    skip: [],
    total: 0
};

let tests_list;

//Regexp match will be tested per each entry
const S3_CEPH_TEST_BLACKLIST = [
    's3tests.functional.test_s3.test_100_continue',
    's3tests.functional.test_headers.test_object_create_date_and_amz_date',
    's3tests.functional.test_headers.test_object_create_amz_date_and_no_date',
    's3tests.functional.test_headers.test_object_create_bad_authorization_empty',
    's3tests.functional.test_headers.test_object_create_bad_contentlength_none',
    's3tests.functional.test_headers.test_object_create_bad_contentlength_mismatch_below_aws2',
    's3tests.functional.test_s3.test_versioning_obj_read_not_exist_null',
    's3tests.functional.test_s3.test_append_normal_object',
    's3tests.functional.test_s3.test_append_object',
    's3tests.functional.test_s3.test_append_object_position_wrong',
    's3tests.functional.test_s3.test_logging_toggle',
    's3tests.functional.test_s3.test_encryption_sse_c_multipart_invalid_chunks_2',
    's3tests.functional.test_s3.test_bucket_policy_different_tenant',
    's3tests.functional.test_s3.test_bucket_policy_set_condition_operator_end_with_IfExists',
    's3tests.functional.test_s3.test_bucket_policy_put_obj_enc',
    's3tests.functional.test_s3.test_bucket_policy_put_obj_request_obj_tag',
    's3tests.functional.test_s3_website.check_can_test_website',
    's3tests.functional.test_s3_website.test_website_nonexistant_bucket_s3',
    's3tests.functional.test_s3_website.test_website_nonexistant_bucket_rgw',
    's3tests.functional.test_s3_website.test_website_public_bucket_list_public_index',
    's3tests.functional.test_s3_website.test_website_private_bucket_list_public_index',
    's3tests.functional.test_s3_website.test_website_public_bucket_list_empty',
    's3tests.functional.test_s3_website.test_website_private_bucket_list_empty',
    's3tests.functional.test_s3_website.test_website_private_bucket_list_private_index',
    's3tests.functional.test_s3_website.test_website_private_bucket_list_empty_missingerrordoc',
    's3tests.functional.test_s3_website.test_website_public_bucket_list_private_index',
    's3tests.functional.test_s3_website.test_website_public_bucket_list_private_index_missingerrordoc',
    's3tests.functional.test_s3_website.test_website_private_bucket_list_private_index_missingerrordoc',
    's3tests.functional.test_s3_website.test_website_public_bucket_list_empty_missingerrordoc',
    's3tests.functional.test_s3_website.test_website_private_bucket_list_empty_blockederrordoc',
    's3tests.functional.test_s3_website.test_website_public_bucket_list_empty_blockederrordoc',
    's3tests.functional.test_s3_website.test_website_public_bucket_list_private_index_blockederrordoc',
    's3tests.functional.test_s3_website.test_website_private_bucket_list_private_index_blockederrordoc',
    's3tests.functional.test_s3_website.test_website_private_bucket_list_empty_gooderrordoc',
    's3tests.functional.test_s3_website.test_website_public_bucket_list_empty_gooderrordoc',
    's3tests.functional.test_s3_website.test_website_public_bucket_list_private_index_gooderrordoc',
    's3tests.functional.test_s3_website.test_website_private_bucket_list_private_index_gooderrordoc',
    's3tests.functional.test_s3_website.test_website_bucket_private_redirectall_base',
    's3tests.functional.test_s3_website.test_website_bucket_private_redirectall_path',
    's3tests.functional.test_s3_website.test_website_bucket_private_redirectall_path_upgrade',
    's3tests.functional.test_s3_website.test_website_xredirect_nonwebsite',
    's3tests.functional.test_s3_website.test_website_xredirect_private_relative',
    's3tests.functional.test_s3_website.test_website_xredirect_public_abs',
    's3tests.functional.test_s3_website.test_website_xredirect_public_relative',
    's3tests.functional.test_s3_website',
    's3tests.fuzz.test.test_fuzzer.test_load_graph',
    // website
    's3tests.functional.test_s3_website.test_website_xredirect_private_abs',
    // realistic
    'test_realistic.TestFileValidator.test_new_file_is_valid_on_several_calls',
    'test_realistic.TestFileValidator.test_new_file_is_valid_when_size_is_1',
    'test_realistic.TestFileValidator.test_new_file_is_valid',
    'test_realistic.TestFiles.test_random_file_valid',
    // boto3
    's3tests_boto3.functional.test_headers.test_object_create_bad_contentlength_none',
    's3tests_boto3.functional.test_headers.test_object_create_bad_contentlength_mismatch_above',
    's3tests_boto3.functional.test_headers.test_object_create_bad_authorization_empty',
    's3tests_boto3.functional.test_headers.test_object_create_date_and_amz_date',
    's3tests_boto3.functional.test_headers.test_object_create_amz_date_and_no_date',
    's3tests_boto3.functional.test_headers.test_object_create_bad_authorization_none',
    's3tests_boto3.functional.test_headers.test_bucket_put_bad_canned_acl',
    's3tests_boto3.functional.test_headers.test_bucket_create_bad_expect_mismatch',
    's3tests_boto3.functional.test_headers.test_bucket_create_bad_authorization_none',
    's3tests_boto3.functional.test_headers.test_bucket_create_bad_authorization_empty',
    's3tests_boto3.functional.test_headers.test_object_create_bad_contentlength_mismatch_below_aws2',
    's3tests_boto3.functional.test_headers.test_object_create_bad_authorization_incorrect_aws2',
    's3tests_boto3.functional.test_headers.test_object_create_bad_authorization_invalid_aws2',
    's3tests_boto3.functional.test_headers.test_object_create_bad_date_invalid_aws2',
    's3tests_boto3.functional.test_headers.test_object_create_bad_date_empty_aws2',
    's3tests_boto3.functional.test_headers.test_object_create_bad_date_none_aws2',
    's3tests_boto3.functional.test_headers.test_object_create_bad_date_before_epoch_aws2',
    's3tests_boto3.functional.test_headers.test_bucket_create_bad_authorization_invalid_aws2',
    's3tests_boto3.functional.test_headers.test_bucket_create_bad_date_invalid_aws2',
    's3tests_boto3.functional.test_headers.test_bucket_create_bad_date_none_aws2',
    's3tests_boto3.functional.test_headers.test_bucket_create_bad_date_empty_aws2',
    's3tests_boto3.functional.test_headers.test_bucket_create_bad_date_before_epoch_aws2',
    's3tests_boto3.functional.test_s3.test_bucket_listv2_delimiter_prefix',
    's3tests_boto3.functional.test_s3.test_bucket_listv2_delimiter_prefix_underscore',
    's3tests_boto3.functional.test_s3.test_bucket_list_delimiter_unreadable',
    's3tests_boto3.functional.test_s3.test_bucket_listv2_delimiter_unreadable',
    's3tests_boto3.functional.test_s3.test_bucket_listv2_fetchowner_empty',
    's3tests.functional.test_s3.test_encryption_sse_c_multipart_invalid_chunks_1',
    's3tests_boto3.functional.test_s3.test_bucket_list_prefix_unreadable',
    's3tests_boto3.functional.test_s3.test_bucket_listv2_prefix_unreadable',
    's3tests_boto3.functional.test_s3.test_bucket_listv2_prefix_delimiter_delimiter_not_exist',
    's3tests_boto3.functional.test_s3.test_bucket_listv2_maxkeys_zero',
    's3tests_boto3.functional.test_s3.test_bucket_list_unordered',
    's3tests_boto3.functional.test_s3.test_bucket_listv2_unordered',
    's3tests_boto3.functional.test_s3.test_bucket_listv2_continuationtoken',
    's3tests_boto3.functional.test_s3.test_bucket_listv2_startafter_unreadable',
    's3tests_boto3.functional.test_s3.test_bucket_list_return_data_versioning',
    's3tests_boto3.functional.test_s3.test_bucket_list_objects_anonymous',
    's3tests_boto3.functional.test_s3.test_bucket_listv2_objects_anonymous',
    's3tests_boto3.functional.test_s3.test_object_write_cache_control',
    's3tests_boto3.functional.test_s3.test_object_write_expires',
    's3tests_boto3.functional.test_s3.test_multi_objectv2_delete',
    's3tests_boto3.functional.test_s3.test_object_set_get_unicode_metadata',
    's3tests_boto3.functional.test_s3.test_object_set_get_metadata_empty_to_unreadable_prefix',
    's3tests_boto3.functional.test_s3.test_object_set_get_non_utf8_metadata',
    's3tests_boto3.functional.test_s3.test_object_set_get_metadata_empty_to_unreadable_suffix',
    's3tests_boto3.functional.test_s3.test_object_set_get_metadata_empty_to_unreadable_infix',
    's3tests_boto3.functional.test_s3.test_object_set_get_metadata_overwrite_to_unreadable_prefix',
    's3tests_boto3.functional.test_s3.test_object_set_get_metadata_overwrite_to_unreadable_suffix',
    's3tests_boto3.functional.test_s3.test_object_set_get_metadata_overwrite_to_unreadable_infix',
    's3tests_boto3.functional.test_s3.test_post_object_anonymous_request',
    's3tests_boto3.functional.test_s3.test_post_object_authenticated_request',
    's3tests_boto3.functional.test_s3.test_post_object_authenticated_no_content_type',
    's3tests_boto3.functional.test_s3.test_post_object_set_success_code',
    's3tests_boto3.functional.test_s3.test_post_object_set_invalid_success_code',
    's3tests_boto3.functional.test_s3.test_post_object_upload_larger_than_chunk',
    's3tests_boto3.functional.test_s3.test_post_object_set_key_from_filename',
    's3tests_boto3.functional.test_s3.test_post_object_case_insensitive_condition_fields',
    's3tests_boto3.functional.test_s3.test_post_object_ignored_header',
    's3tests_boto3.functional.test_s3.test_post_object_escaped_field_values',
    's3tests_boto3.functional.test_s3.test_post_object_success_redirect_action',
    's3tests_boto3.functional.test_s3.test_post_object_invalid_date_format',
    's3tests_boto3.functional.test_s3.test_post_object_no_key_specified',
    's3tests_boto3.functional.test_s3.test_post_object_missing_signature',
    's3tests_boto3.functional.test_s3.test_post_object_user_specified_header',
    's3tests_boto3.functional.test_s3.test_post_object_condition_is_case_sensitive',
    's3tests_boto3.functional.test_s3.test_post_object_expires_is_case_sensitive',
    's3tests_boto3.functional.test_s3.test_post_object_missing_expires_condition',
    's3tests_boto3.functional.test_s3.test_post_object_missing_conditions_list',
    's3tests_boto3.functional.test_s3.test_post_object_upload_size_limit_exceeded',
    's3tests_boto3.functional.test_s3.test_post_object_missing_content_length_argument',
    's3tests_boto3.functional.test_s3.test_post_object_invalid_content_length_argument',
    's3tests_boto3.functional.test_s3.test_post_object_upload_size_below_minimum',
    's3tests_boto3.functional.test_s3.test_post_object_empty_conditions',
    's3tests_boto3.functional.test_s3.test_put_object_ifmatch_nonexisted_failed',
    's3tests_boto3.functional.test_s3.test_object_raw_get_bucket_gone',
    's3tests_boto3.functional.test_s3.test_object_raw_get',
    's3tests_boto3.functional.test_s3.test_object_delete_key_bucket_gone',
    's3tests_boto3.functional.test_s3.test_object_raw_get_object_gone',
    's3tests_boto3.functional.test_s3.test_bucket_head_extended',
    's3tests_boto3.functional.test_s3.test_object_raw_get_bucket_acl',
    's3tests_boto3.functional.test_s3.test_object_raw_response_headers',
    's3tests_boto3.functional.test_s3.test_object_raw_authenticated_bucket_acl',
    's3tests_boto3.functional.test_s3.test_object_raw_get_x_amz_expires_out_range_zero',
    's3tests_boto3.functional.test_s3.test_object_raw_get_x_amz_expires_out_positive_range',
    's3tests_boto3.functional.test_s3.test_object_raw_get_x_amz_expires_out_max_range',
    's3tests_boto3.functional.test_s3.test_object_anon_put_write_access',
    's3tests_boto3.functional.test_s3.test_object_raw_put_authenticated_expired',
    's3tests_boto3.functional.test_s3.test_bucket_create_naming_bad_short_empty',
    's3tests_boto3.functional.test_s3.test_bucket_create_naming_good_long_250',
    's3tests_boto3.functional.test_s3.test_bucket_create_naming_good_long_251',
    's3tests_boto3.functional.test_s3.test_bucket_create_naming_good_long_252',
    's3tests_boto3.functional.test_s3.test_bucket_create_naming_good_long_253',
    's3tests_boto3.functional.test_s3.test_bucket_create_naming_good_long_254',
    's3tests_boto3.functional.test_s3.test_bucket_create_naming_good_long_255',
    's3tests_boto3.functional.test_s3.test_bucket_list_long_name',
    's3tests_boto3.functional.test_s3.test_bucket_create_naming_dns_underscore',
    's3tests_boto3.functional.test_s3.test_bucket_create_naming_dns_long',
    's3tests_boto3.functional.test_s3.test_bucket_create_naming_dns_dash_at_end',
    's3tests_boto3.functional.test_s3.test_bucket_create_naming_dns_dot_dot',
    's3tests_boto3.functional.test_s3.test_bucket_create_naming_dns_dot_dash',
    's3tests_boto3.functional.test_s3.test_bucket_create_naming_dns_dash_dot',
    's3tests_boto3.functional.test_s3.test_bucket_acl_default',
    's3tests_boto3.functional.test_s3.test_bucket_acl_canned_during_create',
    's3tests_boto3.functional.test_s3.test_bucket_acl_canned',
    's3tests_boto3.functional.test_s3.test_bucket_acl_canned_publicreadwrite',
    's3tests_boto3.functional.test_s3.test_bucket_acl_canned_authenticatedread',
    's3tests_boto3.functional.test_s3.test_object_acl_default',
    's3tests_boto3.functional.test_s3.test_object_acl_canned_during_create',
    's3tests_boto3.functional.test_s3.test_object_acl_canned_publicreadwrite',
    's3tests_boto3.functional.test_s3.test_object_acl_canned_bucketownerread',
    's3tests_boto3.functional.test_s3.test_object_acl_canned_authenticatedread',
    's3tests_boto3.functional.test_s3.test_object_acl_canned_bucketownerfullcontrol',
    's3tests_boto3.functional.test_s3.test_object_acl_full_control_verify_owner',
    's3tests_boto3.functional.test_s3.test_object_acl',
    's3tests_boto3.functional.test_s3.test_object_acl_write',
    's3tests_boto3.functional.test_s3.test_object_acl_writeacp',
    's3tests_boto3.functional.test_s3.test_object_acl_read',
    's3tests_boto3.functional.test_s3.test_object_acl_readacp',
    's3tests_boto3.functional.test_s3.test_bucket_acl_grant_userid_fullcontrol',
    's3tests_boto3.functional.test_s3.test_bucket_acl_grant_userid_read',
    's3tests_boto3.functional.test_s3.test_bucket_acl_grant_userid_readacp',
    's3tests_boto3.functional.test_s3.test_bucket_acl_grant_userid_write',
    's3tests_boto3.functional.test_s3.test_bucket_acl_grant_userid_writeacp',
    's3tests_boto3.functional.test_s3.test_bucket_acl_grant_nonexist_user',
    's3tests_boto3.functional.test_s3.test_bucket_acl_no_grants',
    's3tests_boto3.functional.test_s3.test_bucket_header_acl_grants',
    's3tests_boto3.functional.test_s3.test_object_header_acl_grants',
    's3tests_boto3.functional.test_s3.test_bucket_acl_grant_email',
    's3tests_boto3.functional.test_s3.test_bucket_acl_grant_email_notexist',
    's3tests_boto3.functional.test_s3.test_bucket_acl_revoke_all',
    's3tests_boto3.functional.test_s3.test_logging_toggle',
    's3tests_boto3.functional.test_s3.test_access_bucket_private_object_private',
    's3tests_boto3.functional.test_s3.test_access_bucket_private_objectv2_private',
    's3tests_boto3.functional.test_s3.test_access_bucket_private_object_publicread',
    's3tests_boto3.functional.test_s3.test_object_acl_canned',
    's3tests_boto3.functional.test_s3.test_access_bucket_private_objectv2_publicread',
    's3tests_boto3.functional.test_s3.test_access_bucket_private_object_publicreadwrite',
    's3tests_boto3.functional.test_s3.test_access_bucket_private_objectv2_publicreadwrite',
    's3tests_boto3.functional.test_s3.test_access_bucket_publicread_object_private',
    's3tests_boto3.functional.test_s3.test_access_bucket_publicread_object_publicread',
    's3tests_boto3.functional.test_s3.test_access_bucket_publicread_object_publicreadwrite',
    's3tests_boto3.functional.test_s3.test_access_bucket_publicreadwrite_object_private',
    's3tests_boto3.functional.test_s3.test_access_bucket_publicreadwrite_object_publicread',
    's3tests_boto3.functional.test_s3.test_list_buckets_anonymous',
    's3tests_boto3.functional.test_s3.test_access_bucket_publicreadwrite_object_publicreadwrite',
    's3tests_boto3.functional.test_s3.test_list_buckets_invalid_auth',
    's3tests_boto3.functional.test_s3.test_list_buckets_bad_auth',
    's3tests_boto3.functional.test_s3.test_bucket_recreate_not_overriding',
    's3tests_boto3.functional.test_s3.test_object_copy_to_itself',
    's3tests_boto3.functional.test_s3.test_object_copy_not_owned_bucket',
    's3tests_boto3.functional.test_s3.test_object_copy_not_owned_object_bucket',
    //'s3tests_boto3.functional.test_s3.test_multipart_upload_empty',
    's3tests_boto3.functional.test_s3.test_multipart_copy_invalid_range',
    's3tests_boto3.functional.test_s3.test_multipart_upload',
    's3tests_boto3.functional.test_s3.test_multipart_upload_size_too_small',
    's3tests_boto3.functional.test_s3.test_abort_multipart_upload',
    's3tests_boto3.functional.test_s3.test_multipart_copy_improper_range',
    's3tests_boto3.functional.test_s3.test_100_continue',
    's3tests_boto3.functional.test_s3.test_set_cors',
    's3tests_boto3.functional.test_s3.test_cors_origin_wildcard',
    's3tests_boto3.functional.test_s3.test_cors_origin_response',
    's3tests_boto3.functional.test_s3.test_cors_header_option',
    's3tests_boto3.functional.test_s3.test_set_tagging',
    's3tests_boto3.functional.test_s3.test_multipart_resend_first_finishes_last',
    's3tests_boto3.functional.test_s3.test_versioned_object_acl',
    's3tests_boto3.functional.test_s3.test_versioned_object_acl_no_version_specified',
    's3tests_boto3.functional.test_s3.test_lifecycle_get',
    's3tests_boto3.functional.test_s3.test_lifecycle_id_too_long',
    's3tests_boto3.functional.test_s3.test_lifecycle_same_id',
    's3tests_boto3.functional.test_s3.test_lifecycle_invalid_status',
    's3tests_boto3.functional.test_s3.test_lifecycle_set_invalid_date',
    's3tests_boto3.functional.test_s3.test_lifecycle_expiration_date',
    's3tests_boto3.functional.test_s3.test_lifecycle_expiration_days0',
    's3tests_boto3.functional.test_s3.test_lifecycle_set_noncurrent',
    's3tests_boto3.functional.test_s3.test_lifecycle_noncur_expiration',
    's3tests_boto3.functional.test_s3.test_lifecycle_set_deletemarker',
    's3tests_boto3.functional.test_s3.test_lifecycle_set_filter',
    's3tests_boto3.functional.test_s3.test_lifecycle_deletemarker_expiration',
    's3tests_boto3.functional.test_s3.test_lifecycle_set_empty_filter',
    's3tests_boto3.functional.test_s3.test_lifecyclev2_expiration',
    's3tests_boto3.functional.test_s3.test_lifecycle_set_multipart',
    's3tests_boto3.functional.test_s3.test_encryption_sse_c_multipart_upload',
    's3tests_boto3.functional.test_s3.test_encryption_sse_c_post_object_authenticated_request',
    's3tests_boto3.functional.test_s3.test_lifecycle_multipart_expiration',
    's3tests_boto3.functional.test_s3.test_encryption_sse_c_multipart_bad_download',
    's3tests_boto3.functional.test_s3.test_sse_kms_multipart_upload',
    's3tests_boto3.functional.test_s3.test_sse_kms_post_object_authenticated_request',
    's3tests_boto3.functional.test_s3.test_bucket_policy_acl',
    's3tests_boto3.functional.test_s3.test_bucketv2_policy_acl',
    's3tests_boto3.functional.test_s3.test_bucket_policy_different_tenant',
    's3tests_boto3.functional.test_s3.test_encryption_sse_c_multipart_invalid_chunks_1',
    's3tests_boto3.functional.test_s3.test_bucketv2_policy_different_tenant',
    's3tests_boto3.functional.test_s3.test_bucket_policy_set_condition_operator_end_with_IfExists',
    's3tests_boto3.functional.test_s3.test_post_object_tags_anonymous_request',
    's3tests_boto3.functional.test_s3.test_post_object_tags_authenticated_request',
    's3tests_boto3.functional.test_s3.test_put_obj_with_tags',
    's3tests_boto3.functional.test_s3.test_get_tags_acl_public',
    's3tests_boto3.functional.test_s3.test_delete_tags_obj_public',
    's3tests_boto3.functional.test_s3.test_put_tags_acl_public',
    's3tests_boto3.functional.test_s3.test_bucket_policy_get_obj_tagging_existing_tag',
    's3tests_boto3.functional.test_s3.test_bucket_policy_get_obj_existing_tag',
    's3tests_boto3.functional.test_s3.test_bucket_policy_put_obj_tagging_existing_tag',
    's3tests_boto3.functional.test_s3.test_bucket_policy_put_obj_copy_source',
    's3tests_boto3.functional.test_s3.test_bucket_policy_put_obj_copy_source_meta',
    's3tests_boto3.functional.test_s3.test_bucket_policy_put_obj_acl',
    's3tests_boto3.functional.test_s3.test_bucket_policy_put_obj_enc',
    's3tests_boto3.functional.test_s3.test_bucket_policy_put_obj_grant',
    's3tests_boto3.functional.test_s3.test_bucket_policy_put_obj_request_obj_tag',
    's3tests_boto3.functional.test_s3.test_object_lock_put_obj_lock',
    's3tests_boto3.functional.test_s3.test_object_lock_put_obj_lock_invalid_bucket',
    's3tests_boto3.functional.test_s3.test_bucket_policy_get_obj_acl_existing_tag',
    's3tests_boto3.functional.test_s3.test_object_lock_put_obj_lock_with_days_and_years',
    's3tests_boto3.functional.test_s3.test_object_lock_put_obj_lock_invalid_days',
    's3tests_boto3.functional.test_s3.test_object_lock_put_obj_lock_invalid_years',
    's3tests_boto3.functional.test_s3.test_object_lock_put_obj_lock_invalid_status',
    's3tests_boto3.functional.test_s3.test_object_lock_suspend_versioning',
    's3tests_boto3.functional.test_s3.test_object_lock_get_obj_lock',
    's3tests_boto3.functional.test_s3.test_object_lock_get_obj_lock_invalid_bucket',
    's3tests_boto3.functional.test_s3.test_object_lock_put_obj_retention',
    's3tests_boto3.functional.test_s3.test_object_lock_put_obj_retention_invalid_bucket',
    's3tests_boto3.functional.test_s3.test_object_lock_put_obj_retention_invalid_mode',
    's3tests_boto3.functional.test_s3.test_object_lock_get_obj_retention',
    's3tests_boto3.functional.test_s3.test_object_lock_get_obj_retention_invalid_bucket',
    's3tests_boto3.functional.test_s3.test_object_lock_put_obj_retention_versionid',
    's3tests_boto3.functional.test_s3.test_object_lock_put_obj_retention_override_default_retention',
    's3tests_boto3.functional.test_s3.test_object_lock_put_obj_retention_increase_period',
    's3tests_boto3.functional.test_s3.test_object_lock_put_obj_retention_shorten_period',
    's3tests_boto3.functional.test_s3.test_object_lock_put_obj_retention_shorten_period_bypass',
    's3tests_boto3.functional.test_s3.test_object_lock_delete_object_with_retention',
    's3tests_boto3.functional.test_s3.test_object_lock_put_legal_hold_invalid_bucket',
    's3tests_boto3.functional.test_s3.test_object_lock_put_legal_hold_invalid_status',
    's3tests_boto3.functional.test_s3.test_object_lock_get_legal_hold_invalid_bucket',
    's3tests_boto3.functional.test_s3.test_object_lock_delete_object_with_legal_hold_on',
    's3tests_boto3.functional.test_s3.test_object_lock_delete_object_with_legal_hold_off',
    's3tests_boto3.functional.test_s3.test_object_lock_get_obj_metadata',
    's3tests_boto3.functional.test_s3.test_object_lock_uploading_obj',
    's3tests_boto3.fuzz.test.test_fuzzer.test_load_graph',
    // realistic
    'test_realistic.TestFileValidator.test_new_file_is_valid',
    'test_realistic.TestFileValidator.test_new_file_is_valid_on_several_calls',
    'test_realistic.TestFileValidator.test_new_file_is_valid_when_size_is_1',
    'test_realistic.TestFiles.test_random_file_valid',
    's3tests.functional.test_headers.test_object_create_bad_contentlength_mismatch_above',
];

const S3_CEPH_TEST_BLACKLIST_REGEXP = new RegExp(`(${S3_CEPH_TEST_BLACKLIST.join(')|(')})`);
const S3_CEPH_TEST_STEMS = [
    's3tests.functional.test_headers.',
    's3tests.functional.test_s3.',
    's3tests.fuzz.test.test_fuzzer.',
    's3tests.functional.test_s3_website.',
    's3tests.tests.test_realistic.',
    's3tests_boto3.functional.test_headers.',
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

const S3_CEPH_TEST_STEMS_REGEXP = new RegExp(`(${S3_CEPH_TEST_STEMS.join(')|(')})`);

/*// s3tests.tests.test_realistic:TestFileValidator.test_new_file_is_valid
//Some tests have to be different and have a different path
const S3_CEPH_TEST_STEMS_2 = [
    's3tests.tests.test_realistic.',
];
const S3_CEPH_TEST_STEMS_2_REGEXP = new RegExp(`(${S3_CEPH_TEST_STEMS_2.join(')|(')})`);*/


module.exports = {
    run_test: run_test
};

async function ceph_test_setup() {
    console.info(`Updating ${CEPH_TEST.ceph_config} with host = ${s3_ip}...`);
    // update config with the s3 endpoint
    const conf_file = `${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`;
    const conf_file_content = (await fs.promises.readFile(conf_file)).toString();
    const new_conf_file_content = conf_file_content.replace(/host = localhost/g, `host = ${s3_ip}`);
    await fs.promises.writeFile(conf_file, new_conf_file_content);
    console.log('conf file updated');

    //await test_utils.create_hosts_pool(client, CEPH_TEST.pool, 3);
    let system = await client.system.read_system();
    const internal_pool = system.pools.filter(p => p.resource_type === 'INTERNAL');
    await client.account.create_account({
        ...CEPH_TEST.new_account_params,
        default_resource: internal_pool.name
    });

    await client.account.create_account({
        ...CEPH_TEST.new_account_params_tenant,
        default_resource: internal_pool.name
    });
    system = await client.system.read_system();
    const ceph_account = system.accounts.find(account =>
        account.email.unwrap() === CEPH_TEST.new_account_params.email
    );

    const ceph_account_tenant = system.accounts.find(account =>
        account.email.unwrap() === CEPH_TEST.new_account_params_tenant.email
    );

    console.info('CEPH TEST CONFIGURATION:', JSON.stringify(CEPH_TEST));
    const { access_key, secret_key } = ceph_account.access_keys[0];
    await os_utils.exec(`echo access_key = ${access_key.unwrap()} >> ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
    await os_utils.exec(`echo secret_key = ${secret_key.unwrap()} >> ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);

    const { access_key: access_key_tenant, secret_key: secret_key_tenant } = ceph_account_tenant.access_keys[0];
    if (process.platform === 'darwin') {
        await os_utils.exec(`sed -i "" "s|tenant_access_key|${access_key_tenant.unwrap()}|g" ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i "" "s|tenant_secret_key|${secret_key_tenant.unwrap()}|g" ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);

    } else {
        await os_utils.exec(`sed -i -e 's:tenant_access_key:${access_key_tenant.unwrap()}:g' ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i -e 's:tenant_secret_key:${secret_key_tenant.unwrap()}:g' ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i -e 's:s3_access_key:${s3_acc_key}:g' ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i -e 's:s3_secret_key:${s3_sec_key}:g' ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
    }
}

// async function deploy_ceph() {
//     console.info('Starting Deployment Of Ceph Tests...');
//     let command = `cd ${CEPH_TEST.test_dir};./${CEPH_TEST.ceph_deploy} ${os.platform() === 'darwin' ? 'mac' : ''} > /tmp/ceph_deploy.log`;
//     try {
//         let res = await os_utils.exec(command, {
//             ignore_rc: false,
//             return_stdout: true
//         });
//         console.info(res);
//     } catch (err) {
//         console.error('Failed Deployment Of Ceph Tests', err, err.stack);
//         throw new Error('Failed Deployment Of Ceph Tests');
//     }
// }

async function run_single_test(test) {
    let ceph_args = `S3TEST_CONF=${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`;
    if (S3_CEPH_TEST_SIGV4.includes(test)) {
        ceph_args += ` S3_USE_SIGV4=true`;
    }
    let base_cmd = `${ceph_args} ./${CEPH_TEST.test_dir}${CEPH_TEST.s3_test_dir}virtualenv/bin/nosetests`;
    let res;
    let test_name;
    //Check if test should run
    if (!S3_CEPH_TEST_BLACKLIST_REGEXP.test(test)) {
        try {
            test_name = test.replace(S3_CEPH_TEST_STEMS_REGEXP, pref => `${pref.slice(0, -1)}:`); //Match against the common test path
            if (test_name.includes('boto')) {
                base_cmd = `${ceph_args} ./${CEPH_TEST.test_dir}${CEPH_TEST.s3_test_dir}virtualenv/bin/nosetests -v -s -A 'not fails_on_rgw'`;
            }
            //test_name = test_name.replace(S3_CEPH_TEST_STEMS_2_REGEXP, pref => `${pref.slice(0, -1)}:`); //Match against test_realistic path
            res = await os_utils.exec(`${base_cmd} ${test_name}`, { ignore_rc: false, return_stdout: true });
            if (res.indexOf('SKIP') >= 0) {
                console.warn('Test skipped:', test);
                stats.skip.push(test);
            } else {
                console.info('Test Passed:', test);
                stats.pass.push(test);
            }
        } catch (err) {
            console.error('Test Failed:', test);
            stats.fail.push(test);
        }
    }
}

async function test_worker() {
    for (;;) {
        const t = tests_list.shift();
        if (!t) return;
        await run_single_test(t);
    }
}

async function run_all_tests() {
    console.info('Running Ceph S3 Tests...');
    const tests_list_command =
        `S3TEST_CONF=${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}  ./${CEPH_TEST.test_dir}${CEPH_TEST.s3_test_dir}virtualenv/bin/nosetests -v --collect-only  2>&1 | awk '{print $1}' | grep test`;
    try {
        tests_list = await os_utils.exec(tests_list_command, { ignore_rc: false, return_stdout: true });
    } catch (err) {
        console.error('Failed getting tests list');
        throw new Error(`Failed getting tests list ${err}`);
    }

    tests_list = tests_list.split('\n');
    stats.total = tests_list.length;

    await P.map(_.times(5), test_worker);

    console.log('Finished Running Ceph S3 Tests');
}

async function main() {
    try {
        await run_test();
    } catch (err) {
        console.error(`Ceph Test Failed: ${err}`);
        process.exit(1);
    }
    process.exit(0);
}

async function run_test() {
    try {
        await client.create_auth_token(auth_params);
    } catch (err) {
        console.error('Failed create auth token', err);
        throw new Error('Failed create auth token');
    }

    try {
        await ceph_test_setup();
    } catch (err) {
        console.error('Failed setup ceph tests', err);
        throw new Error('Failed setup ceph tests');
    }

    try {
        await run_all_tests();
    } catch (err) {
        console.error('Failed running ceph tests', err);
        throw new Error('Running Ceph Tests Failed');
    }

    console.info(`CEPH TEST SUMMARY: Suite contains ${stats.total}, ran ${stats.pass.length + stats.fail.length + stats.skip.length} tests, Passed: ${stats.pass.length}, Skipped: ${stats.skip.length}, Failed: ${stats.fail.length}`);
    if (stats.skip.length) {
        console.warn(`CEPH TEST SUMMARY:  ${stats.skip.length} skipped tests ${stats.skip.join('\n')}`);
    }
    if (stats.fail.length) {
        console.error(`CEPH TEST SUMMARY: ${stats.fail.length} failed tests ${stats.fail.join('\n')}`);
        throw new Error('Ceph Tests Returned with Failures');
    }
}

if (require.main === module) {
    main();
}
