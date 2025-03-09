/* Copyright (C) 2025 NooBaa */
'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require("crypto");
const mocha = require('mocha');
const assert = require('assert');

const { PersistentLogger } = require('../../util/persistent_logger');
const config = require('../../../config');

function randomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function assert_approx(got, expected, error_margin) {
    const min = Math.floor(expected - (expected * error_margin));
    const max = Math.floor(expected + (expected * error_margin));
    assert(got >= min, `got=${got}, expected min=${min}`);
    assert(got <= max, `got=${got}, expected max=${max}`);
}

mocha.describe('persistent_logger', function() {
    const JOURNAL_TEST_DIR = "test-persistent-logger";

    let journal_dir;
    mocha.before(async function() {
        journal_dir = await fs.mkdtemp(path.join(os.tmpdir(), JOURNAL_TEST_DIR));
    });

    mocha.after(async function() {
        await fs.rm(journal_dir, { recursive: true, force: true });
    });

    mocha.describe('PersistentLogger.approx_entries', function() {
        const entry_len_min = 64;
        const entry_len_max = 1024;
        const entry_count = 1024;
        const journal_data = [...Array(entry_count)].map(_ =>
            crypto.randomBytes(randomInt(entry_len_min / 2, entry_len_max / 2)).toString('hex')
        );

        mocha.it('approx_entries works with default params', async function() {
            const journal_ns = crypto.randomBytes(8).toString('hex');
            await fs.writeFile(path.join(journal_dir, journal_ns + ".log"), journal_data.join('\n'), 'utf8');

            const logger = new PersistentLogger(journal_dir, journal_ns, { locking: null });

            const entries = await logger.approx_entries({});
            assert(entries > 0);

            // Try to make sure that error margin is lesser than 20%
            const error_margin = 0.2;
            assert_approx(entries, entry_count, error_margin);
        });

        mocha.it('approx_entries works with TOP_K exact sample count', async function() {
            const journal_ns = crypto.randomBytes(8).toString('hex');
            await fs.writeFile(path.join(journal_dir, journal_ns + ".log"), journal_data.join('\n'), 'utf8');

            const logger = new PersistentLogger(journal_dir, journal_ns, { locking: null });

            const entries = await logger.approx_entries({ samples: entry_count });
            assert(entries > 0);

            // Let the approximation be within 5% error margin with default config
            const error_margin = 0.05;
            assert_approx(entries, entry_count, error_margin);
        });

        mocha.it('approx_entries works with MID_K default params', async function() {
            const journal_ns = crypto.randomBytes(8).toString('hex');
            await fs.writeFile(path.join(journal_dir, journal_ns + ".log"), journal_data.join('\n'), 'utf8');

            const logger = new PersistentLogger(journal_dir, journal_ns, { locking: null });

            const entries = await logger.approx_entries({ strategy: "MID_K" });
            assert(entries > 0);

            // Try to make sure that error margin is lesser than 20%
            const error_margin = 0.2;
            assert_approx(entries, entry_count, error_margin);
        });

        mocha.it('approx_entries works with MID_K half sample count', async function() {
            const journal_ns = crypto.randomBytes(8).toString('hex');
            await fs.writeFile(path.join(journal_dir, journal_ns + ".log"), journal_data.join('\n'), 'utf8');

            const logger = new PersistentLogger(journal_dir, journal_ns, { locking: null });

            const entries = await logger.approx_entries({ strategy: "MID_K", samples: Math.floor(entry_count / 2) });
            assert(entries > 0);

            // Let the approximation be within 5% error margin with default config
            const error_margin = 0.05;
            assert_approx(entries, entry_count, error_margin);
        });

        mocha.it('approx_entries works with MIXED_K default params', async function() {
            const journal_ns = crypto.randomBytes(8).toString('hex');
            await fs.writeFile(path.join(journal_dir, journal_ns + ".log"), journal_data.join('\n'), 'utf8');

            const logger = new PersistentLogger(journal_dir, journal_ns, { locking: null });

            const entries = await logger.approx_entries({ strategy: "MIXED_K" });
            assert(entries > 0);

            // Try to make sure that error margin is lesser than 20%
            const error_margin = 0.2;
            assert_approx(entries, entry_count, error_margin);
        });

        mocha.it('approx_entries works with MIXED_K with exact sample size', async function() {
            const journal_ns = crypto.randomBytes(8).toString('hex');
            await fs.writeFile(path.join(journal_dir, journal_ns + ".log"), journal_data.join('\n'), 'utf8');

            const logger = new PersistentLogger(journal_dir, journal_ns, { locking: null });

            const entries = await logger.approx_entries({ strategy: "MIXED_K", samples: entry_count });
            assert(entries > 0);

            // Let the approximation be within 5% error margin with default config
            const error_margin = 0.05;
            assert_approx(entries, entry_count, error_margin);
        });

        mocha.it('approx_entries works with MIGRATE_QUEUE sized data', async function() {
            const journal_ns = crypto.randomBytes(8).toString('hex');
            await fs.writeFile(
                path.join(journal_dir, journal_ns + ".log"),
                journal_data.slice(0, config.NSFS_GLACIER_DESIRED_MIGRATE_QUEUE_SIZE).join('\n'),
                'utf8',
            );

            const logger = new PersistentLogger(journal_dir, journal_ns, { locking: null });

            const samples = config.NSFS_GLACIER_DESIRED_MIGRATE_QUEUE_SIZE / 10;

            const error_margin = 0.1;

            const topk_entries = await logger.approx_entries({ strategy: "TOP_K", samples });
            console.log(topk_entries);
            assert(topk_entries > 0);
            assert_approx(topk_entries, config.NSFS_GLACIER_DESIRED_MIGRATE_QUEUE_SIZE, error_margin);

            const midk_entries = await logger.approx_entries({ strategy: "MID_K", samples: Math.floor(samples / 2)});
            console.log(midk_entries);
            assert(midk_entries > 0);
            assert_approx(midk_entries, config.NSFS_GLACIER_DESIRED_MIGRATE_QUEUE_SIZE, error_margin);

            const mixedk_entries = await logger.approx_entries({ strategy: "MIXED_K", samples });
            console.log(mixedk_entries);
            assert(mixedk_entries > 0);
            assert_approx(mixedk_entries, config.NSFS_GLACIER_DESIRED_MIGRATE_QUEUE_SIZE, error_margin);
        });
    });
});
