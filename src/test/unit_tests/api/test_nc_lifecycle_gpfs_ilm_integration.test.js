/* Copyright (C) 2016 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = 'true';

const fs = require('fs');
const path = require('path');
const config = require('../../../../config');
const { ConfigFS } = require('../../../sdk/config_fs');
const { file_delete, create_fresh_path } = require('../../../util/fs_utils');
const { read_file } = require('../../../util/native_fs_utils');
const { run_or_skip_test, TMP_PATH, create_file, IS_GPFS } = require('../../system_tests/test_utils');
const { NCLifecycle, ILM_POLICIES_TMP_DIR, ILM_CANDIDATES_TMP_DIR } = require('../../../manage_nsfs/nc_lifecycle');

const config_root = path.join(TMP_PATH, 'config_root_nc_lifecycle');
const config_fs = new ConfigFS(config_root);
const nc_lifecycle = new NCLifecycle(config_fs);
const fs_context = config_fs.fs_context;
const mock_start_time = Date.now();
nc_lifecycle.lifecycle_run_status = {
    lifecycle_run_times: {
        run_lifecycle_start_time: mock_start_time,
    }
};

const mock_mount_point = 'mock/mount/path';
const now = new Date();
const two_days_ago = now.setDate(now.getDate() - 2);
const two_days_from_now = now.setDate(now.getDate() + 2);

const bucket_name = 'mock_bucket_name';
const bucket_path = path.join(TMP_PATH, 'mock_bucket_path');
const prefix = 'mock_prefix';
const mock_content = `mock_content`;
const mock_bucket_json = { _id: 'mock_bucket_id', name: bucket_name, path: bucket_path };
const escape_backslash_str = "ESCAPE '\\'";

const days = 3;
const default_lifecycle_rule = {
    id: 'abort mpu and expire all objects after 3 days',
    status: 'Enabled',
    abort_incomplete_multipart_upload: {
        days_after_initiation: days
    },
};


// TODO - move to test utils


describe('convert_expiry_rule_to_gpfs_ilm_policy unit tests', () => {
    const lifecycle_rule_base = {
        ...default_lifecycle_rule,
        filter: { 'prefix': '' }
    };
    const escaped_bucket_path = get_escaped_string(bucket_path);
    const convertion_helpers = {
        in_versions_dir: path.join(escaped_bucket_path, '/.versions/%'),
        in_nested_versions_dir: path.join(escaped_bucket_path, '/%/.versions/%')
    };
    it('convert_expiry_rule_to_gpfs_ilm_policy - expiry days', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, expiration: { days: days } };

        const ilm_policy = nc_lifecycle.convert_expiry_rule_to_gpfs_ilm_policy(lifecycle_rule, convertion_helpers);
        expect(ilm_policy).toBe(get_expected_ilm_expiry(days, bucket_path));
    });

    it('convert_expiry_rule_to_gpfs_ilm_policy - expiry date', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, expiration: { date: Date.now() } };
        const ilm_policy = nc_lifecycle.convert_expiry_rule_to_gpfs_ilm_policy(lifecycle_rule, convertion_helpers);
        expect(ilm_policy).toBe(get_expected_ilm_expiry(undefined, bucket_path));
    });

    it('convert_expiry_rule_to_gpfs_ilm_policy - no expiry', () => {
        const lifecycle_rule = lifecycle_rule_base;
        const ilm_policy = nc_lifecycle.convert_expiry_rule_to_gpfs_ilm_policy(lifecycle_rule, convertion_helpers);
        expect(ilm_policy).toBe('');
    });
});

describe('convert_filter_to_gpfs_ilm_policy unit tests', () => {
    const tags = [{ key: 'key1', value: 'val1' }, { key: 'key3', value: 'val4' }];
    const object_size_greater_than = 5;
    const object_size_less_than = 10;
    const lifecycle_rule_base = {
        ...default_lifecycle_rule,
        expiration: { days: days }
    };

    const escaped_bucket_path = get_escaped_string(bucket_path);
    it('convert_filter_to_gpfs_ilm_policy - filter empty', () => {
        const lifecycle_rule = lifecycle_rule_base;
        const ilm_policy = nc_lifecycle.convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path);
        expect(ilm_policy).toBe('');
    });

    it('convert_filter_to_gpfs_ilm_policy - inline prefix', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, prefix };
        const ilm_policy = nc_lifecycle.convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path);
        expect(ilm_policy).toBe(get_expected_ilm_prefix(bucket_path, prefix));
    });

    it('convert_filter_to_gpfs_ilm_policy - filter with prefix', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, filter: { prefix } };
        const ilm_policy = nc_lifecycle.convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path);
        expect(ilm_policy).toBe(get_expected_ilm_prefix(bucket_path, prefix));
    });

    it('convert_filter_to_gpfs_ilm_policy - filter with size gt', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, filter: { object_size_greater_than } };
        const ilm_policy = nc_lifecycle.convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path);
        expect(ilm_policy).toBe(get_expected_ilm_size_greater_than(object_size_greater_than));
    });

    it('convert_filter_to_gpfs_ilm_policy - filter with size lt', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, filter: { object_size_less_than } };
        const ilm_policy = nc_lifecycle.convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path);
        expect(ilm_policy).toBe(get_expected_ilm_size_less_than(object_size_less_than));
    });

    it('convert_filter_to_gpfs_ilm_policy - filter with tags', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, filter: { tags } };
        const ilm_policy = nc_lifecycle.convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path);
        expect(ilm_policy).toBe(get_expected_ilm_tags(tags));
    });

    it('convert_filter_to_gpfs_ilm_policy - filter with prefix + size gt', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, filter: { prefix, object_size_greater_than } };
        const ilm_policy = nc_lifecycle.convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path);
        const expected_ilm_filter = get_expected_ilm_prefix(bucket_path, prefix) +
            get_expected_ilm_size_greater_than(object_size_greater_than);
        expect(ilm_policy).toBe(expected_ilm_filter);
    });

    it('convert_filter_to_gpfs_ilm_policy - filter with prefix + size lt', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, filter: { prefix, object_size_less_than } };
        const ilm_policy = nc_lifecycle.convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path);
        const expected_ilm_filter = get_expected_ilm_prefix(bucket_path, prefix) + get_expected_ilm_size_less_than(object_size_less_than);
        expect(ilm_policy).toBe(expected_ilm_filter);
    });

    it('convert_filter_to_gpfs_ilm_policy - filter with prefix + tags', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, filter: { prefix, tags } };
        const ilm_policy = nc_lifecycle.convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path);
        const expected_ilm_filter = get_expected_ilm_prefix(bucket_path, prefix) + get_expected_ilm_tags(tags);
        expect(ilm_policy).toBe(expected_ilm_filter);
    });

    it('convert_filter_to_gpfs_ilm_policy - filter with size gt + size lt', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, filter: { object_size_less_than, object_size_greater_than } };
        const ilm_policy = nc_lifecycle.convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path);
        const expected_ilm_filter = get_expected_ilm_size_greater_than(object_size_greater_than) +
            get_expected_ilm_size_less_than(object_size_less_than);
        expect(ilm_policy).toBe(expected_ilm_filter);
    });

    it('convert_filter_to_gpfs_ilm_policy - filter with size gt + tags', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, filter: { object_size_greater_than, tags } };
        const ilm_policy = nc_lifecycle.convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path);
        const expected_ilm_filter = get_expected_ilm_size_greater_than(object_size_greater_than) +
            get_expected_ilm_tags(tags);
        expect(ilm_policy).toBe(expected_ilm_filter);
    });

    it('convert_filter_to_gpfs_ilm_policy - filter with size lt + tags', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, filter: { object_size_less_than, tags } };
        const ilm_policy = nc_lifecycle.convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path);
        const expected_ilm_filter = get_expected_ilm_size_less_than(object_size_less_than) +
            get_expected_ilm_tags(tags);
        expect(ilm_policy).toBe(expected_ilm_filter);
    });

    it('convert_filter_to_gpfs_ilm_policy - filter with prefix + size gt + size lt', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, filter: { prefix, object_size_greater_than, object_size_less_than } };
        const ilm_policy = nc_lifecycle.convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path);
        const expected_ilm_filter = get_expected_ilm_prefix(bucket_path, prefix) +
            get_expected_ilm_size_greater_than(object_size_greater_than) +
            get_expected_ilm_size_less_than(object_size_less_than);
        expect(ilm_policy).toBe(expected_ilm_filter);
    });

    it('convert_filter_to_gpfs_ilm_policy - filter with prefix + size lt + tags', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, filter: { prefix, object_size_less_than, tags } };
        const ilm_policy = nc_lifecycle.convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path);
        const expected_ilm_filter = get_expected_ilm_prefix(bucket_path, prefix) +
            get_expected_ilm_size_less_than(object_size_less_than) +
            get_expected_ilm_tags(tags);
        expect(ilm_policy).toBe(expected_ilm_filter);
    });

    it('convert_filter_to_gpfs_ilm_policy - filter with size gt + size lt + tags', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, filter: { object_size_greater_than, object_size_less_than, tags } };
        const ilm_policy = nc_lifecycle.convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path);
        const expected_ilm_filter = get_expected_ilm_size_greater_than(object_size_greater_than) +
            get_expected_ilm_size_less_than(object_size_less_than) +
            get_expected_ilm_tags(tags);
        expect(ilm_policy).toBe(expected_ilm_filter);
    });

    it('convert_filter_to_gpfs_ilm_policy - filter with prefix + size gt + size lt + tags', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, filter: { prefix, object_size_greater_than, object_size_less_than, tags } };
        const ilm_policy = nc_lifecycle.convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path);
        const expected_ilm_filter = get_expected_ilm_prefix(bucket_path, prefix) +
            get_expected_ilm_size_greater_than(object_size_greater_than) +
            get_expected_ilm_size_less_than(object_size_less_than) +
            get_expected_ilm_tags(tags);
        expect(ilm_policy).toBe(expected_ilm_filter);
    });
});


describe('write_tmp_ilm_policy unit tests', () => {
    const tags = [{ key: 'key1', value: 'val1' }, { key: 'key3', value: 'val4' }];
    const object_size_greater_than = 5;
    const object_size_less_than = 10;

    const expected_ilm_policy_path = nc_lifecycle.get_gpfs_ilm_policy_file_path(mock_mount_point);
    const ilm_policy_mock_string = get_expected_ilm_prefix(bucket_path, prefix) +
        get_expected_ilm_size_greater_than(object_size_greater_than) +
        get_expected_ilm_size_less_than(object_size_less_than) +
        get_expected_ilm_tags(tags);

    beforeAll(async () => {
        await create_fresh_path(ILM_POLICIES_TMP_DIR);
    });

    afterEach(async () => {
        await file_delete(expected_ilm_policy_path);
    });

    it('write_tmp_ilm_policy - ilm file does not exist', async () => {
        const ilm_policy_tmp_path = await nc_lifecycle.write_tmp_ilm_policy(mock_mount_point, ilm_policy_mock_string);
        expect(ilm_policy_tmp_path).toBe(expected_ilm_policy_path);
        const data = await read_file(fs_context, ilm_policy_tmp_path);
        expect(data).toBe(ilm_policy_mock_string);
    });

    it('write_tmp_ilm_policy - already exists', async () => {
        await create_file(fs_context, expected_ilm_policy_path, mock_content);
        const ilm_policy_tmp_path = await nc_lifecycle.write_tmp_ilm_policy(mock_mount_point, ilm_policy_mock_string);
        expect(ilm_policy_tmp_path).toBe(expected_ilm_policy_path);
        const data = await read_file(fs_context, ilm_policy_tmp_path);
        expect(data).toBe(mock_content);
    });
});

describe('get_candidates_by_gpfs_ilm_policy unit tests', () => {
    const tags = [{ key: 'key1', value: 'val1' }, { key: 'key3', value: 'val4' }];
    const object_size_greater_than = 0;
    const object_size_less_than = 10;
    const lifecycle_rule_base = {
        ...default_lifecycle_rule,
        expiration: { days: days }
    };
    const ilm_policy_path = nc_lifecycle.get_gpfs_ilm_policy_file_path(mock_mount_point);
    const expected_candidates_suffix = `${bucket_name}_${lifecycle_rule_base.id}_${nc_lifecycle.lifecycle_run_status.lifecycle_run_times.run_lifecycle_start_time}`;
    const expected_candidates_path = path.join(ILM_CANDIDATES_TMP_DIR, 'list.' + expected_candidates_suffix);

    beforeEach(async () => {
        const ilm_policy_mock_string = get_mock_base_ilm_policy(bucket_path, lifecycle_rule_base.id, nc_lifecycle.lifecycle_run_status) +
            get_expected_ilm_prefix(bucket_path, prefix) +
            get_expected_ilm_size_greater_than(object_size_greater_than) +
            get_expected_ilm_size_less_than(object_size_less_than) +
            get_expected_ilm_tags(tags);
        await create_file(fs_context, ilm_policy_path, ilm_policy_mock_string);
    });

    afterEach(async () => {
        await file_delete(ilm_policy_path);
        await file_delete(expected_candidates_path);
    });

    run_or_skip_test(IS_GPFS)('get_candidates_by_gpfs_ilm_policy - ilm file does not exist - no objects returned', async () => {
        await nc_lifecycle.create_candidates_file_by_gpfs_ilm_policy(mock_mount_point, ilm_policy_path);
        const data = await read_file(fs_context, expected_candidates_path);
        console.log('GPFS empty bucket path test data', data);
        expect(data).toBe('');
    });

    run_or_skip_test(IS_GPFS)('create_candidates_file_by_gpfs_ilm_policy - ilm file does not exist - some objects returned', async () => {
        const expired_obj_path = 'expired_mock_prefix.txt';
        await create_file(fs_context, path.join(bucket_path, expired_obj_path), mock_content);
        await nc_lifecycle.create_candidates_file_by_gpfs_ilm_policy(mock_mount_point, ilm_policy_path);
        const data = await read_file(fs_context, expected_candidates_path);
        console.log('GPFS non empty bucket path test data', data);
        expect(data).toContain(expired_obj_path);
    });
});


describe('get_candidates_by_expiration_rule_gpfs unit tests', () => {
    const lifecycle_rule_base = default_lifecycle_rule;

    beforeEach(() => {
        nc_lifecycle.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[lifecycle_rule_base.id].state = {};
    });

    run_or_skip_test(IS_GPFS)('get_candidates_by_expiration_rule_gpfs - expire by date - should not expire', async () => {
        const lifecycle_rule = lifecycle_rule_base;
        lifecycle_rule.expiration = { date: two_days_from_now };
        const candidates = await nc_lifecycle.get_candidates_by_expiration_rule_gpfs(lifecycle_rule, mock_bucket_json);
        expect(candidates).toEqual([]);
        const actual_rule_state = nc_lifecycle.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[lifecycle_rule.id].state;
        const expected_rule_state = { is_finished: true, key_marker: undefined, key_marker_count: undefined };
        assert_rule_state(actual_rule_state, expected_rule_state);
    });

    run_or_skip_test(IS_GPFS)('get_candidates_by_expiration_rule_gpfs - expire by days, nothing should expire ', async () => {
        const lifecycle_rule = lifecycle_rule_base;
        lifecycle_rule.expiration = { days: two_days_ago };
        const candidates = await nc_lifecycle.get_candidates_by_expiration_rule_gpfs(lifecycle_rule, mock_bucket_json);
        expect(candidates).toEqual([]);
        const actual_rule_state = nc_lifecycle.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[lifecycle_rule.id].state;
        const expected_rule_state = { is_finished: true, key_marker: undefined, key_marker_count: undefined };
        assert_rule_state(actual_rule_state, expected_rule_state);
    });

    run_or_skip_test(IS_GPFS)('get_candidates_by_expiration_rule_gpfs - expire by days, expire by days, some objects should expire', async () => {
        const lifecycle_rule = lifecycle_rule_base;
        lifecycle_rule.expiration = { days: two_days_ago };
        const expired_file_path = path.join(mock_bucket_json.path, 'expired_file.txt');
        const unexpired_file_path = path.join(mock_bucket_json.path, 'unexpired_file.txt');

        await create_file(fs_context, expired_file_path, 'expired mock content');
        await create_file(fs_context, unexpired_file_path, 'unexpired mock content');

        const candidates = await nc_lifecycle.get_candidates_by_expiration_rule_gpfs(lifecycle_rule, mock_bucket_json);
        expect(candidates).toEqual([{ key: expired_file_path }]);
        const actual_rule_state = nc_lifecycle.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[lifecycle_rule.id].state;
        const expected_rule_state = { is_finished: true, key_marker: undefined, key_marker_count: undefined };
        assert_rule_state(actual_rule_state, expected_rule_state);
    });
    // TODO - add more with more than 1000 objects and check the key marker etc
});

describe('convert_lifecycle_policy_to_gpfs_ilm_policy unit tests', () => {
    const tags = [{ key: 'key1', value: 'val1' }, { key: 'key3', value: 'val4' }];
    const object_size_greater_than = 5;
    const object_size_less_than = 10;
    const lifecycle_rule_base = default_lifecycle_rule;

    it('convert_lifecycle_policy_to_gpfs_ilm_policy - expire date + filter empty', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, expiration: { date: new Date() } };
        const actual_ilm_policy = nc_lifecycle.convert_lifecycle_policy_to_gpfs_ilm_policy(lifecycle_rule, mock_bucket_json);
        const expected_ilm_policy = get_mock_base_ilm_policy(bucket_path, lifecycle_rule_base.id, nc_lifecycle.lifecycle_run_status) +
            get_expected_ilm_expiry(undefined, bucket_path);
        expect(actual_ilm_policy).toBe(expected_ilm_policy);
    });

    it('convert_lifecycle_policy_to_gpfs_ilm_policy - expire days + filter empty', () => {
        const lifecycle_rule = { ...lifecycle_rule_base, expiration: { days } };
        const actual_ilm_policy = nc_lifecycle.convert_lifecycle_policy_to_gpfs_ilm_policy(lifecycle_rule, mock_bucket_json);
        const expected_ilm_policy = get_mock_base_ilm_policy(bucket_path, lifecycle_rule_base.id, nc_lifecycle.lifecycle_run_status) +
            get_expected_ilm_expiry(days, bucket_path);
        expect(actual_ilm_policy).toBe(expected_ilm_policy);
    });

    it('convert_lifecycle_policy_to_gpfs_ilm_policy - expire date + filter with prefix + size gt + size lt + tags', () => {
        const lifecycle_rule = {
            ...lifecycle_rule_base,
            expiration: { date: new Date() },
            filter: { prefix, object_size_greater_than, object_size_less_than, tags }
        };
        const actual_ilm_policy = nc_lifecycle.convert_lifecycle_policy_to_gpfs_ilm_policy(lifecycle_rule, mock_bucket_json);
        const expected_ilm_policy = get_mock_base_ilm_policy(bucket_path, lifecycle_rule_base.id, nc_lifecycle.lifecycle_run_status) +
            get_expected_ilm_expiry(undefined, bucket_path) +
            get_expected_ilm_prefix(bucket_path, prefix) +
            get_expected_ilm_size_greater_than(object_size_greater_than) +
            get_expected_ilm_size_less_than(object_size_less_than) +
            get_expected_ilm_tags(tags);
        expect(actual_ilm_policy).toBe(expected_ilm_policy);
    });

    it('convert_lifecycle_policy_to_gpfs_ilm_policy - expire days + filter with prefix + size gt + size lt + tags', () => {
        const lifecycle_rule = {
            ...lifecycle_rule_base,
            expiration: { days },
            filter: { prefix, object_size_greater_than, object_size_less_than, tags }
        };
        const actual_ilm_policy = nc_lifecycle.convert_lifecycle_policy_to_gpfs_ilm_policy(lifecycle_rule, mock_bucket_json);
        const expected_ilm_policy = get_mock_base_ilm_policy(bucket_path, lifecycle_rule_base.id, nc_lifecycle.lifecycle_run_status) +
            get_expected_ilm_expiry(days, bucket_path) +
            get_expected_ilm_prefix(bucket_path, prefix) +
            get_expected_ilm_size_greater_than(object_size_greater_than) +
            get_expected_ilm_size_less_than(object_size_less_than) +
            get_expected_ilm_tags(tags);
        expect(actual_ilm_policy).toBe(expected_ilm_policy);
    });
});

describe('parse_candidates_from_gpfs_ilm_policy unit tests', () => {
    const lifecycle_rule_base = default_lifecycle_rule;
    const candidates_path = path.join(TMP_PATH, 'mock_candidates_file');

    beforeEach(() => {
        nc_lifecycle.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[lifecycle_rule_base.id].state = {};
    });

    afterEach(async () => {
        await file_delete(candidates_path);
    });

    run_or_skip_test(IS_GPFS)('parse_candidates_from_gpfs_ilm_policy - candidates file is empty', async () => {
        const lifecycle_rule = lifecycle_rule_base;
        const candidates = await nc_lifecycle.parse_candidates_from_gpfs_ilm_policy(mock_bucket_json, lifecycle_rule, candidates_path);
        expect(candidates).toEqual([]);
    });

    run_or_skip_test(IS_GPFS)('parse_candidates_from_gpfs_ilm_policy - candidates file contains less than 1000 files', async () => {
        const lifecycle_rule = lifecycle_rule_base;
        const expected_expired_objects_list = await create_mock_candidates_file(candidates_path, 'file_parse', 600);
        const candidates = await nc_lifecycle.parse_candidates_from_gpfs_ilm_policy(mock_bucket_json, lifecycle_rule, candidates_path);
        expect(candidates).toEqual(expected_expired_objects_list);
        const actual_rule_state = nc_lifecycle.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[lifecycle_rule.id].state;
        const expected_rule_state = { is_finished: true, key_marker: undefined, key_marker_count: undefined };
        assert_rule_state(actual_rule_state, expected_rule_state);
    });

    run_or_skip_test(IS_GPFS)('parse_candidates_from_gpfs_ilm_policy - candidates file contains more than 1000 files', async () => {
        const lifecycle_rule = lifecycle_rule_base;
        const expected_expired_objects_list = await create_mock_candidates_file(candidates_path, 'file_parse', 1500);
        const candidates = await nc_lifecycle.parse_candidates_from_gpfs_ilm_policy(mock_bucket_json, lifecycle_rule, candidates_path);
        expect(candidates).toEqual(expected_expired_objects_list);
        const actual_rule_state = nc_lifecycle.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[lifecycle_rule.id].state;
        const expected_rule_state = { is_finished: false, key_marker: expected_expired_objects_list[1001].path, key_marker_count: 1001 };
        assert_rule_state(actual_rule_state, expected_rule_state);
    });

    run_or_skip_test(IS_GPFS)('parse_candidates_from_gpfs_ilm_policy - candidates file contains more than 1000 files', async () => {
        const lifecycle_rule = lifecycle_rule_base;
        const expected_expired_objects_list = await create_mock_candidates_file(candidates_path, 'file_parse', 2500);
        nc_lifecycle.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[lifecycle_rule.id].state = {
            is_finished: false, key_marker: expected_expired_objects_list[1001].key, key_marker_count: 1001
        };
        const candidates = await nc_lifecycle.parse_candidates_from_gpfs_ilm_policy(mock_bucket_json, lifecycle_rule, candidates_path);
        expect(candidates).toEqual(expected_expired_objects_list);
        const actual_rule_state = nc_lifecycle.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[lifecycle_rule.id].state;
        const expected_rule_state = { is_finished: false, key_marker: expected_expired_objects_list[2001].key, key_marker_count: 2001 };
        assert_rule_state(actual_rule_state, expected_rule_state);
    });

    run_or_skip_test(IS_GPFS)('parse_candidates_from_gpfs_ilm_policy - candidates file contains more than 1000 files', async () => {
        const lifecycle_rule = lifecycle_rule_base;
        const expected_expired_objects_list = await create_mock_candidates_file(candidates_path, 'file_parse', 2500);
        nc_lifecycle.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[lifecycle_rule.id].state = {
            is_finished: false, key_marker: expected_expired_objects_list[2001].key, key_marker_count: 2001
        };
        const candidates = await nc_lifecycle.parse_candidates_from_gpfs_ilm_policy(mock_bucket_json, lifecycle_rule, candidates_path);
        expect(candidates).toEqual(expected_expired_objects_list);
        const actual_rule_state = nc_lifecycle.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[lifecycle_rule.id].state;
        const expected_rule_state = { is_finished: true, key_marker: undefined, key_marker_count: undefined };
        assert_rule_state(actual_rule_state, expected_rule_state);
    });
});

/**
 * 
 * @param {String} candidates_path 
 * @param {String} file_prefix 
 * @param {Number} num_of_expired_objects 
 * @return {Promise<Object[]>}
 */
async function create_mock_candidates_file(candidates_path, file_prefix, num_of_expired_objects) {
    const res = [];
    for (let i = 0; i < num_of_expired_objects; i++) {
        const file_path = file_prefix + i;
        await fs.promises.appendFile(candidates_path, file_path + '\n');
        res.push({ key: file_path });
    }
    return res;
}
/**
 * get_mock_base_ilm_policy returns the base ilm policy for testing
 * @param {String} bucket_storage_path 
 * @param {String} rule_id 
 * @returns 
 */
function get_mock_base_ilm_policy(bucket_storage_path, rule_id, lifecycle_run_status) {
    const definitions_base = `define( mod_age, (DAYS(CURRENT_TIMESTAMP) - DAYS(MODIFICATION_TIME)) )\n` +
        `define( change_age, (DAYS(CURRENT_TIMESTAMP) - DAYS(CHANGE_TIME)) )\n`;
    const escaped_bucket_storage_path = get_escaped_string(bucket_storage_path);
    const policy_rule_id = `${bucket_name}_${rule_id}_${lifecycle_run_status.lifecycle_run_times.run_lifecycle_start_time}`;
    const policy_base = `RULE '${policy_rule_id}' LIST '${policy_rule_id}'\n` +
    `WHERE PATH_NAME LIKE '${escaped_bucket_storage_path}/%' ${escape_backslash_str}\n` +
    `AND PATH_NAME NOT LIKE '${escaped_bucket_storage_path}/${config.NSFS_TEMP_DIR_NAME}%/%' ${escape_backslash_str}\n`;

    return definitions_base + policy_base;
}

/**
 * get_expected_ilm_expiry returns the expected ilm policy of expiry days
 * @param {number} expiry_days 
 * @param {String} bucket_storage_path 
 * @returns {String}
 */
function get_expected_ilm_expiry(expiry_days, bucket_storage_path) {
    const escaped_bucket_storage_path = get_escaped_string(bucket_storage_path);
    const path_policy = `AND PATH_NAME NOT LIKE '${escaped_bucket_storage_path}/.versions/%' ${escape_backslash_str}\n` +
        `AND PATH_NAME NOT LIKE '${escaped_bucket_storage_path}/%/.versions/%' ${escape_backslash_str}\n`;
    const expiration_policy = expiry_days ? `AND mod_age > ${expiry_days}\n` : '';
    return path_policy + expiration_policy;
}

/**
 * get_expected_ilm_prefix returns the expected ilm policy of filter prefix
 * @param {String} bucket_storage_path 
 * @param {String} obj_prefix 
 * @returns {String}
 */
function get_expected_ilm_prefix(bucket_storage_path, obj_prefix) {
    const escaped_bucket_storage_path = get_escaped_string(bucket_storage_path);
    const escaped_obj_prefix = get_escaped_string(obj_prefix);
    return `AND PATH_NAME LIKE '${escaped_bucket_storage_path}/${escaped_obj_prefix}%' ${escape_backslash_str}\n`;
}

function get_escaped_string(str) {
    return str.replace(/_/g, '\\_').replace(/%/g, '\\%').replace(/'/g, "''");
}

/**
 * get_expected_ilm_size_less_than returns the expected ilm size greater policy of phrase
 * @param {number} size 
 * @returns {String}
 */
function get_expected_ilm_size_greater_than(size) {
    return `AND FILE_SIZE > ${size}\n`;
}

/**
 * get_expected_ilm_size_less_than returns the expected ilm size less policy of phrase
 * @param {number} size 
 * @returns {String}
 */
function get_expected_ilm_size_less_than(size) {
    return `AND FILE_SIZE < ${size}\n`;
}

/**
 * get_expected_ilm_tags returns the expected ilm tags policy phrase
 * @param {{key: string, value: string}[]} tags 
 * @returns {String}
 */
function get_expected_ilm_tags(tags) {
    return tags.map(tag => {
        const escaped_tag_val = get_escaped_string(tag.value);
        return `AND XATTR('user.noobaa.tag.${tag.key}') LIKE '${escaped_tag_val}' ${escape_backslash_str}\n`;
    }).join('');
}

/**
 * assert_rule_state asserts that the actual rule state matches the expected rule state
 * @param {{is_finished: Boolean, key_marker: String, key_marker_count: Number}} actual_rule_state 
 * @param {{is_finished: Boolean, key_marker: String, key_marker_count: Number}} expected_rule_state 
 * @returns {Void}
 */
function assert_rule_state(actual_rule_state, expected_rule_state) {
    expect(actual_rule_state.is_finished).toBe(expected_rule_state.is_finished);
    expect(actual_rule_state.key_marker).toBe(expected_rule_state.key_marker);
    expect(actual_rule_state.key_marker_count).toBe(expected_rule_state.key_marker_count);
}
