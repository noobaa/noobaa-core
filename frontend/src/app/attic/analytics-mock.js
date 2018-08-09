/* Copyright (C) 2016 NooBaa */

import { makeArray, groupBy, pick } from 'utils/core-utils';
import { unitsInBytes, sumSize } from 'utils/size-utils';
import { sleep } from 'utils/promise-utils';
import moment from 'moment';

const buckets = [
    'first.bucket',
    'second.bucket',
    'bucket.3',
    'bucket-4',
    'bucket.with.a.very.long.name.for.shiri',
    'blablablabla.blublublublu',
    'extra-bucket',
    'extra-bucket-2'
];

const accounts = [
    'demo@noobaa.com',
    'ohad@ohad.ohad',
    'ohad@noobaa.com',
    'ohad_mitrani@walla.co.il'
];

const cloudServices = [
    'AWS',
    'AZURE',
    'S3_COMPATIBLE',
    'GOOGLE',
    'FLASHBLADE',
    'NET_STORAGE'
];

const anHour = moment.duration(1, 'hour').asMilliseconds();

const emptySample = {
    read_bytes: 0,
    write_bytes: 0,
    read_count: 0,
    write_count: 0
};

const usageSamples = (function() {
    const till = moment().endOf('hour');
    const since = moment(till).subtract(40, 'days').add(1, 'ms');

    const samples = [];
    for (let m = since.clone(); m.isBefore(till); m.add(1, 'hour')) {
        const time = m.valueOf();
        for (const bucket of buckets) {
            for (const account of accounts) {
                // Random chance to drop the sample (simulating a lack of reads and writes).
                if (Math.random() <= 0.85) {
                    samples.push({
                        start_time: time,
                        end_time: time + anHour - 1,
                        bucket: bucket,
                        account: account,
                        read_bytes: Math.floor(Math.random() * 10) * unitsInBytes.GB,
                        write_bytes: Math.floor(Math.random() * 10) * unitsInBytes.GB,
                        read_count: Math.floor(Math.random() * 1000),
                        write_count: Math.floor(Math.random() * 1000)
                    });
                }
            }
        }
    }
    return samples;
})();

const objectSizeSamples = (function() {
    return buckets.map(bucket => ({
        name: bucket,
        bins: makeArray(Math.ceil(Math.random() * 50), () => ({
            count: Math.random() <= 0.85 ? Math.floor(Math.random() * 1000) : 0,
            sum: 1
        }))
    }));
})();

const cloudStatsSamples = (function() {
    const till = moment().endOf('hour');
    const since = moment(till).subtract(40, 'days').add(1, 'ms');

    const samples = [];
    for (let m = since.clone(); m.isBefore(till); m.add(1, 'hour')) {
        const time = m.valueOf();
        for (const service of cloudServices) {
            if (Math.random() <= 0.85) {
                samples.push({
                    start_time: time,
                    end_time: time + anHour - 1,
                    service: service,
                    read_bytes: Math.floor(Math.random() * 10) * unitsInBytes.GB,
                    write_bytes: Math.floor(Math.random() * 10) * unitsInBytes.GB,
                    read_count: Math.floor(Math.random() * 1000),
                    write_count: Math.floor(Math.random() * 1000)
                });
            }
        }
    }

    return samples;
})();

function _aggregateSamples(aggr, sample) {
    if (!aggr) {
        return pick(sample, [
            'read_bytes',
            'write_bytes',
            'read_count',
            'write_count'
        ]);
    } else {
        aggr.read_bytes = sumSize(aggr.read_bytes, sample.read_bytes);
        aggr.write_bytes = sumSize(aggr.write_bytes, sample.write_bytes);
        aggr.read_count += sample.read_count;
        aggr.write_count += sample.write_count;
        return aggr;
    }
}

function _normalizeDuration(start, end) {
    return [
        moment(start).startOf('hour').valueOf(),
        moment(end).add(1, 'hour').startOf('hour').valueOf()
    ];
}

export async function get_bucket_throughput_usage({ buckets, since, till, resolution }) {
    await sleep(500);

    const [start, end] = _normalizeDuration(since, till);
    const step = resolution * anHour;

    const filtered = usageSamples.filter(sample =>
        start <= sample.start_time &&
        sample.end_time <= end &&
        buckets.includes(sample.bucket)
    );

    const indexed = groupBy(filtered, sample =>
        Math.floor((sample.start_time - start) / step)
    );

    return makeArray((end - start) / step, i => {
        const start_time = start + i * step;
        const end_time = start_time + step - 1;
        const {
            read_bytes = 0,
            write_bytes = 0,
            read_count = 0,
            write_count = 0
        } = (indexed[i] || []).reduce(_aggregateSamples, null) || {};

        return { start_time, end_time, read_bytes, write_bytes, read_count, write_count };
    });
}

export async function get_account_usage({ accounts, since, till }) {
    await sleep(500);

    const [start, end] = _normalizeDuration(since, till);
    const filtered = usageSamples.filter(sample =>
        start <= sample.start_time &&
        sample.end_time <= end &&
        accounts.includes(sample.account)
    );

    const byAccount = groupBy(filtered, sample => sample.account);
    return Object.entries(byAccount)
        .map(([account, samples]) => ({
            account,
            ...samples.reduce(_aggregateSamples, emptySample)
        }));
}


export async function get_objects_size_histogram() {
    return objectSizeSamples;
}

export async function get_cloud_services_stats({ start_date, end_date }) {
    await sleep(500);

    const [start, end] = _normalizeDuration(start_date, end_date);
    const filtered = cloudStatsSamples.filter(sample =>
        start <= sample.start_time &&
        sample.end_time <= end
    );

    const byService = groupBy(filtered, sample => sample.service,);

    return cloudServices.map(service => {
        const group = byService[service] || [];
        return {
            service,
            ...group.reduce(_aggregateSamples, emptySample)
        };
    });

}

