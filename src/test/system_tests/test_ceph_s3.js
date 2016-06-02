"use strict";

var _ = require('lodash');
var fs = require('fs');
var argv = require('minimist')(process.argv);
var AWS = require('aws-sdk');
var P = require('../../util/promise');
var Semaphore = require('../../util/semaphore');
var promise_utils = require('../../util/promise_utils');

var CEPH_TEST = {
    test_dir: 'src/test/system_tests/',
    s3_test_dir: 's3-tests/',
    ceph_config: 'ceph_s3_config.conf',
    ceph_deploy: 'ceph_s3_tests_deploy.sh',
    rpc_shell_file: 'src/tools/rpc_shell.js',
    new_account_json: `'{
        "name":"cephalt",
        "email":"ceph.alt@noobaa.com",
        "password":"ceph",
        "access_keys":{
            "access_key":"iam",
            "secret_key":"sloth"
        },
        "allowed_buckets":[]
    }'`,
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
    's3tests.functional.test_s3:test_multipart_upload',
    's3tests.functional.test_s3:test_multipart_upload_multiple_sizes',
    's3tests.functional.test_s3:test_multipart_upload_contents',
    's3tests.functional.test_s3:test_multipart_upload_overwrite_existing_object',
    's3tests.functional.test_s3:test_abort_multipart_upload',
    's3tests.functional.test_s3:test_multipart_resend_first_finishes_last',
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

// function show_usage() {
//     console.log('usage: node test_files_ul.js --ip <S3 IP> --bucket <Bucket Name> --access <ACCESS_KEY> --secret <SECRET>');
//     console.log('   example: node node test_files_ul.js --ip 10.0.0.1 --bucket files --access 123 --secret abc');
//
//     console.log('Optional Parameters:');
//     console.log('   --filesize - File size to upload, in KB. Default: 512KB');
//     console.log('                NOTE: Larger files sizes would take longer to generate');
//     console.log('   --numfiles - Number of files to upload. Default: 1000');
//     console.log('   --numthreads - Number of concurrent threads to use. Default: 10');
//     console.log('   --skip_generation - Skip pre generation of files, use last generated files');
//     console.log('   --skip_cleanup - Skip cleanup of files, can be used for another run');
// }

// function run_ceph_tests() {
//     //var dirs = Math.ceil(UL_TEST.num_files / UL_TEST.files_per_dir);
//     console.log('Starting Ceph Tests');
//     return promise_utils.promised_exec(`git clone ${CEPH_TEST.git_ceph_link}`)
//         .then(function() {
//             console.log('Finished Downloading Ceph From Git');
//             return;
//             //return promise_utils.promised_exec('rm -rf ' + UL_TEST.base_dir + '/*');
//         })
//         // .then(function() {
//         //     var i = 0;
//         //     return promise_utils.pwhile(
//         //         function() {
//         //             return i < dirs;
//         //         },
//         //         function() {
//         //             ++i;
//         //             return promise_utils.promised_exec('mkdir -p ' + UL_TEST.base_dir + '/dir' + i);
//         //         });
//         // })
//         // .fail(function(err) {
//         //     console.error('Failed creating directory structure', err, err.stack);
//         //     throw new Error('Failed creating directory structure');
//         // })
//         // .then(function() {
//         //     console.log('Generating files (this might take some time) ...');
//         //     var d = 0;
//         //     return promise_utils.pwhile(
//         //         function() {
//         //             return d < dirs;
//         //         },
//         //         function() {
//         //             ++d;
//         //             var files = (d === dirs) ? UL_TEST.num_files % UL_TEST.files_per_dir : UL_TEST.files_per_dir;
//         //             console.log(' generating batch', d, 'of', files, 'files');
//         //             for (var i = 1; i <= files; ++i) {
//         //                 UL_TEST.files.push(UL_TEST.base_dir + '/dir' + d + '/file_' + i);
//         //             }
//         //             return promise_utils.promised_exec('for i in `seq 1 ' + files + '` ; do' +
//         //                 ' dd if=/dev/urandom of=' + UL_TEST.base_dir + '/dir' + d +
//         //                 '/file_$i  bs=' + UL_TEST.file_size + 'k count=1 ; done');
//         //         });
//         // })
//         .fail(function(err) {
//             console.error('Failed Downloading Ceph From Git', err, err.stack);
//             throw new Error('Failed Downloading Ceph From Git');
//         });
// }

function deploy_ceph() {
    return promise_utils.promised_exec(`chmod a+x ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_deploy}`, false, true)
        .then(() => {
            console.log('Starting Deployment Of Ceph Tests...');
            return promise_utils.promised_exec(`cd ${CEPH_TEST.test_dir};./${CEPH_TEST.ceph_deploy}`, false, true)
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
                return promise_utils.promised_exec(`S3TEST_CONF=${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config} ./${CEPH_TEST.test_dir}${CEPH_TEST.s3_test_dir}virtualenv/bin/nosetests ${S3_CEPH_TEST_WHITELIST[i]}`, false, true)
                    .then(() => {
                        console.log('Test Passed:', S3_CEPH_TEST_WHITELIST[i]);
                    })
                    .fail((err) => {
                        had_errors = true;
                        console.warn('Test Failed:', S3_CEPH_TEST_WHITELIST[i], '\n' + err);
                    })
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
                return promise_utils.promised_exec(`S3TEST_CONF=${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config} ./${CEPH_TEST.test_dir}${CEPH_TEST.s3_test_dir}virtualenv/bin/nosetests -w ${process.cwd()}/${CEPH_TEST.test_dir}${CEPH_TEST.s3_test_dir} ${SYSTEM_CEPH_TEST_WHITELIST[i]}`, false, true)
                    .then(() => {
                        console.log('Test Passed:', SYSTEM_CEPH_TEST_WHITELIST[i]);
                    })
                    .fail((err) => {
                        had_errors = true;
                        console.warn('Test Failed:', SYSTEM_CEPH_TEST_WHITELIST[i], '\n' + err);
                    })
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
    return P.fcall(function() {
            return deploy_ceph();
        })
        .then(() => promise_utils.promised_exec(`node ${CEPH_TEST.rpc_shell_file} --run call --api account --func create_account --params ${CEPH_TEST.new_account_json}`, false, true))
        .then(() => system_ceph_test())
        .then(() => s3_ceph_test())
        .fail(function(err) {
            throw new Error('Ceph Tests Failed:', err);
        });
}

if (require.main === module) {
    main();
}
