/* Copyright (C) 2016 NooBaa */
"use strict";

const _ = require('lodash');
const P = require('../../util/promise');
const config = require('../../../config.js');
const promise_utils = require('../../util/promise_utils');
const os = require('os');


const api = require('../../api');
let rpc = api.new_rpc();

let client = rpc.new_client({
    address: 'ws://127.0.0.1:' + process.env.PORT
});
let auth_params = {
    email: 'demo@noobaa.com',
    password: 'DeMo1',
    system: 'demo'
};

let CEPH_TEST = {
    test_dir: 'src/test/system_tests/',
    s3_test_dir: 's3-tests/',
    ceph_config: 'ceph_s3_config.conf',
    ceph_deploy: 'ceph_s3_tests_deploy.sh',
    new_account: {
        name: 'cephalt',
        email: 'ceph.alt@noobaa.com',
        password: 'ceph',
        has_login: true,
        allowed_buckets: {
            full_permission: false,
            permission_list: []
        },
        s3_access: true,
        default_pool: config.NEW_SYSTEM_POOL_NAME
    },
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
    's3tests.functional.test_headers.test_object_create_date_and_amz_date',
    's3tests.functional.test_headers.test_bucket_put_bad_canned_acl',
    's3tests.functional.test_headers.test_object_create_bad_contentlength_mismatch_below_aws2',
    's3tests.functional.test_headers.test_object_create_bad_authorization_invalid_aws2',
    's3tests.functional.test_headers.test_object_create_bad_ua_unreadable_aws2',
    's3tests.functional.test_headers.test_object_create_bad_date_invalid_aws2',
    's3tests.functional.test_headers.test_object_create_bad_date_empty_aws2',
    's3tests.functional.test_headers.test_object_create_bad_date_before_epoch_aws2',
    's3tests.functional.test_headers.test_bucket_create_bad_authorization_invalid_aws2',
    's3tests.functional.test_headers.test_bucket_create_bad_ua_unreadable_aws2',
    's3tests.functional.test_headers.test_bucket_create_bad_date_invalid_aws2',
    's3tests.functional.test_headers.test_bucket_create_bad_date_empty_aws2',
    's3tests.functional.test_headers.test_bucket_create_bad_date_before_epoch_aws2',
    's3tests.functional.test_headers.test_object_create_bad_contentlength_mismatch_below_aws4',
    's3tests.functional.test_headers.test_object_create_bad_authorization_invalid_aws4',
    's3tests.functional.test_headers.test_object_create_bad_ua_empty_aws4',
    's3tests.functional.test_headers.test_object_create_bad_ua_unreadable_aws4',
    's3tests.functional.test_headers.test_object_create_bad_ua_none_aws4',
    's3tests.functional.test_headers.test_object_create_bad_date_unreadable_aws4',
    's3tests.functional.test_headers.test_object_create_bad_date_none_aws4',
    's3tests.functional.test_headers.test_object_create_bad_amz_date_none_aws4',
    's3tests.functional.test_headers.test_object_create_bad_date_before_today_aws4',
    's3tests.functional.test_headers.test_object_create_bad_date_after_today_aws4',
    's3tests.functional.test_headers.test_object_create_bad_date_before_epoch_aws4',
    's3tests.functional.test_headers.test_object_create_bad_amz_date_before_epoch_aws4',
    's3tests.functional.test_headers.test_object_create_bad_date_after_end_aws4',
    's3tests.functional.test_headers.test_object_create_missing_signed_custom_header_aws4',
    's3tests.functional.test_headers.test_object_create_missing_signed_header_aws4',
    's3tests.functional.test_headers.test_bucket_create_bad_authorization_invalid_aws4',
    's3tests.functional.test_headers.test_bucket_create_bad_ua_empty_aws4',
    's3tests.functional.test_headers.test_bucket_create_bad_ua_unreadable_aws4',
    's3tests.functional.test_headers.test_bucket_create_bad_ua_none_aws4',
    's3tests.functional.test_headers.test_bucket_create_bad_date_unreadable_aws4',
    's3tests.functional.test_headers.test_bucket_create_bad_date_none_aws4',
    's3tests.functional.test_headers.test_bucket_create_bad_amz_date_none_aws4',
    's3tests.functional.test_headers.test_bucket_create_bad_date_before_today_aws4',
    's3tests.functional.test_headers.test_bucket_create_bad_date_after_today_aws4',
    's3tests.functional.test_headers.test_bucket_create_bad_date_before_epoch_aws4',
    's3tests.functional.test_headers.test_bucket_create_bad_amz_date_before_epoch_aws4',
    's3tests.functional.test_s3.test_bucket_list_delimiter_prefix',
    's3tests.functional.test_s3.test_bucket_list_delimiter_prefix_underscore',
    's3tests.functional.test_s3.test_bucket_list_delimiter_unreadable',
    's3tests.functional.test_s3.test_bucket_list_prefix_unreadable',
    's3tests.functional.test_s3.test_bucket_list_objects_anonymous',
    's3tests.functional.test_s3.test_object_write_cache_control',
    's3tests.functional.test_s3.test_object_write_expires',
    's3tests.functional.test_s3.test_object_set_get_non_utf8_metadata',
    's3tests.functional.test_s3.test_object_set_get_metadata_empty_to_unreadable_prefix',
    's3tests.functional.test_s3.test_object_set_get_metadata_empty_to_unreadable_suffix',
    's3tests.functional.test_s3.test_object_set_get_metadata_empty_to_unreadable_infix',
    's3tests.functional.test_s3.test_object_set_get_metadata_overwrite_to_unreadable_prefix',
    's3tests.functional.test_s3.test_object_set_get_metadata_overwrite_to_unreadable_suffix',
    's3tests.functional.test_s3.test_object_set_get_metadata_overwrite_to_unreadable_infix',
    's3tests.functional.test_s3.test_post_object',
    's3tests.functional.test_s3.test_put_object_ifmatch_nonexisted_failed',
    's3tests.functional.test_s3.test_object_raw_get',
    's3tests.functional.test_s3.test_object_raw_get_bucket_gone',
    's3tests.functional.test_s3.test_object_raw_get_object_gone',
    's3tests.functional.test_s3.test_object_raw_get_bucket_acl',
    's3tests.functional.test_s3.test_object_raw_response_headers',
    's3tests.functional.test_s3.test_object_raw_get_x_amz_expires_not_expired',
    's3tests.functional.test_s3.test_object_raw_get_x_amz_expires_out_range_zero',
    's3tests.functional.test_s3.test_object_raw_get_x_amz_expires_out_max_range',
    's3tests.functional.test_s3.test_object_raw_get_x_amz_expires_out_positive_range',
    's3tests.functional.test_s3.test_object_raw_put_write_access',
    's3tests.functional.test_s3.test_bucket_create_naming_bad_short_empty',
    's3tests.functional.test_s3.test_bucket_create_naming_good_long_250',
    's3tests.functional.test_s3.test_bucket_create_naming_good_long_251',
    's3tests.functional.test_s3.test_bucket_create_naming_good_long_252',
    's3tests.functional.test_s3.test_bucket_create_naming_good_long_253',
    's3tests.functional.test_s3.test_bucket_create_naming_good_long_254',
    's3tests.functional.test_s3.test_bucket_create_naming_good_long_255',
    's3tests.functional.test_s3.test_bucket_list_long_name',
    's3tests.functional.test_s3.test_bucket_create_naming_dns_underscore',
    's3tests.functional.test_s3.test_bucket_create_naming_dns_long',
    's3tests.functional.test_s3.test_bucket_create_naming_dns_dash_at_end',
    's3tests.functional.test_s3.test_bucket_create_naming_dns_dot_dot',
    's3tests.functional.test_s3.test_bucket_create_naming_dns_dot_dash',
    's3tests.functional.test_s3.test_bucket_create_naming_dns_dash_dot',
    's3tests.functional.test_s3.test_bucket_create_exists',
    's3tests.functional.test_s3.test_bucket_configure_recreate',
    's3tests.functional.test_s3.test_bucket_delete_nonowner',
    's3tests.functional.test_s3.test_bucket_acl_default',
    's3tests.functional.test_s3.test_bucket_acl_canned_during_create',
    's3tests.functional.test_s3.test_bucket_acl_canned',
    's3tests.functional.test_s3.test_bucket_acl_canned_publicreadwrite',
    's3tests.functional.test_s3.test_bucket_acl_canned_authenticatedread',
    's3tests.functional.test_s3.test_object_acl_canned_during_create',
    's3tests.functional.test_s3.test_object_acl_canned',
    's3tests.functional.test_s3.test_object_acl_canned_publicreadwrite',
    's3tests.functional.test_s3.test_object_acl_canned_authenticatedread',
    's3tests.functional.test_s3.test_object_acl_canned_bucketownerread',
    's3tests.functional.test_s3.test_object_acl_canned_bucketownerfullcontrol',
    's3tests.functional.test_s3.test_object_acl_full_control_verify_owner',
    's3tests.functional.test_s3.test_bucket_acl_xml_write',
    's3tests.functional.test_s3.test_bucket_acl_xml_writeacp',
    's3tests.functional.test_s3.test_bucket_acl_xml_read',
    's3tests.functional.test_s3.test_bucket_acl_xml_readacp',
    's3tests.functional.test_s3.test_object_acl_xml_write',
    's3tests.functional.test_s3.test_object_acl_xml_writeacp',
    's3tests.functional.test_s3.test_object_acl_xml_read',
    's3tests.functional.test_s3.test_object_acl_xml_readacp',
    's3tests.functional.test_s3.test_bucket_acl_grant_userid_fullcontrol',
    's3tests.functional.test_s3.test_bucket_acl_grant_userid_read',
    's3tests.functional.test_s3.test_bucket_acl_grant_userid_readacp',
    's3tests.functional.test_s3.test_bucket_acl_grant_userid_write',
    's3tests.functional.test_s3.test_bucket_acl_grant_userid_writeacp',
    's3tests.functional.test_s3.test_bucket_acl_grant_nonexist_user',
    's3tests.functional.test_s3.test_bucket_acl_no_grants',
    's3tests.functional.test_s3.test_object_header_acl_grants',
    's3tests.functional.test_s3.test_bucket_header_acl_grants',
    's3tests.functional.test_s3.test_bucket_acl_grant_email',
    's3tests.functional.test_s3.test_bucket_acl_grant_email_notexist',
    's3tests.functional.test_s3.test_bucket_acl_revoke_all',
    's3tests.functional.test_s3.test_logging_toggle',
    's3tests.functional.test_s3.test_access_bucket',
    's3tests.functional.test_s3.test_object_giveaway',
    's3tests.functional.test_s3.test_list_buckets_anonymous',
    's3tests.functional.test_s3.test_list_buckets_invalid_auth',
    's3tests.functional.test_s3.test_list_buckets_bad_auth',
    's3tests.functional.test_s3.test_bucket_recreate_not_overriding',
    's3tests.functional.test_s3.test_object_copy_to_itself',
    's3tests.functional.test_s3.test_object_copy_canned_acl',
    's3tests.functional.test_s3.test_multipart_copy_small',
    's3tests.functional.test_s3.test_multipart_copy_invalid_range',
    's3tests.functional.test_s3.test_multipart_upload_size_too_small',
    's3tests.functional.test_s3.test_abort_multipart_upload_not_found', // fails on ‘InternalError’ suppose to return ‘NoSuchUpload’
    's3tests.functional.test_s3.test_100_continue',
    's3tests.functional.test_s3.test_bucket_acls_changes_persistent',
    's3tests.functional.test_s3.test_stress_bucket_acls_changes',
    's3tests.functional.test_s3.test_set_cors',
    's3tests.functional.test_s3.test_cors_origin_response',
    's3tests.functional.test_s3.test_cors_origin_wildcard',
    's3tests.functional.test_s3.test_cors_header_option',
    's3tests.functional.test_s3.check_can_test_multiregion',
    's3tests.functional.test_s3.test_region_bucket_create_secondary_access_remove_master',
    's3tests.functional.test_s3.test_region_bucket_create_master_access_remove_secondary',
    's3tests.functional.test_s3.test_region_copy_object',
    's3tests.functional.test_s3.test_versioned_object_acl',
    's3tests.functional.test_s3.test_versioned_object_acl_no_version_specified',
    's3tests.functional.test_s3.test_lifecycle_expiration',
    's3tests.functional.test_s3.test_lifecycle_id_too_long',
    's3tests.functional.test_s3.test_lifecycle_same_id',
    's3tests.functional.test_s3.test_lifecycle_invalid_status',
    's3tests.functional.test_s3.test_lifecycle_rules_conflicted',
    's3tests.functional.test_s3.test_lifecycle_set_date',
    's3tests.functional.test_s3.test_lifecycle_set_invalid_date',
    's3tests.functional.test_s3.test_lifecycle_expiration_date',
    's3tests.functional.test_s3.test_lifecycle_set_noncurrent',
    's3tests.functional.test_s3.test_lifecycle_noncur_expiration',
    's3tests.functional.test_s3.test_lifecycle_set_deletemarker',
    's3tests.functional.test_s3.test_lifecycle_set_filter',
    's3tests.functional.test_s3.test_lifecycle_set_empty_filter',
    's3tests.functional.test_s3.test_lifecycle_deletemarker_expiration',
    's3tests.functional.test_s3.test_lifecycle_set_multipart',
    's3tests.functional.test_s3.test_lifecycle_multipart_expiration',
    's3tests.functional.test_s3.test_encrypted',
    's3tests.functional.test_s3.test_encryption',
    's3tests.functional.test_s3.test_sse_kms',
    's3tests.functional.test_s3.test_bucket_policy',
    's3tests.functional.test_s3.test_get_obj_tagging', // S3 TODO (NotImplemented) put_object_tagging
    's3tests.functional.test_s3.test_get_obj_head_tagging', // S3 TODO (NotImplemented) put_object_tagging
    's3tests.functional.test_s3.test_put_max_tags', // S3 TODO (NotImplemented) put_object_tagging
    's3tests.functional.test_s3.test_put_excess_tags', // S3 TODO (NotImplemented) put_object_tagging
    's3tests.functional.test_s3.test_put_max_kvsize_tags', // S3 TODO (NotImplemented) put_object_tagging
    's3tests.functional.test_s3.test_put_excess_key_tags', // S3 TODO (NotImplemented) put_object_tagging
    's3tests.functional.test_s3.test_put_excess_val_tags', // S3 TODO (NotImplemented) put_object_tagging
    's3tests.functional.test_s3.test_put_modify_tags', // S3 TODO (NotImplemented) put_object_tagging
    's3tests.functional.test_s3.test_put_delete_tags', // S3 TODO (NotImplemented) put_object_tagging
    's3tests.functional.test_s3.test_put_obj_with_tags', // S3 TODO (NotImplemented) get_object_tagging
    's3tests.functional.test_s3.test_get_tags_acl_public',
    's3tests.functional.test_s3.test_put_tags_acl_public',
    's3tests.functional.test_s3.test_delete_tags_obj_public',
    's3tests.functional.test_s3_website.check_can_test_website',
    's3tests.functional.test_headers.test_object_create_bad_contentlength_none',
    's3tests.functional.test_headers.test_object_create_bad_contentlength_mismatch_above',
    's3tests.functional.test_s3.test_object_copy_not_owned_bucke',
    's3tests.functional.test_s3.test_object_copy_not_owned_object_bucket',
    's3tests.fuzz.test.test_fuzzer.test_load_graph',
    's3tests.functional.test_s3_website',
];
const S3_CEPH_TEST_BLACKLIST_REGEXP = new RegExp(`(${S3_CEPH_TEST_BLACKLIST.join(')|(')})`);
const S3_CEPH_TEST_STEMS = [
    's3tests.functional.test_headers.',
    's3tests.functional.test_s3.',
    's3tests.fuzz.test.test_fuzzer.',
    's3tests.functional.test_s3_website.',
    's3tests.tests.test_realistic.',
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

async function deploy_ceph() {
    console.info('Starting Deployment Of Ceph Tests...');
    let command = `cd ${CEPH_TEST.test_dir};./${CEPH_TEST.ceph_deploy} ${os.platform() === 'darwin' ? 'mac' : ''} > /tmp/ceph_deploy.log`;
    try {
        let res = await promise_utils.exec(command, {
            ignore_rc: false,
            return_stdout: true
        });
        console.info(res);
    } catch (err) {
        console.error('Failed Deployment Of Ceph Tests', err, err.stack);
        throw new Error('Failed Deployment Of Ceph Tests');
    }
}

async function run_single_test(test) {
    const base_cmd = `S3TEST_CONF=${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config} ./${CEPH_TEST.test_dir}${CEPH_TEST.s3_test_dir}virtualenv/bin/nosetests`;
    let res;
    let test_name;
    //Check if test should run
    if (!S3_CEPH_TEST_BLACKLIST_REGEXP.test(test)) {
        try {
            test_name = test.replace(S3_CEPH_TEST_STEMS_REGEXP, pref => `${pref.slice(0, -1)}:`); //Match against the common test path
            //test_name = test_name.replace(S3_CEPH_TEST_STEMS_2_REGEXP, pref => `${pref.slice(0, -1)}:`); //Match against test_realistic path
            res = await promise_utils.exec(`${base_cmd} ${test_name}`, { ignore_rc: false, return_stdout: true });
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
        tests_list = await promise_utils.exec(tests_list_command, { ignore_rc: false, return_stdout: true });
    } catch (err) {
        console.error('Failed getting tests list');
        throw new Error('Failed getting tests list', err);
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
    await client.create_auth_token(auth_params);

    try {
        await deploy_ceph();
    } catch (err) {
        console.error('Failed deplying ceph tests', err);
        throw new Error('Failed deplying ceph tests');
    }

    let system_info = await client.system.read_system();
    let ceph_account = system_info.accounts.find(
        account => account.email === CEPH_TEST.new_account.email
    );
    if (ceph_account) {
        CEPH_TEST.new_account.access_keys = ceph_account.access_keys;
    } else {
        await client.account.create_account(CEPH_TEST.new_account);
        system_info = await client.system.read_system();
        CEPH_TEST.new_account.access_keys = system_info.accounts.find(
            account => account.email === CEPH_TEST.new_account.email
        ).access_keys;
    }

    console.info('CEPH TEST CONFIGURATION:', JSON.stringify(CEPH_TEST));
    await promise_utils.exec(`echo access_key = ${CEPH_TEST.new_account.access_keys[0].access_key} >> ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
    await promise_utils.exec(`echo secret_key = ${CEPH_TEST.new_account.access_keys[0].secret_key} >> ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
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
