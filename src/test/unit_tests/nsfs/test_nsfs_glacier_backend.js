/* Copyright (C) 2024 NooBaa */
'use strict';

const { promises: fs } = require('fs');
const util = require('util');
const path = require('path');
const mocha = require('mocha');
const crypto = require('crypto');
const assert = require('assert');
const os = require('os');
const config = require('../../../../config');
const NamespaceFS = require('../../../sdk/namespace_fs');
const s3_utils = require('../../../endpoint/s3/s3_utils');
const buffer_utils = require('../../../util/buffer_utils');
const endpoint_stats_collector = require('../../../sdk/endpoint_stats_collector');
const { TapeCloudGlacier, TapeCloudUtils } = require('../../../sdk/glacier_tapecloud');
const { PersistentLogger } = require('../../../util/persistent_logger');
const { Glacier } = require('../../../sdk/glacier');
const { Semaphore } = require('../../../util/semaphore');
const nb_native = require('../../../util/nb_native');
const { handler: s3_get_bucket } = require('../../../endpoint/s3/ops/s3_get_bucket');
const Stream = require('stream');

const inspect = (x, max_arr = 5) => util.inspect(x, { colors: true, depth: null, maxArrayLength: max_arr });

function make_dummy_object_sdk(config_root) {
    return {
        requesting_account: {
            force_md5_etag: false,
            nsfs_account_config: {
                uid: process.getuid(),
                gid: process.getgid(),
            }
        },
        abort_controller: new AbortController(),
        throw_if_aborted() {
            if (this.abort_controller.signal.aborted) throw new Error('request aborted signal');
        },
        read_bucket_sdk_config_info(name) {
            return undefined;
        },
        read_bucket_full_info(name) {
            return {};
        }

    };
}

function generate_noobaa_req_obj() {
    return {
        query: {},
        params: {},
        headers: {},
        object_sdk: make_dummy_object_sdk(),
    };
}

/**
 * @param {Date} date - the date to be asserted
 * @param {Date} from - the date from where the offset is to be calculated
 * @param {{ day_offset: number, hour?: number, min?: number, sec?: number }} expected
 * @param {'UTC' | 'LOCAL'} [tz='LOCAL']
 */
function assert_date(date, from, expected, tz = 'LOCAL') {
    const that_if_not_this = (arg1, arg2) => {
        if (arg1 === undefined) return arg2;
        return arg1;
    };

    if (tz === 'UTC') {
        from.setUTCDate(from.getUTCDate() + expected.day_offset);

        assert(date.getUTCDate() === from.getUTCDate());
        assert(date.getUTCHours() === that_if_not_this(expected.hour, from.getUTCHours()));
        assert(date.getUTCMinutes() === that_if_not_this(expected.min, from.getUTCMinutes()));
        assert(date.getUTCSeconds() === that_if_not_this(expected.sec, from.getUTCSeconds()));
    } else {
        from.setDate(from.getDate() + expected.day_offset);

        assert(date.getDate() === from.getDate());
        assert(date.getHours() === that_if_not_this(expected.hour, from.getHours()));
        assert(date.getMinutes() === that_if_not_this(expected.min, from.getMinutes()));
        assert(date.getSeconds() === that_if_not_this(expected.sec, from.getSeconds()));
    }
}

class NoOpWriteStream extends Stream.Writable {
  _write(chunk, encoding, callback) {
    callback();
  }
}

function get_patched_backend() {
    const backend = new TapeCloudGlacier();

    // Patch backend for test
    backend._migrate = async () => true;
    backend._recall = async () => true;
    backend._process_expired = async () => null;

    return backend;
}

/* Justification: Disable max-lines-per-function for test functions
as it is not much helpful in the sense that "describe" function capture
entire test suite instead of being a logical abstraction */
/* eslint-disable max-lines-per-function */
mocha.describe('nsfs_glacier', function() {
	const src_bkt = 'nsfs_glacier_src';
    const dmapi_config_semaphore = new Semaphore(1);

	const dummy_object_sdk = make_dummy_object_sdk();
    const upload_bkt = 'test_ns_uploads_object';
	const ns_src_bucket_path = src_bkt;

	const glacier_ns = new NamespaceFS({
		bucket_path: ns_src_bucket_path,
		bucket_id: '1',
		namespace_resource_id: undefined,
		access_mode: undefined,
		versioning: undefined,
		force_md5_etag: false,
		stats: endpoint_stats_collector.instance(),
	});

	glacier_ns._is_storage_class_supported = async () => true;
    glacier_ns._glacier_force_expire_on_get = async (ctx, file_path, file, stat) => {
        // The idea is that the fs_context is derived from object_sdk in namespace_fs
        // which kind of makes it per request. This observation mixed with the mocked
        // object_sdk itself allows to perform assertions without serializing the glacier_ns
        // operations.

        // @ts-ignore
        ctx.force_expire_on_get = file_path;
    };

    const safe_dmapi_surround = async (init, cb) => {
        await dmapi_config_semaphore.surround(async () => {
            const start_value_1 = config.NSFS_GLACIER_DMAPI_ENABLE;
            const start_value_2 = config.NSFS_GLACIER_DMAPI_IMPLICIT_SC;
            const start_value_3 = config.NSFS_GLACIER_DMAPI_IMPLICIT_RESTORE_STATUS;

            config.NSFS_GLACIER_ENABLED = init;
            config.NSFS_GLACIER_DMAPI_IMPLICIT_SC = init;
            config.NSFS_GLACIER_DMAPI_IMPLICIT_RESTORE_STATUS = init;
            await cb();

            config.NSFS_GLACIER_DMAPI_ENABLE = start_value_1;
            config.NSFS_GLACIER_DMAPI_IMPLICIT_SC = start_value_2;
            config.NSFS_GLACIER_DMAPI_IMPLICIT_RESTORE_STATUS = start_value_3;
        });
    };

	mocha.before(async function() {
        await fs.mkdir(ns_src_bucket_path, { recursive: true });

        config.NSFS_GLACIER_LOGS_ENABLED = true;
		config.NSFS_GLACIER_LOGS_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfs-wal-'));

		// Replace the logger by custom one

		const migrate_wal = NamespaceFS._migrate_wal;
		NamespaceFS._migrate_wal = new PersistentLogger(
			config.NSFS_GLACIER_LOGS_DIR,
			Glacier.MIGRATE_WAL_NAME,
			{ locking: 'EXCLUSIVE', poll_interval: 10 }
		);

		if (migrate_wal) await migrate_wal.close();

		const restore_wal = NamespaceFS._restore_wal;
		NamespaceFS._restore_wal = new PersistentLogger(
			config.NSFS_GLACIER_LOGS_DIR,
			Glacier.RESTORE_WAL_NAME,
			{ locking: 'EXCLUSIVE', poll_interval: 10 }
		);

		if (restore_wal) await restore_wal.close();
	});

	mocha.describe('nsfs_glacier_tapecloud', async function() {
        const restore_key_spcl_char_1 = 'restore_key_2_\n';
        const restore_key_spcl_char_2 = 'restore_key_2_\n_2';
        const upload_key = 'upload_key_1';
        const restore_key = 'restore_key_1';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;

        const backend = get_patched_backend();

        mocha.it('upload to GLACIER should work', async function() {
            const data = crypto.randomBytes(100);
            const upload_res = await glacier_ns.upload_object({
                bucket: upload_bkt,
                key: upload_key,
                storage_class: s3_utils.STORAGE_CLASS_GLACIER,
                xattr,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);

            console.log('upload_object response', inspect(upload_res));

            // Check if the log contains the entry
            let found = false;
            await NamespaceFS.migrate_wal._process(async file => {
                const fs_context = glacier_ns.prepare_fs_context(dummy_object_sdk);
                await file.collect_and_process(async entry => {
                    if (entry.endsWith(`${upload_key}`)) {
                        found = true;

                        // Not only should the file exist, it should be ready for
                        // migration as well
                        assert(backend.should_migrate(fs_context, entry));
                    }
                });

                // Don't delete the file
                return false;
            });

            assert(found);
        });

        mocha.it('restore-object should successfully restore', async function() {
            const now = Date.now();
            const data = crypto.randomBytes(100);
            const params = {
                bucket: upload_bkt,
                key: restore_key,
                storage_class: s3_utils.STORAGE_CLASS_GLACIER,
                xattr,
                days: 1,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            };

            const upload_res = await glacier_ns.upload_object(params, dummy_object_sdk);
            console.log('upload_object response', inspect(upload_res));

            const dummy_stream_writer = new NoOpWriteStream();

            // Ensure that we can't read the object before restore
            await assert.rejects(glacier_ns.read_object_stream(params, dummy_object_sdk, dummy_stream_writer));

            const restore_res = await glacier_ns.restore_object(params, dummy_object_sdk);
            assert(restore_res);

            // Ensure that we can't read the object before restore
            await assert.rejects(glacier_ns.read_object_stream(params, dummy_object_sdk, dummy_stream_writer));

            // Issue restore
            await backend.perform(glacier_ns.prepare_fs_context(dummy_object_sdk), "RESTORE");

            // Ensure object is restored
            const md = await glacier_ns.read_object_md(params, dummy_object_sdk);

            assert(!md.restore_status.ongoing);

            const expected_expiry = Glacier.generate_expiry(new Date(), params.days, '', config.NSFS_GLACIER_EXPIRY_TZ);
            assert(expected_expiry.getTime() >= md.restore_status.expiry_time.getTime());
            assert(now <= md.restore_status.expiry_time.getTime());

            // Ensure that we can't read the object before restore
            await assert.doesNotReject(glacier_ns.read_object_stream(params, dummy_object_sdk, dummy_stream_writer));
        });

        mocha.it('restore-object should not restore failed item', async function() {
            const now = Date.now();
            const data = crypto.randomBytes(100);
            const failed_restore_key = `${restore_key}_failured`;
            const success_restore_key = `${restore_key}_success`;

            const failed_params = {
                bucket: upload_bkt,
                key: failed_restore_key,
                storage_class: s3_utils.STORAGE_CLASS_GLACIER,
                xattr,
                days: 1,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            };

            const success_params = {
                bucket: upload_bkt,
                key: success_restore_key,
                storage_class: s3_utils.STORAGE_CLASS_GLACIER,
                xattr,
                days: 1,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            };

            const failed_file_path = glacier_ns._get_file_path(failed_params);
            const success_file_path = glacier_ns._get_file_path(success_params);

            const failure_backend = new TapeCloudGlacier();
            failure_backend._migrate = async () => true;
            failure_backend._process_expired = async () => { /**noop*/ };
            failure_backend._recall = async (_file, failure_recorder, success_recorder) => {
                // This unintentionally also replicates duplicate entries in WAL
                await failure_recorder(failure_backend.encode_log(failed_file_path));

                // This unintentionally also replicates duplicate entries in WAL
                await success_recorder(failure_backend.encode_log(success_file_path));

                return false;
            };

            const upload_res_1 = await glacier_ns.upload_object(failed_params, dummy_object_sdk);
            console.log('upload_object response', inspect(upload_res_1));

            const upload_res_2 = await glacier_ns.upload_object(success_params, dummy_object_sdk);
            console.log('upload_object response', inspect(upload_res_2));

            const restore_res_1 = await glacier_ns.restore_object(failed_params, dummy_object_sdk);
            assert(restore_res_1);

            const restore_res_2 = await glacier_ns.restore_object(success_params, dummy_object_sdk);
            assert(restore_res_2);

            const fs_context = glacier_ns.prepare_fs_context(dummy_object_sdk);

            // Issue restore
            await failure_backend.perform(fs_context, "RESTORE");

            // Ensure success object is restored
            const success_md = await glacier_ns.read_object_md(success_params, dummy_object_sdk);

            assert(!success_md.restore_status.ongoing);

            const expected_expiry = Glacier.generate_expiry(new Date(), success_params.days, '', config.NSFS_GLACIER_EXPIRY_TZ);
            assert(expected_expiry.getTime() >= success_md.restore_status.expiry_time.getTime());
            assert(now <= success_md.restore_status.expiry_time.getTime());

            // Ensure failed object is NOT restored
            const failure_stats = await nb_native().fs.stat(
                fs_context,
                failed_file_path,
            );

            assert(!failure_stats.xattr[Glacier.XATTR_RESTORE_EXPIRY] || failure_stats.xattr[Glacier.XATTR_RESTORE_EXPIRY] === '');
            assert(failure_stats.xattr[Glacier.XATTR_RESTORE_REQUEST]);
        });

        mocha.it('restore-object should successfully restore objects with special characters', async function() {
            // eslint-disable-next-line no-invalid-this
            this.timeout(5000);

            const now = Date.now();
            const data = crypto.randomBytes(100);
            const all_params = [
                {
                    bucket: upload_bkt,
                    key: restore_key_spcl_char_1,
                    storage_class: s3_utils.STORAGE_CLASS_GLACIER,
                    xattr,
                    days: 1,
                    source_stream: buffer_utils.buffer_to_read_stream(data)
                },
                {
                    bucket: upload_bkt,
                    key: restore_key_spcl_char_2,
                    storage_class: s3_utils.STORAGE_CLASS_GLACIER,
                    xattr,
                    days: 1,
                    source_stream: buffer_utils.buffer_to_read_stream(data)
                }
            ];

            for (const params of all_params) {
                const upload_res = await glacier_ns.upload_object(params, dummy_object_sdk);
                console.log('upload_object response', inspect(upload_res));

                const restore_res = await glacier_ns.restore_object(params, dummy_object_sdk);
                assert(restore_res);

                // Issue restore
                await backend.perform(glacier_ns.prepare_fs_context(dummy_object_sdk), "RESTORE");


                // Ensure object is restored
                const md = await glacier_ns.read_object_md(params, dummy_object_sdk);

                assert(!md.restore_status.ongoing);

                const expected_expiry = Glacier.generate_expiry(new Date(), params.days, '', config.NSFS_GLACIER_EXPIRY_TZ);
                assert(expected_expiry.getTime() >= md.restore_status.expiry_time.getTime());
                assert(now <= md.restore_status.expiry_time.getTime());
            }
        });

        mocha.it('restore-object should not restore failed item with special characters', async function() {
            const now = Date.now();
            const data = crypto.randomBytes(100);
            const failed_restore_key = `${restore_key_spcl_char_1}_failured`;
            const success_restore_key = `${restore_key_spcl_char_1}_success`;

            const failed_params = {
                bucket: upload_bkt,
                key: failed_restore_key,
                storage_class: s3_utils.STORAGE_CLASS_GLACIER,
                xattr,
                days: 1,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            };

            const success_params = {
                bucket: upload_bkt,
                key: success_restore_key,
                storage_class: s3_utils.STORAGE_CLASS_GLACIER,
                xattr,
                days: 1,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            };

            const failed_file_path = glacier_ns._get_file_path(failed_params);
            const success_file_path = glacier_ns._get_file_path(success_params);

            const failure_backend = new TapeCloudGlacier();
            failure_backend._migrate = async () => true;
            failure_backend._process_expired = async () => { /**noop*/ };
            failure_backend._recall = async (_file, failure_recorder, success_recorder) => {
                // This unintentionally also replicates duplicate entries in WAL
                await failure_recorder(failure_backend.encode_log(failed_file_path));

                // This unintentionally also replicates duplicate entries in WAL
                await success_recorder(failure_backend.encode_log(success_file_path));

                return false;
            };

            const upload_res_1 = await glacier_ns.upload_object(failed_params, dummy_object_sdk);
            console.log('upload_object response', inspect(upload_res_1));

            const upload_res_2 = await glacier_ns.upload_object(success_params, dummy_object_sdk);
            console.log('upload_object response', inspect(upload_res_2));

            const restore_res_1 = await glacier_ns.restore_object(failed_params, dummy_object_sdk);
            assert(restore_res_1);

            const restore_res_2 = await glacier_ns.restore_object(success_params, dummy_object_sdk);
            assert(restore_res_2);

            const fs_context = glacier_ns.prepare_fs_context(dummy_object_sdk);

            // Issue restore
            await failure_backend.perform(glacier_ns.prepare_fs_context(dummy_object_sdk), "RESTORE");

            // Ensure success object is restored
            const success_md = await glacier_ns.read_object_md(success_params, dummy_object_sdk);

            assert(!success_md.restore_status.ongoing);

            const expected_expiry = Glacier.generate_expiry(new Date(), success_params.days, '', config.NSFS_GLACIER_EXPIRY_TZ);
            assert(expected_expiry.getTime() >= success_md.restore_status.expiry_time.getTime());
            assert(now <= success_md.restore_status.expiry_time.getTime());

            // Ensure failed object is NOT restored
            const failure_stats = await nb_native().fs.stat(
                fs_context,
                failed_file_path,
            );

            assert(!failure_stats.xattr[Glacier.XATTR_RESTORE_EXPIRY] || failure_stats.xattr[Glacier.XATTR_RESTORE_EXPIRY] === '');
            assert(failure_stats.xattr[Glacier.XATTR_RESTORE_REQUEST]);
        });

        mocha.it('_finalize_restore should tolerate deleted objects', async function() {
            // should not throw error if the path does not exist
            await backend._finalize_restore(glacier_ns.prepare_fs_context(dummy_object_sdk), '/path/does/not/exist');
        });

        mocha.it('generate_expiry should round up the expiry', function() {
            const now = new Date();
            const pivot_time = new Date(now);

            const exp1 = Glacier.generate_expiry(now, 1, '', 'UTC');
            assert_date(exp1, now, { day_offset: 1 }, 'UTC');

            const exp2 = Glacier.generate_expiry(now, 10, '', 'UTC');
            assert_date(exp2, now, { day_offset: 10 }, 'UTC');

            const exp3 = Glacier.generate_expiry(now, 10, '02:05:00', 'UTC');
            pivot_time.setUTCHours(2, 5, 0, 0);
            if (now <= pivot_time) {
                assert_date(exp3, now, { day_offset: 10, hour: 2, min: 5, sec: 0 }, 'UTC');
            } else {
                assert_date(exp3, now, { day_offset: 10 + 1, hour: 2, min: 5, sec: 0 }, 'UTC');
            }

            const exp4 = Glacier.generate_expiry(now, 1, '02:05:00', 'LOCAL');
            pivot_time.setHours(2, 5, 0, 0);
            if (now <= pivot_time) {
                assert_date(exp4, now, { day_offset: 1, hour: 2, min: 5, sec: 0 }, 'LOCAL');
            } else {
                assert_date(exp4, now, { day_offset: 1 + 1, hour: 2, min: 5, sec: 0 }, 'LOCAL');
            }

            const exp5 = Glacier.generate_expiry(now, 1, `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`, 'LOCAL');
            assert_date(exp5, now, { day_offset: 1 }, 'LOCAL');

            const some_date = new Date("2004-05-08");
            const exp6 = Glacier.generate_expiry(some_date, 1.5, `02:05:00`, 'UTC');
            assert_date(exp6, some_date, { day_offset: 1 + 1, hour: 2, min: 5, sec: 0 }, 'UTC');
        });

        mocha.it('object should be marked externally managed when DMAPI is enabled and xattrs are present', async function() {
            await safe_dmapi_surround(true, async () => {
                let is_external = Glacier.is_externally_managed({
                    [Glacier.GPFS_DMAPI_XATTR_TAPE_PREMIG]: 'some-value',
                });
                assert.strictEqual(is_external, true);

                is_external = Glacier.is_externally_managed({
                    [Glacier.GPFS_DMAPI_XATTR_TAPE_INDICATOR]: 'some-value',
                });
                assert.strictEqual(is_external, true);

                is_external = Glacier.is_externally_managed({
                    [Glacier.GPFS_DMAPI_XATTR_TAPE_INDICATOR]: 'some-value',
                    [Glacier.STORAGE_CLASS_XATTR]: s3_utils.STORAGE_CLASS_GLACIER,
                });
                assert.strictEqual(is_external, false);

                is_external = Glacier.is_externally_managed({});
                assert.strictEqual(is_external, false);
            });
        });

        mocha.it('restore_status should return max expiry when DMAPI is enabled and DMAPI xattr is set', async function() {
            const now = new Date();
            const expected_expiry = new Date(now);
            expected_expiry.setDate(expected_expiry.getDate() + config.NSFS_GLACIER_DMAPI_PMIG_DAYS);

            await safe_dmapi_surround(true, async () => {
                const status = Glacier.get_restore_status({
                    [Glacier.GPFS_DMAPI_XATTR_TAPE_INDICATOR]: 'some-value',
                    [Glacier.GPFS_DMAPI_XATTR_TAPE_PREMIG]: 'some-value',
                }, now, '');
                assert(status.state === 'RESTORED');
                assert(status.ongoing === false);
                assert(status.expiry_time.getDate() === expected_expiry.getDate());
            });
        });

        mocha.it('object should expire after first complete read when force eviction is set to true', async function() {
            const data = crypto.randomBytes(100);
            const key = `${restore_key}_force_evict`;
            const params = {
                bucket: upload_bkt,
                key,
                storage_class: s3_utils.STORAGE_CLASS_GLACIER,
                xattr,
                days: 1,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            };

            const upload_res = await glacier_ns.upload_object(params, dummy_object_sdk);
            console.log('upload_object response', inspect(upload_res));

            const restore_res = await glacier_ns.restore_object(params, dummy_object_sdk);
            assert(restore_res);

            await backend.perform(glacier_ns.prepare_fs_context(dummy_object_sdk), "RESTORE");

            const nullWriter = new NoOpWriteStream();
            const eviction_dummy_object_sdk = make_dummy_object_sdk();
            await glacier_ns.read_object_stream(params, eviction_dummy_object_sdk, nullWriter);

            // Ensure that the object was marked for eviction
            assert(eviction_dummy_object_sdk
                    .requesting_account
                    ?.nsfs_account_config
                    ?.force_expire_on_get === glacier_ns._get_file_path({ key }));
        });

        mocha.it('object should not expire during ranged reads when force eviction is set to true', async function() {
            const data = crypto.randomBytes(100);
            const key = `${restore_key}_force_evict_2`;
            const params = {
                bucket: upload_bkt,
                key,
                storage_class: s3_utils.STORAGE_CLASS_GLACIER,
                xattr,
                days: 1,
                source_stream: buffer_utils.buffer_to_read_stream(data),
                start: 5,
            };

            const upload_res = await glacier_ns.upload_object(params, dummy_object_sdk);
            console.log('upload_object response', inspect(upload_res));

            const restore_res = await glacier_ns.restore_object(params, dummy_object_sdk);
            assert(restore_res);

            await backend.perform(glacier_ns.prepare_fs_context(dummy_object_sdk), "RESTORE");

            const eviction_dummy_object_sdk = make_dummy_object_sdk();

            await glacier_ns.read_object_stream(params, eviction_dummy_object_sdk, new NoOpWriteStream());
            assert(eviction_dummy_object_sdk.requesting_account?.nsfs_account_config?.force_expire_on_get === undefined);

            await glacier_ns.read_object_stream({
                ...params, start: undefined, end: 5
            }, eviction_dummy_object_sdk, new NoOpWriteStream());
            assert(eviction_dummy_object_sdk.requesting_account?.nsfs_account_config?.force_expire_on_get === undefined);

            await glacier_ns.read_object_stream({
                ...params, start: undefined, end: data.length - 1
            }, eviction_dummy_object_sdk, new NoOpWriteStream());
            assert(eviction_dummy_object_sdk.requesting_account?.nsfs_account_config?.force_expire_on_get === undefined);

            await glacier_ns.read_object_stream({
                ...params, start: 0, end: data.length
            }, eviction_dummy_object_sdk, new NoOpWriteStream());
            assert(eviction_dummy_object_sdk
                    .requesting_account
                    ?.nsfs_account_config
                    ?.force_expire_on_get === glacier_ns._get_file_path({ key }));
        });
    });

    mocha.describe('nsfs_glacier_s3_flow', async function() {
        mocha.it('list_objects should throw error with incorrect optional object attributes', async function() {
            const req = generate_noobaa_req_obj();
            req.params.bucket = src_bkt;
            req.headers['x-amz-optional-object-attributes'] = 'restorestatus';
            assert.rejects(async () => s3_get_bucket(req));
        });

        mocha.it('list_objects should not return restore status when optional object attr header isn\'t given', async function() {
            const req = generate_noobaa_req_obj();
            req.params.bucket = src_bkt;
            req.object_sdk.list_objects = params => glacier_ns.list_objects(params, dummy_object_sdk);

            const res = await s3_get_bucket(req);
            const objs = res.ListBucketResult[1];
            assert.strictEqual(objs instanceof Array, true);

            // @ts-ignore
            objs.forEach(obj => {
                assert.strictEqual(obj.RestoreStatus, undefined);
            });
        });

        mocha.it('list_objects should return restore status for the objects when requested', async function() {
            const req = generate_noobaa_req_obj();
            req.params.bucket = src_bkt;
            req.headers['x-amz-optional-object-attributes'] = 'RestoreStatus';
            req.object_sdk.list_objects = params => glacier_ns.list_objects(params, dummy_object_sdk);

            const res = await s3_get_bucket(req);
            const objs = res.ListBucketResult[1];
            assert.strictEqual(objs instanceof Array, true);

            const fs_context = glacier_ns.prepare_fs_context(dummy_object_sdk);

            await Promise.all(
                // @ts-ignore
                objs.map(async obj => {
                    // obj.Key will be the same as original key for as long as
                    // no custom encoding is provided
                    const file_path = glacier_ns._get_file_path({ key: obj.Contents.Key });
                    const stat = await nb_native().fs.stat(fs_context, file_path);

                    // @ts-ignore
                    const glacier_status = Glacier.get_restore_status(stat.xattr, new Date(), file_path);
                    if (glacier_status === undefined) {
                        assert.strictEqual(obj.Contents.RestoreStatus, undefined);
                    } else {
                        assert.strictEqual(obj.Contents.RestoreStatus.IsRestoreInProgress, glacier_status.ongoing);
                        if (glacier_status.expiry_time === undefined) {
                            assert.strictEqual(obj.Contents.RestoreStatus.RestoreExpiryDate, undefined);
                        }
                    }
                })
            );
        });
    });

    mocha.after(async function() {
        await Promise.all([
            fs.rm(ns_src_bucket_path, { recursive: true, force: true }),
            fs.rm(config.NSFS_GLACIER_LOGS_DIR, { recursive: true, force: true }),
        ]);
    });

    mocha.describe('tapecloud_utils', function() {
        const MOCK_TASK_SHOW_DATA = `Random irrelevant data to
Result    Failure Code  Failed time               Node -- File name
Fail      GLESM451W     2023/11/08T02:38:47          1 -- /ibm/gpfs/NoobaaTest/file.aaai
Fail      GLESM451W     2023/11/08T02:38:47          1 -- /ibm/gpfs/NoobaaTest/file.aaaj
Fail      GLESL401E     2023/11/08T02:38:44          1 -- /ibm/gpfs/NoobaaTest/noobaadata
Fail      GLESL400E     2023/11/08T02:38:44          1 -- /ibm/gpfs/NoobaaTest/noobaadata2
Success   -             -                            - -- /ibm/gpfs/NoobaaTest/testingdata/file.aaaa
Success   -             -                            - -- /ibm/gpfs/NoobaaTest/testingdata/file.aaab
Success   -             -                            - -- /ibm/gpfs/NoobaaTest/testingdata/file.aaaj`;

        const MOCK_TASK_SHOW_SCRIPT = `#!/bin/bash
cat <<EOF | tee
${MOCK_TASK_SHOW_DATA}
EOF`;

        const init_tapedir_bin = config.NSFS_GLACIER_TAPECLOUD_BIN_DIR;
        const tapecloud_bin_temp = path.join(os.tmpdir(), 'tapecloud-bin-dir-');

        mocha.before(async function() {
            config.NSFS_GLACIER_TAPECLOUD_BIN_DIR = await fs.mkdtemp(tapecloud_bin_temp);

            await fs.writeFile(
                path.join(config.NSFS_GLACIER_TAPECLOUD_BIN_DIR, TapeCloudUtils.TASK_SHOW_SCRIPT),
                MOCK_TASK_SHOW_SCRIPT,
            );

            await fs.chmod(path.join(config.NSFS_GLACIER_TAPECLOUD_BIN_DIR, TapeCloudUtils.TASK_SHOW_SCRIPT), 0o777);
        });

        mocha.it('record_task_status', async function() {
            // /ibm/gpfs/NoobaaTest/noobaadata2 would not be part of failed case however wouldn't
            // be part of success case either as it must be ignored
            const expected_failed_records = [
                '/ibm/gpfs/NoobaaTest/file.aaai',
                '/ibm/gpfs/NoobaaTest/file.aaaj',
                '/ibm/gpfs/NoobaaTest/noobaadata',
            ];
            const expected_success_records = [
                '/ibm/gpfs/NoobaaTest/testingdata/file.aaaa',
                '/ibm/gpfs/NoobaaTest/testingdata/file.aaab',
                '/ibm/gpfs/NoobaaTest/testingdata/file.aaaj',
            ];

            const failed_records = [];
            const success_records = [];

            await TapeCloudUtils.record_task_status(
                0,
                async record => {
                    failed_records.push(record);
                },
                async record => {
                    success_records.push(record);
                },
            );

            assert.deepStrictEqual(failed_records, expected_failed_records);
            assert.deepStrictEqual(success_records, expected_success_records);

            // Clear out the arrays
            failed_records.length = 0;
            success_records.length = 0;

            await TapeCloudUtils.record_task_status(
                0,
                async record => {
                    failed_records.push(record);
                }
            );

            assert.deepStrictEqual(failed_records, expected_failed_records);
            assert.deepStrictEqual(success_records, []);
        });

        mocha.after(async function() {
            config.NSFS_GLACIER_TAPECLOUD_BIN_DIR = init_tapedir_bin;

            await fs.rm(tapecloud_bin_temp, { recursive: true, force: true });
        });
    });

    mocha.describe('glacier_utils', function() {
        const sample_tape_info = [
            "1 TX0005L9@a83383e7-76d8-4c63-a875-f0d20ec80422@3608e794-53ab-4ba1-aafe-37d044162c17",
            "1 TX0005L9@a83383e7-76d8-4c63-a875-f0d20ec80422@3608e794-53ab-4ba1-aafe-37d044162c17:TX0005L0@a83383e7-76d8-4c63-a875-f0d20ec80423@3608e794-53ab-4ba1-aafe-37d044162c19"
        ];

        mocha.it('parse_tape_info with one pool', async function() {
            /** @type {nb.NativeFSXattr} */
            const xattr = {
                [Glacier.GPFS_DMAPI_XATTR_TAPE_TPS]: sample_tape_info[0],
            };

            const tape_infos = Glacier.parse_tape_info(xattr);
            assert.strictEqual(tape_infos.length, 1);
            assert.strictEqual(tape_infos[0].volser, "TX0005L9");
            assert.strictEqual(tape_infos[0].poolid, "a83383e7-76d8-4c63-a875-f0d20ec80422");
            assert.strictEqual(tape_infos[0].libid, "3608e794-53ab-4ba1-aafe-37d044162c17");
        });

        mocha.it('parse_tape_info with two pools', async function() {
            /** @type {nb.NativeFSXattr} */
            const xattr = {
                [Glacier.GPFS_DMAPI_XATTR_TAPE_TPS]: sample_tape_info[1],
            };

            const tape_infos = Glacier.parse_tape_info(xattr);
            assert.strictEqual(tape_infos.length, 2);

            assert.strictEqual(tape_infos[0].volser, "TX0005L9");
            assert.strictEqual(tape_infos[0].poolid, "a83383e7-76d8-4c63-a875-f0d20ec80422");
            assert.strictEqual(tape_infos[0].libid, "3608e794-53ab-4ba1-aafe-37d044162c17");

            assert.strictEqual(tape_infos[1].volser, "TX0005L0");
            assert.strictEqual(tape_infos[1].poolid, "a83383e7-76d8-4c63-a875-f0d20ec80423");
            assert.strictEqual(tape_infos[1].libid, "3608e794-53ab-4ba1-aafe-37d044162c19");
        });
    });
});
