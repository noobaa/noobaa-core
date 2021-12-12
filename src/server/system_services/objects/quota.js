/* Copyright (C) 2021 NooBaa */
/* eslint max-lines: ['error', 2500] */

/**
 * Quota wrapper class represents bucket quota configuration and related methods
 */
'use strict';

const size_utils = require('../../../util/size_utils');
const _ = require('lodash');
const Dispatcher = require('../../notifications/dispatcher');
const config = require('../../../../config');

const RAW_VALUE_FIELD_NAME = 'raw_value';

class Quota {
    /**
     * 
     * @param {any} quota_config - bucket quota configuration payload
     */
    constructor(quota_config) {
        this.size = quota_config && quota_config.size ? quota_config.size : {'value': 0};
         this.size[RAW_VALUE_FIELD_NAME] = size_utils.size_unit_to_bigint(this.size.value, this.size.unit).toString();
         this.quantity = quota_config && quota_config.quantity ? quota_config.quantity : {'value': 0};
         this.quantity[RAW_VALUE_FIELD_NAME] = BigInt(this.quantity.value).toString();
    }

    /**
     * @returns size value.
     */
    get_size_value() {
        return this.size.value;
    }

    /**
     * @returns size unit.
     */
    get_size_unit() {
        return this.size.unit;
    }

    /**
     * @returns quantity value.
     */
    get_quantity_value() {
        return this.quantity.value;
    }

    /**
     * @returns quantity unit.
     */
     get_quantity_unit() {
        return this.quantity.unit;
    }

    /**
     * 
     * @returns calculated bigint size raw value of quota. default is 0.
     */
    get_quota_by_size() {
        return this.size.raw_value;
    }

    /**
     * 
     * @returns calculated bigint quantity raw value of quota
     */
    get_quota_by_quantity() {
        return this.quantity.raw_value;
    }

    /**
     * 
     * @returns - is the quota empty
     */
    is_empty_quota() {
        return this.get_quota_by_size() === '0' && this.get_quota_by_quantity() === '0';
    }

    /**
     * 
     * @returns - is the quota config valid 
     */
    is_valid_quota() {
        return !(this.get_quota_by_size() < 0 || this.get_quota_by_quantity() < 0);
    }

    /**
     * 
     * @returns - new quota config object without raw values
     */
    get_config() {
        const quota_config = {};
        if (this.size.value > 0) {
            quota_config.size = _.omit(this.size, RAW_VALUE_FIELD_NAME);
        }
        if (this.quantity.value > 0) {
            quota_config.quantity = _.omit(this.quantity, RAW_VALUE_FIELD_NAME);
        }
        return quota_config;
    }


    /**
     * 
     * @returns the percent of quota used by the bucket. 
     */
    get_bucket_quota_usages_percent(bucket) {
        return {
            size_used_percent: this.get_bucket_size_quota_usages_percent(bucket),
            quantity_used_percent: this.get_bucket_quantity_quota_usages_percent(bucket)
        };
    }

    /**
     * 
     * @param {*} bucket 
     * @returns the percent of size quota used by the bucket.
     */
    get_bucket_size_quota_usages_percent(bucket) {
        let size_used_percent = 0;
        if (this.is_empty_quota()) return size_used_percent;
        const objects_size = bucket.storage_stats && size_utils.json_to_bigint(bucket.storage_stats.objects_size);
        const quota_size = size_utils.json_to_bigint(this.get_quota_by_size());
        if (quota_size > 0) {
            size_used_percent = objects_size.multiply(100).divide(quota_size).valueOf();
        }
        return size_used_percent;
    }

    /**
    * 
    * @returns the percent of quantity quota used by the bucket. 
    */
     get_bucket_quantity_quota_usages_percent(bucket) {
        let quantity_used_percent = 0;
        if (this.is_empty_quota()) return quantity_used_percent;

        const objects_count = bucket.storage_stats && size_utils.json_to_bigint(bucket.storage_stats.objects_count);
        const quantity_quota = size_utils.json_to_bigint(this.get_quota_by_quantity());
        if (quantity_quota > 0) {
            quantity_used_percent = objects_count.multiply(100).divide(quantity_quota).valueOf();
        }
        return quantity_used_percent;
    }

    /**
     * 
     * @param {*} bucket 
     * @returns - is quota exceeded
     */
    is_quota_exceeded(bucket) {
        var exceeded = {
            is_quota_exceeded: false,
            is_quota_low: false
        };
        let {size_used_percent, quantity_used_percent} = this.get_bucket_quota_usages_percent(bucket);
        exceeded.is_quota_exceeded = (size_used_percent >= 100 || quantity_used_percent >= 100);
        exceeded.is_quota_low = !exceeded.is_quota_exceeded &&
            (size_used_percent >= config.QUOTA_LOW_THRESHOLD || quantity_used_percent >= config.QUOTA_LOW_THRESHOLD);
        return exceeded;
    }

    /**
     * 
     * @param {*} total_size - total available size
     * @param {*} used - total used size
     * @returns - available size for upload
     */
     get_available_size_for_upload(total_size, used) {
        let available_size_for_upload = total_size;
         if (this.get_quota_by_size() > 0) {
            let quota_size_free = size_utils.json_to_bigint(this.get_quota_by_size())
                .minus(size_utils.json_to_bigint(used));
            available_size_for_upload = size_utils.size_min([
                size_utils.bigint_to_json(quota_size_free),
                size_utils.bigint_to_json(available_size_for_upload)
            ]);
        }
        return available_size_for_upload;
    }

    /**
     * 
     * @param {*} used - total already uploaded objects
     * @returns - total available amount objects for upload
     */
     get_available_quantity_for_upload(used) {
        let available_quantity_for_upload = config.QUOTA_MAX_OBJECTS;
         if (this.get_quota_by_quantity() > 0) {
            let quota_quantity_free = size_utils.json_to_bigint(this.get_quota_by_quantity())
                .minus(size_utils.json_to_bigint(used));
            available_quantity_for_upload = size_utils.bigint_to_json(quota_quantity_free);
        }
        return available_quantity_for_upload;
    }

    /**
     * Create and add quota alerts to collection if usage greates than threshold 90%.
     * @param {*} sysid sysid - system id
     * @param {*} bucket - own bucket
     * @returns
     */
    add_quota_alerts(sysid, bucket, collection) {
        const { size_used_percent, quantity_used_percent } = this.get_bucket_quota_usages_percent(bucket);
        const size_alert = Quota.get_quota_alert(sysid, bucket, size_used_percent, this.get_quota_by_size(), 'size');
        if (size_alert !== null) {
            collection.push(size_alert);
        }
        const quantity_alert = Quota.get_quota_alert(sysid, bucket, quantity_used_percent, this.get_quota_by_quantity(), 'quantity');
        if (quantity_alert !== null) {
            collection.push(quantity_alert);
        }
    }

    /**
     * Create quota alert if usage greates than threshold 90%.
     * @param {*} sysid - system id
     * @param {*} bucket - own bucket
     * @param {*} used_percent - usage in percents 
     * @param {*} quota_limit - quota limit
     * @returns alert 
     */
    static get_quota_alert(sysid, bucket, used_percent, quota_limit, quota_type) {
        if (used_percent >= 100) {
            return {
                sev: 'MAJOR',
                sysid: sysid,
                alert: `Bucket ${bucket.name.unwrap()} exceeded its configured ${quota_type} quota of ${quota_limit}, 
                uploads to this bucket will be denied`,
                rule: Dispatcher.rules.once_daily
            };
        }
        if (used_percent >= config.QUOTA_LOW_THRESHOLD) {
            return {
                sev: 'INFO',
                sysid: sysid,
                alert: `Bucket ${bucket.name.unwrap()} exceeded 90% of its configured ${quota_type} quota of ${quota_limit}`,
                rule: Dispatcher.rules.once_daily
            };
        }
        return null;
    }
}

module.exports = Quota;
