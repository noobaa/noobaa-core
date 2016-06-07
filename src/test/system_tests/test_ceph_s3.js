"use strict";

var P = require('../../util/promise');
var promise_utils = require('../../util/promise_utils');

var CEPH_TEST = {
    test_dir: 'src/test/system_tests/',
    s3_test_dir: 's3-tests/',
    ceph_config: 'ceph_s3_config.conf',
    ceph_deploy: 'ceph_s3_tests_deploy.sh',
    rpc_shell_file: 'src/tools/rpc_shell.js',
    new_account_json: {
        name: 'cephalt',
        email: 'ceph.alt@noobaa.com',
        password: 'ceph',
        access_keys: {
            access_key: 'iam',
            secret_key: 'sloth'
        },
        allowed_buckets: []
    },
};

const S3_CEPH_TEST_WHITELIST = [
    's3tests.functional.test_headers:test_object_create_bad_md5_invalid_short',
    's3tests.functional.test_headers:test_object_create_bad_md5_bad',
    's3tests.functional.test_headers:test_object_create_bad_md5_empty',
    's3tests.functional.test_headers:test_object_create_bad_md5_none',
    's3tests.functional.test_headers:test_object_create_bad_expect_mismatch',
    's3tests.functional.test_headers:test_object_create_bad_expect_empty',
    's3tests.functional.test_headers:test_object_create_bad_expect_none',
    's3tests.functional.test_headers:test_object_create_bad_contenttype_invalid',
    's3tests.functional.test_headers:test_object_create_bad_contenttype_empty',
    's3tests.functional.test_headers:test_object_create_bad_contenttype_none',
    's3tests.functional.test_headers:test_bucket_create_bad_expect_mismatch',
    's3tests.functional.test_headers:test_bucket_create_bad_expect_empty',
    's3tests.functional.test_headers:test_object_create_bad_md5_invalid_garbage_aws2',
    's3tests.functional.test_headers:test_object_create_bad_authorization_incorrect_aws2',
    's3tests.functional.test_headers:test_object_create_bad_ua_empty_aws2',
    's3tests.functional.test_headers:test_object_create_bad_ua_none_aws2',
    's3tests.functional.test_headers:test_object_create_bad_date_none_aws2',
    's3tests.functional.test_headers:test_object_create_bad_date_before_today_aws2',
    's3tests.functional.test_headers:test_object_create_bad_date_after_today_aws2',
    's3tests.functional.test_headers:test_object_create_bad_date_after_end_aws2',
    's3tests.functional.test_headers:test_bucket_create_bad_ua_empty_aws2',
    's3tests.functional.test_headers:test_bucket_create_bad_ua_none_aws2',
    's3tests.functional.test_headers:test_bucket_create_bad_date_none_aws2',
    's3tests.functional.test_headers:test_bucket_create_bad_date_before_today_aws2',
    's3tests.functional.test_headers:test_bucket_create_bad_date_after_today_aws2',
    's3tests.functional.test_s3:test_bucket_list_empty',
    's3tests.functional.test_s3:test_bucket_list_distinct',
    's3tests.functional.test_s3:test_bucket_list_delimiter_basic',
    's3tests.functional.test_s3:test_bucket_list_delimiter_prefix_ends_with_delimiter',
    's3tests.functional.test_s3:test_bucket_list_delimiter_alt',
    's3tests.functional.test_s3:test_bucket_list_delimiter_percentage',
    's3tests.functional.test_s3:test_bucket_list_delimiter_whitespace',
    's3tests.functional.test_s3:test_bucket_list_delimiter_dot',
    's3tests.functional.test_s3:test_bucket_list_delimiter_empty',
    's3tests.functional.test_s3:test_bucket_list_delimiter_none',
    's3tests.functional.test_s3:test_bucket_list_delimiter_not_exist',
    's3tests.functional.test_s3:test_bucket_list_prefix_basic',
    's3tests.functional.test_s3:test_bucket_list_prefix_alt',
    's3tests.functional.test_s3:test_bucket_list_prefix_empty',
    's3tests.functional.test_s3:test_bucket_list_prefix_none',
    's3tests.functional.test_s3:test_bucket_list_prefix_not_exist',
    's3tests.functional.test_s3:test_bucket_list_prefix_delimiter_basic',
    's3tests.functional.test_s3:test_bucket_list_prefix_delimiter_alt',
    's3tests.functional.test_s3:test_bucket_list_prefix_delimiter_prefix_not_exist',
    's3tests.functional.test_s3:test_bucket_list_prefix_delimiter_delimiter_not_exist',
    's3tests.functional.test_s3:test_bucket_list_prefix_delimiter_prefix_delimiter_not_exist',
    's3tests.functional.test_s3:test_bucket_list_marker_before_list',
    's3tests.functional.test_s3:test_bucket_list_objects_anonymous_fail',
    's3tests.functional.test_s3:test_bucket_notexist',
    's3tests.functional.test_s3:test_bucket_delete_notexist',
    's3tests.functional.test_s3:test_bucket_delete_nonempty',
    's3tests.functional.test_s3:test_object_write_to_nonexist_bucket',
    's3tests.functional.test_s3:test_bucket_create_delete',
    's3tests.functional.test_s3:test_object_read_notexist',
    's3tests.functional.test_s3:test_object_requestid_on_error',
    's3tests.functional.test_s3:test_object_requestid_matchs_header_on_error',
    's3tests.functional.test_s3:test_object_head_zero_bytes',
    's3tests.functional.test_s3:test_object_write_check_etag',
    's3tests.functional.test_s3:test_object_write_read_update_read_delete',
    's3tests.functional.test_s3:test_object_set_get_metadata_none_to_good',
    's3tests.functional.test_s3:test_object_set_get_metadata_none_to_empty',
    's3tests.functional.test_s3:test_object_set_get_metadata_overwrite_to_good',
    's3tests.functional.test_s3:test_object_set_get_metadata_overwrite_to_empty',
    's3tests.functional.test_s3:test_object_set_get_unicode_metadata',
    's3tests.functional.test_s3:test_object_metadata_replaced_on_put',
    's3tests.functional.test_s3:test_object_write_file',
    's3tests.functional.test_s3:test_post_object_authenticated_request_bad_access_key',
    's3tests.functional.test_s3:test_post_object_invalid_signature',
    's3tests.functional.test_s3:test_post_object_invalid_access_key',
    's3tests.functional.test_s3:test_post_object_missing_policy_condition',
    's3tests.functional.test_s3:test_post_object_request_missing_policy_specified_field',
    's3tests.functional.test_s3:test_post_object_expired_policy',
    's3tests.functional.test_s3:test_post_object_invalid_request_field_value',
    's3tests.functional.test_s3:test_get_object_ifmatch_failed',
    's3tests.functional.test_s3:test_get_object_ifnonematch_failed',
    's3tests.functional.test_s3:test_get_object_ifmodifiedsince_good',
    's3tests.functional.test_s3:test_get_object_ifunmodifiedsince_good',
    's3tests.functional.test_s3:test_get_object_ifunmodifiedsince_failed',
    's3tests.functional.test_s3:test_put_object_ifmatch_good',
    's3tests.functional.test_s3:test_put_object_ifmatch_overwrite_existed_good',
    's3tests.functional.test_s3:test_put_object_ifnonmatch_good',
    's3tests.functional.test_s3:test_put_object_ifnonmatch_nonexisted_good',
    's3tests.functional.test_s3:test_object_delete_key_bucket_gone',
    's3tests.functional.test_s3:test_bucket_head',
    's3tests.functional.test_s3:test_bucket_head_extended',
    's3tests.functional.test_s3:test_object_raw_get_object_acl',
    's3tests.functional.test_s3:test_object_raw_authenticated',
    's3tests.functional.test_s3:test_object_raw_authenticated_bucket_acl',
    's3tests.functional.test_s3:test_object_raw_authenticated_object_acl',
    's3tests.functional.test_s3:test_object_raw_authenticated_bucket_gone',
    's3tests.functional.test_s3:test_object_raw_authenticated_object_gone',
    's3tests.functional.test_s3:test_object_raw_put',
    's3tests.functional.test_s3:test_object_raw_put_authenticated',
    's3tests.functional.test_s3:test_object_raw_put_authenticated_expired',
    's3tests.functional.test_s3:test_bucket_create_naming_bad_starts_nonalpha',
    's3tests.functional.test_s3:test_bucket_create_naming_bad_short_one',
    's3tests.functional.test_s3:test_bucket_create_naming_bad_short_two',
    's3tests.functional.test_s3:test_bucket_create_naming_bad_long',
    's3tests.functional.test_s3:test_bucket_create_naming_bad_ip',
    's3tests.functional.test_s3:test_bucket_create_naming_bad_punctuation',
    's3tests.functional.test_s3:test_bucket_get_location',
    's3tests.functional.test_s3:test_bucket_create_exists_nonowner',
    's3tests.functional.test_s3:test_bucket_delete_nonowner',
    's3tests.functional.test_s3:test_bucket_acl_canned_private_to_private',
    's3tests.functional.test_s3:test_access_bucket_private_object_private',
    's3tests.functional.test_s3:test_object_set_valid_acl',
    's3tests.functional.test_s3:test_buckets_create_then_list',
    's3tests.functional.test_s3:test_bucket_create_naming_good_starts_alpha',
    's3tests.functional.test_s3:test_bucket_create_naming_good_starts_digit',
    's3tests.functional.test_s3:test_bucket_create_naming_good_contains_period',
    's3tests.functional.test_s3:test_bucket_create_naming_good_contains_hyphen',
    's3tests.functional.test_s3:test_bucket_create_special_key_names',
    's3tests.functional.test_s3:test_bucket_list_special_prefix',
    's3tests.functional.test_s3:test_object_copy_zero_size',
    's3tests.functional.test_s3:test_object_copy_same_bucket',
    's3tests.functional.test_s3:test_object_copy_verify_contenttype',
    's3tests.functional.test_s3:test_object_copy_to_itself_with_metadata',
    's3tests.functional.test_s3:test_object_copy_diff_bucket',
    's3tests.functional.test_s3:test_object_copy_not_owned_bucket',
    's3tests.functional.test_s3:test_object_copy_retaining_metadata',
    's3tests.functional.test_s3:test_object_copy_replacing_metadata',
    's3tests.functional.test_s3:test_object_copy_bucket_not_found',
    's3tests.functional.test_s3:test_object_copy_key_not_found',
    's3tests.functional.test_s3:test_multipart_upload_small',
    //'s3tests.functional.test_s3:test_multipart_upload',
    //'s3tests.functional.test_s3:test_multipart_upload_multiple_sizes',
    //'s3tests.functional.test_s3:test_multipart_upload_contents',
    //'s3tests.functional.test_s3:test_multipart_upload_overwrite_existing_object',
    's3tests.functional.test_s3:test_abort_multipart_upload',
    //'s3tests.functional.test_s3:test_multipart_resend_first_finishes_last',
    's3tests.functional.test_s3:test_ranged_request_response_code',
    's3tests.functional.test_s3:test_ranged_request_skip_leading_bytes_response_code',
    's3tests.functional.test_s3:test_ranged_request_return_trailing_bytes_response_code',
    's3tests.functional.test_s3:test_ranged_request_invalid_range',
    's3tests.functional.test_utils:test_generate'
];

const SYSTEM_CEPH_TEST_WHITELIST = [
    's3tests.fuzz.test.test_fuzzer:test_load_graph',
    's3tests.fuzz.test.test_fuzzer:test_descend_leaf_node',
    's3tests.fuzz.test.test_fuzzer:test_descend_node',
    's3tests.fuzz.test.test_fuzzer:test_descend_bad_node',
    's3tests.fuzz.test.test_fuzzer:test_descend_nonexistant_child',
    's3tests.fuzz.test.test_fuzzer:test_expand_random_printable',
    's3tests.fuzz.test.test_fuzzer:test_expand_random_binary',
    's3tests.fuzz.test.test_fuzzer:test_expand_random_printable_no_whitespace',
    's3tests.fuzz.test.test_fuzzer:test_expand_random_binary_no_whitespace',
    's3tests.fuzz.test.test_fuzzer:test_expand_random_no_args',
    's3tests.fuzz.test.test_fuzzer:test_expand_random_no_charset',
    's3tests.fuzz.test.test_fuzzer:test_expand_random_exact_length',
    's3tests.fuzz.test.test_fuzzer:test_expand_random_bad_charset',
    's3tests.fuzz.test.test_fuzzer:test_expand_random_missing_length',
    's3tests.fuzz.test.test_fuzzer:test_assemble_decision',
    's3tests.fuzz.test.test_fuzzer:test_expand_escape',
    's3tests.fuzz.test.test_fuzzer:test_expand_indirect',
    's3tests.fuzz.test.test_fuzzer:test_expand_indirect_double',
    's3tests.fuzz.test.test_fuzzer:test_expand_recursive',
    's3tests.fuzz.test.test_fuzzer:test_expand_recursive_mutual',
    's3tests.fuzz.test.test_fuzzer:test_expand_recursive_not_too_eager',
    's3tests.fuzz.test.test_fuzzer:test_make_choice_unweighted_with_space',
    's3tests.fuzz.test.test_fuzzer:test_weighted_choices',
    's3tests.fuzz.test.test_fuzzer:test_null_choices',
    's3tests.fuzz.test.test_fuzzer:test_weighted_null_choices',
    's3tests.fuzz.test.test_fuzzer:test_null_child',
    's3tests.fuzz.test.test_fuzzer:test_weighted_set',
    's3tests.fuzz.test.test_fuzzer:test_header_presence',
    's3tests.fuzz.test.test_fuzzer:test_duplicate_header',
    's3tests.fuzz.test.test_fuzzer:test_expand_headers'
    // 's3tests.tests.test_realistic:TestFileValidator:test_new_file_is_valid',
    // 's3tests.tests.test_realistic:TestFileValidator:test_new_file_is_valid_on_several_calls',
    // 's3tests.tests.test_realistic:TestFileValidator:test_new_file_is_valid_when_size_is_1',
    // 's3tests.tests.test_realistic:TestFiles:test_random_file_valid'
];

const IGNORE_S3_CEPH_TEST_LIST = [
    's3tests.functional.test_s3:test_multipart_upload',
    's3tests.functional.test_s3:test_multipart_upload_multiple_sizes',
    's3tests.functional.test_s3:test_multipart_upload_contents',
    's3tests.functional.test_s3:test_multipart_upload_overwrite_existing_object',
    's3tests.functional.test_s3:test_multipart_resend_first_finishes_last'
];


function deploy_ceph() {
    var command = `chmod a+x ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_deploy}`;
    return promise_utils.promised_exec(command, false, true)
        .then((res) => {
            console.log('Starting Deployment Of Ceph Tests...');
            command = `cd ${CEPH_TEST.test_dir};./${CEPH_TEST.ceph_deploy}`;
            return promise_utils.promised_exec(command, false, true);
        })
        .then((res) => {
            return console.log(res);
        })
        .fail(function(err) {
            console.error('Failed Deployment Of Ceph Tests', err, err.stack);
            throw new Error('Failed Deployment Of Ceph Tests');
        });
}

function s3_ceph_test() {
    console.log('Running Ceph S3 Tests...');
    var i = -1;
    var had_errors = false;
    return promise_utils.pwhile(
            function() {
                i++;
                return i < S3_CEPH_TEST_WHITELIST.length;
            },
            function() {
                var command = `S3TEST_CONF=${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config} ./${CEPH_TEST.test_dir}${CEPH_TEST.s3_test_dir}virtualenv/bin/nosetests ${S3_CEPH_TEST_WHITELIST[i]}`;
                return promise_utils.promised_exec(command, false, true)
                    .then(() => {
                        console.log('Test Passed:', S3_CEPH_TEST_WHITELIST[i]);
                    })
                    .fail((err) => {
                        if (!IGNORE_S3_CEPH_TEST_LIST.contains(S3_CEPH_TEST_WHITELIST[i])) {
                            had_errors = true;
                        }
                        console.warn('Test Failed:', S3_CEPH_TEST_WHITELIST[i], '\n' + err);
                    });
            })
        .then(() => {
            if (!had_errors) {
                console.log('Finished Running Ceph S3 Tests');
            } else {
                throw new Error('Failed Running Ceph S3 Tests');
            }
            return;
        });
}

function system_ceph_test() {
    console.log('Running System Ceph S3 Tests...');
    var i = -1;
    var had_errors = false;
    return promise_utils.pwhile(
            function() {
                i++;
                return i < SYSTEM_CEPH_TEST_WHITELIST.length;
            },
            function() {
                var command = `S3TEST_CONF=${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config} ./${CEPH_TEST.test_dir}${CEPH_TEST.s3_test_dir}virtualenv/bin/nosetests -w ${process.cwd()}/${CEPH_TEST.test_dir}${CEPH_TEST.s3_test_dir} ${SYSTEM_CEPH_TEST_WHITELIST[i]}`;
                return promise_utils.promised_exec(command, false, true)
                    .then(() => {
                        console.log('Test Passed:', SYSTEM_CEPH_TEST_WHITELIST[i]);
                    })
                    .fail((err) => {
                        had_errors = true;
                        console.warn('Test Failed:', SYSTEM_CEPH_TEST_WHITELIST[i], '\n' + err);
                    });
            })
        .then(() => {
            if (!had_errors) {
                console.log('Finished Running System Ceph S3 Tests');
            } else {
                throw new Error('Failed Running System Ceph S3 Tests');
            }
            return;
        });
}

function main() {
    var command = `node ${CEPH_TEST.rpc_shell_file} --run call --api account --func create_account --params '${JSON.stringify(CEPH_TEST.new_account_json)}'`;
    return P.fcall(function() {
            return deploy_ceph();
        })
        .then(() => promise_utils.promised_exec(command, false, true))
        .then((res) => console.log(res))
        .then(() => system_ceph_test())
        .then(() => s3_ceph_test())
        .fail(function(err) {
            throw new Error('Ceph Tests Failed:', err);
        });
}

if (require.main === module) {
    main();
}
