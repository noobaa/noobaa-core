/* Copyright (C) 2026 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

const { BucketDiff } = require('../../../server/utils/bucket_diff.js');
const replication_utils = require('../../../server/utils/replication_utils.js');

describe('BucketDiff destination list cost before and after the resume-token fix', () => {
    jest.setTimeout(60000);
    const page_size = 1000;
    const boundary_gap = source_with_boundary_gap(page_size, 3);
    const shared_prefix = keys('k', page_size * 5);
    const scenarios = [
        {
            name: 'destination ends before the source',
            page_size,
            source: keys('s', page_size * 8),
            destination: keys('a', page_size * 4),
        },
        {
            name: 'next source key is already on the destination page',
            page_size,
            source: boundary_gap.source,
            destination: boundary_gap.destination,
        },
        {
            name: 'long destination prefix before the source',
            page_size,
            source: keys('s', page_size * 2),
            destination: keys('a', page_size * 10),
        },
        {
            name: 'source and destination have the same keys',
            page_size,
            source: keys('k', page_size * 3),
            destination: keys('k', page_size * 3),
        },
        {
            name: 'destination is empty',
            page_size,
            source: keys('s', page_size * 3),
            destination: [],
        },
        {
            name: 'destination starts after the source',
            page_size,
            source: keys('s', page_size * 3),
            destination: keys('z', page_size * 3),
        },
        {
            name: 'source continues past the copied prefix',
            page_size,
            source: shared_prefix,
            destination: shared_prefix.slice(0, page_size * 2),
        },
        {
            name: 'every other source key is missing on the destination',
            page_size,
            source: keys('k', page_size * 3),
            destination: even_keys('k', page_size * 3),
        },
    ];

    it('compares destination list cost before and after the resume-token fix', async () => {
        const rows = [];
        for (const scenario of scenarios) {
            const before = await run_source_pass(scenario, 'before');
            const after = await run_source_pass(scenario, 'after');
            rows.push({
                situation: scenario.name,
                'lists before': before.dest_lists,
                'lists after': after.dest_lists,
                'list change': percent_change(before.dest_lists, after.dest_lists),
                'keys listed before': before.dest_keys,
                'keys listed after': after.dest_keys,
                'keys change': percent_change(before.dest_keys, after.dest_keys),
                'copies before': before.copies,
                'copies after': after.copies,
                'copy change': percent_change(before.copies, after.copies),
            });
            expect(after.copies).toBeLessThanOrEqual(before.copies);
        }

        const by_name = Object.fromEntries(rows.map(row => [row.situation, row]));
        expect(by_name['destination ends before the source']['lists after'])
            .toBeLessThan(by_name['destination ends before the source']['lists before']);
        expect(by_name['long destination prefix before the source']['lists after'])
            .toBeLessThan(by_name['long destination prefix before the source']['lists before']);
        expect(by_name['next source key is already on the destination page']['copies after'])
            .toBeLessThan(by_name['next source key is already on the destination page']['copies before']);
        expect(by_name['source and destination have the same keys']['copies after'])
            .toBe(by_name['source and destination have the same keys']['copies before']);
        expect(by_name['source and destination have the same keys']['lists after'])
            .toBeLessThanOrEqual(by_name['source and destination have the same keys']['lists before']);
        expect(by_name['destination is empty']['lists after'])
            .toBe(by_name['destination is empty']['lists before']);
        expect(by_name['destination is empty']['copies after'])
            .toBe(by_name['destination is empty']['copies before']);
        expect(by_name['destination starts after the source']['lists after'])
            .toBe(by_name['destination starts after the source']['lists before']);
        expect(by_name['destination starts after the source']['copies after'])
            .toBe(by_name['destination starts after the source']['copies before']);
        expect(by_name['source continues past the copied prefix']['lists after'])
            .toBeLessThan(by_name['source continues past the copied prefix']['lists before']);
        expect(by_name['source continues past the copied prefix']['copies after'])
            .toBe(by_name['source continues past the copied prefix']['copies before']);
        expect(by_name['every other source key is missing on the destination']['lists after'])
            .toBeLessThan(by_name['every other source key is missing on the destination']['lists before']);
        expect(by_name['every other source key is missing on the destination']['copies after'])
            .toBe(by_name['every other source key is missing on the destination']['copies before']);
        console.log('\nDestination list calls for one full source pass:\n');
        console.table(rows);
    });
});

/**
 * @param {string} prefix
 * @param {number} count
 */
function keys(prefix, count) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(prefix + String(i).padStart(6, '0'));
    return out;
}

/**
 * Source pages of page_size. The destination has the same source keys except the
 * last key of the first page, so the next destination page runs past that source page
 * and contains the following source page.
 * @param {number} page_size
 * @param {number} source_pages
 */
function source_with_boundary_gap(page_size, source_pages) {
    const source = keys('c', page_size * source_pages);
    const missing = source[page_size - 1];
    const destination = [
        ...keys('a', page_size),
        ...source.filter(key => key !== missing),
        ...keys('z', page_size),
    ];
    return { source, destination };
}

/**
 * @param {number} before
 * @param {number} after
 */
function percent_change(before, after) {
    if (before === 0) return after === 0 ? '0%' : 'n/a';
    const pct = Math.round(((before - after) / before) * 100);
    if (pct > 0) return pct + '% fewer';
    if (pct < 0) return Math.abs(pct) + '% more';
    return '0%';
}

/**
 * One list page. The continuation token is the last key returned, and the next
 * list starts at the first key after it.
 * @param {string[]} bucket_keys
 * @param {string} token
 * @param {number} max_keys
 */
function list_page(bucket_keys, token, max_keys) {
    let start = 0;
    if (token) {
        start = bucket_keys.findIndex(key => key > token);
        if (start < 0) start = bucket_keys.length;
    }
    const page = bucket_keys.slice(start, start + max_keys);
    const truncated = start + max_keys < bucket_keys.length;
    return {
        Contents: page.map(Key => ({ Key, ETag: 'etag-' + Key, Size: 1 })),
        IsTruncated: truncated,
        NextContinuationToken: truncated ? page[page.length - 1] : undefined,
    };
}

/**
 * @param {{ name: string, page_size: number, source: string[], destination: string[] }} scenario
 * @param {'before' | 'after'} mode
 */
async function run_source_pass(scenario, mode) {
    const bucketDiff = new BucketDiff({
        first_bucket: 'first-bucket',
        second_bucket: 'second-bucket',
        version: false,
        s3_params: {
            credentials: {
                accessKeyId: 'YOUR_ACCESS_KEY_ID',
                secretAccessKey: 'YOUR_SECRET_ACCESS_KEY',
            },
        },
        for_replication: true,
        for_deletion: false,
    });
    replication_utils.get_object_md = async () => ({ Metadata: {} });

    const stats = { dest_lists: 0, dest_keys: 0, copies: 0, scans: 0 };
    let old_resume_token;
    let last_listed_token;
    const get_keys_diff = bucketDiff.get_keys_diff.bind(bucketDiff);
    bucketDiff.get_keys_diff = async (first_keys, second_keys, token) => {
        const diff_result = await get_keys_diff(first_keys, second_keys, token);
        const source_left = Object.keys(diff_result.keys_contents_left);
        const dest_keys = Object.keys(second_keys);
        if (source_left.length && dest_keys.length &&
            source_left[source_left.length - 1] >= dest_keys[dest_keys.length - 1]) {
            old_resume_token = token;
        }
        last_listed_token = token;
        return diff_result;
    };
    bucketDiff._list_objects = async (bucket, _prefix, max_keys, token) => {
        const bucket_keys = bucket === 'first-bucket' ? scenario.source : scenario.destination;
        const page = list_page(bucket_keys, token || '', max_keys);
        if (bucket === 'second-bucket') {
            stats.dest_lists += 1;
            stats.dest_keys += page.Contents.length;
        }
        return page;
    };

    let src_token = '';
    let dst_token = '';
    const scan_limit = scenario.source.length + scenario.destination.length + 5;
    while (stats.scans < scan_limit) {
        old_resume_token = undefined;
        last_listed_token = undefined;
        const result = await bucketDiff.get_buckets_diff({
            prefix: '',
            max_keys: scenario.page_size,
            current_first_bucket_cont_token: src_token,
            current_second_bucket_cont_token: dst_token,
        });
        stats.scans += 1;
        stats.copies += Object.keys(result.keys_diff_map).length;
        src_token = result.first_bucket_cont_token || '';
        const token_before = (result.first_bucket_cont_token && old_resume_token) ? (last_listed_token || '') : '';
        dst_token = mode === 'after' ? (result.second_bucket_cont_token || '') : token_before;
        if (!src_token) return stats;
    }
    throw new Error('source pass did not finish for ' + scenario.name + ' ' + mode);
}

/**
 * @param {string} prefix
 * @param {number} count
 */
function even_keys(prefix, count) {
    const out = [];
    for (let i = 0; i < count; i += 2) out.push(prefix + String(i).padStart(6, '0'));
    return out;
}
