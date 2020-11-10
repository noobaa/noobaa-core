/* Copyright (C) 2016 NooBaa */
/**
 *
 * AWS USAGE METER
 *
 */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const size_utils = require('../../util/size_utils');
const system_store = require('../system_services/system_store').get_instance();

const marketplacemetering = new AWS.MarketplaceMetering({
    apiVersion: '2016-01-14',
    region: process.env.AWS_REGION
});


function background_worker() {
    if (process.env.PLATFORM !== 'aws') return;

    if (!system_store.is_finished_initial_load) {
        dbg.log0('System did not finish initial load');
        return;
    }

    if (!process.env.AWS_REGION) {
        dbg.error('AWS_REGION is missing from .env. cannot send usage report to AWS');
        return;
    }
    // get current data usage in TB
    const total_data_usage = system_store.data.buckets
        .map(bucket => size_utils.json_to_bigint(_.get(bucket, 'storage_stats.objects_size', 0)))
        .reduce((sum, val) => sum.add(val), size_utils.BigInteger.zero)
        .divide(size_utils.TERABYTE)
        .toJSON();

    var params = {
        DryRun: false,
        ProductCode: process.env.AWS_PRODUCT_CODE,
        Timestamp: new Date(),
        UsageDimension: config.AWS_METERING_USAGE_DIMENSION,
        UsageQuantity: total_data_usage
    };

    dbg.log0(`sending usage report to AWS. total data=${total_data_usage}, timestamp=${params.Timestamp}`);

    const retries = 5;
    const delay = 30000;
    P.retry({
            attempts: retries,
            delay_ms: delay,
            func: () => P.fromCallback(callback => marketplacemetering.meterUsage(params, callback))
                .then(res => {
                    dbg.log0(`sent usage report successfully. MeteringRecordId = ${res.MeteringRecordId}`);
                })
                .catch(err => {
                    dbg.error(`got error on marketplacemetering.meterUsage. will retry in ${delay / 1000} seconds`, err);
                    throw err;
                })
        })
        .catch(err => dbg.error(`Failed sending usage report. stop trying after ${retries} retries`, err));

}

// EXPORTS
exports.background_worker = background_worker;
