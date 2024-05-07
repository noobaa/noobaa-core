/* Copyright (C) 2024 NooBaa */
'use strict';

const fs = require('fs');
const util = require('util');
const path = require('path');
const mocha = require('mocha');
const crypto = require('crypto');
const assert = require('assert');
const os = require('os');
const config = require('../../../config');
const NamespaceFS = require('../../sdk/namespace_fs');
const s3_utils = require('../../endpoint/s3/s3_utils');
const buffer_utils = require('../../util/buffer_utils');
const endpoint_stats_collector = require('../../sdk/endpoint_stats_collector');
const { NewlineReader } = require('../../util/file_reader');
const { TapeCloudGlacierBackend } = require('../../sdk/nsfs_glacier_backend/tapecloud');
const { PersistentLogger } = require('../../util/persistent_logger');
const { GlacierBackend } = require('../../sdk/nsfs_glacier_backend/backend');

const mkdtemp = util.promisify(fs.mkdtemp);
const inspect = (x, max_arr = 5) => util.inspect(x, { colors: true, depth: null, maxArrayLength: max_arr });

function make_dummy_object_sdk() {
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
        }
    };
}

mocha.describe('nsfs_glacier', async () => {
	const src_bkt = 'src';

	const dummy_object_sdk = make_dummy_object_sdk();
    const upload_bkt = 'test_ns_uploads_object';
	const ns_src_bucket_path = `./${src_bkt}`;

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

	mocha.before(async () => {
		config.NSFS_GLACIER_LOGS_DIR = await mkdtemp(path.join(os.tmpdir(), 'nsfs-wal-'));

		// Replace the logger by custom one

		const migrate_wal = NamespaceFS._migrate_wal;
		NamespaceFS._migrate_wal = new PersistentLogger(
			config.NSFS_GLACIER_LOGS_DIR,
			GlacierBackend.MIGRATE_WAL_NAME,
			{ locking: 'EXCLUSIVE', poll_interval: 10 }
		);

		if (migrate_wal) await migrate_wal.close();

		const restore_wal = NamespaceFS._restore_wal;
		NamespaceFS._restore_wal = new PersistentLogger(
			config.NSFS_GLACIER_LOGS_DIR,
			GlacierBackend.RESTORE_WAL_NAME,
			{ locking: 'EXCLUSIVE', poll_interval: 10 }
		);

		if (restore_wal) await restore_wal.close();
	});

	mocha.describe('nsfs_glacier_tapecloud', async () => {
        const upload_key = 'upload_key_1';
        const restore_key = 'restore_key_1';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;

		const backend = new TapeCloudGlacierBackend();

		// Patch backend for test
		backend._migrate = async () => { /**noop */ };
		backend._recall = async () => { /**noop */ };
		backend._process_expired = async () => { /**noop*/ };

		mocha.it('upload to GLACIER should work', async () => {
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
				const reader = new NewlineReader(fs_context, file, 'EXCLUSIVE');

				await reader.forEachFilePathEntry(async entry => {
					if (entry.path.endsWith(`${upload_key}`)) {
						found = true;

						// Not only should the file exist, it should be ready for
						// migration as well
						assert(backend.should_migrate(fs_context, entry.path));
					}

					return true;
				});

				// Don't delete the file
				return false;
			});

			assert(found);
		});

		mocha.it('restore-object should successfully restore', async () => {
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

			const restore_res = await glacier_ns.restore_object(params, dummy_object_sdk);
			assert(restore_res);

			// Issue restore
			await NamespaceFS.restore_wal._process(async file => {
				const fs_context = glacier_ns.prepare_fs_context(dummy_object_sdk);
				await backend.restore(fs_context, file);

				// Don't delete the file
				return false;
			});

			// Ensure object is restored
			const md = await glacier_ns.read_object_md(params, dummy_object_sdk);

			assert(!md.restore_status.ongoing);

			const expected_expiry = GlacierBackend.generate_expiry(new Date(), params.days, '', config.NSFS_GLACIER_EXPIRY_TZ);
			assert(expected_expiry.getTime() >= md.restore_status.expiry_time.getTime());
			assert(now <= md.restore_status.expiry_time.getTime());
		});

        mocha.it('generate_expiry should round up the expiry', () => {
            const now = new Date();
            const midnight = new Date();
            midnight.setUTCHours(0, 0, 0, 0);

            const exp1 = GlacierBackend.generate_expiry(now, 1, '', 'UTC');
            assert(exp1.getUTCDate() === now.getUTCDate() + 1);
            assert(exp1.getUTCHours() === now.getUTCHours());
            assert(exp1.getUTCMinutes() === now.getUTCMinutes());
            assert(exp1.getUTCSeconds() === now.getUTCSeconds());

            const exp2 = GlacierBackend.generate_expiry(now, 10, '', 'UTC');
            assert(exp2.getUTCDate() === now.getUTCDate() + 10);
            assert(exp2.getUTCHours() === now.getUTCHours());
            assert(exp2.getUTCMinutes() === now.getUTCMinutes());
            assert(exp2.getUTCSeconds() === now.getUTCSeconds());

            const pivot_time = new Date(now);

            const exp3 = GlacierBackend.generate_expiry(now, 10, '02:05:00', 'UTC');
            pivot_time.setUTCHours(2, 5, 0, 0);

            if (now <= pivot_time) {
                assert(exp3.getUTCDate() === now.getUTCDate() + 10);
            } else {
                assert(exp3.getUTCDate() === now.getUTCDate() + 10 + 1);
            }
            assert(exp3.getUTCHours() === 2);
            assert(exp3.getUTCMinutes() === 5);
            assert(exp3.getUTCSeconds() === 0);

            const exp4 = GlacierBackend.generate_expiry(now, 1, '02:05:00', 'LOCAL');
            pivot_time.setHours(2, 5, 0, 0);

            if (now <= pivot_time) {
                assert(exp4.getDate() === now.getDate() + 1);
            } else {
                assert(exp4.getDate() === now.getDate() + 1 + 1);
            }
            assert(exp4.getHours() === 2);
            assert(exp4.getMinutes() === 5);
            assert(exp4.getSeconds() === 0);

            const exp5 = GlacierBackend.generate_expiry(now, 1, `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`, 'LOCAL');

            assert(exp5.getDate() === now.getDate() + 1);
            assert(exp5.getHours() === now.getHours());
            assert(exp5.getMinutes() === now.getMinutes());
            assert(exp5.getSeconds() === now.getSeconds());

            const some_date = new Date("2004-05-08");
            const exp6 = GlacierBackend.generate_expiry(some_date, 1.5, `02:05:00`, 'UTC');

            assert(exp6.getUTCDate() === some_date.getUTCDate() + 1 + 1);
            assert(exp6.getUTCHours() === 2);
            assert(exp6.getUTCMinutes() === 5);
            assert(exp6.getUTCSeconds() === 0);
        });
	});
});
