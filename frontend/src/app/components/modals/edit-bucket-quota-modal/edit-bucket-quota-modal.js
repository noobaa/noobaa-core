/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-quota-modal.html';
import Observer from 'observer';
import { deepFreeze } from 'utils/core-utils';
import { toBigInteger, fromBigInteger, bigInteger, formatSize, toBytes } from 'utils/size-utils';
import style from 'style';
import ko from 'knockout';
import { state$ } from 'state';
import { updateBucketQuota } from 'dispatchers';

const units = deepFreeze({
    GIGABYTE: { label: 'GB', inBytes: Math.pow(1024, 3) },
    TERABYTE: { label: 'TB', inBytes: Math.pow(1024, 4) },
    PETABYTE: { label: 'PB', inBytes: Math.pow(1024, 5) },
});

function calcDataBreakdown(data, quota) {
    if (quota) {
        const zero = bigInteger.zero;
        const available = toBigInteger(data.free);
        const quotaSize = toBigInteger(quota.size).multiply(units[quota.unit].inBytes);
        const used = bigInteger.min(toBigInteger(data.size), quotaSize);
        const overused = bigInteger.max(zero, used.subtract(quotaSize));
        const overallocated = bigInteger.max(zero, quotaSize.subtract(available.add(used)));
        const availableToUpload = bigInteger.min(bigInteger.max(zero, quotaSize.subtract(used)), available);
        const availableOverQuota = bigInteger.max(zero, available.subtract(availableToUpload));

        return {
            used: fromBigInteger(used),
            overused: fromBigInteger(overused),
            availableToUpload: fromBigInteger(availableToUpload),
            availableOverQuota: fromBigInteger(availableOverQuota),
            overallocated: fromBigInteger(overallocated)
        };

    } else {
        return {
            used: data.size,
            overused: 0,
            availableToUpload: data.free,
            availableOverQuota: 0,
            overallocated: 0
        };
    }
}

function getBarValues(values) {
    return [
        {
            value: toBytes(values.used),
            label: 'Used Data',
            color: style['color8']
        },
        {
            value: toBytes(values.overused),
            label: 'Overused',
            color: style['color10']
        },
        {
            value: toBytes(values.availableToUpload),
            label: 'Available to upload',
            color: style['color7']
        },
        {
            value: toBytes(values.availableOverQuota),
            label: 'Potential',
            color: style['color15']
        },
        {
            value: toBytes(values.overallocated),
            label: 'Overallocated',
            color: style['color16']
        }
    ]
        .filter(item => item.value > 0);
}

function recommendQuota(data) {
    const total = toBigInteger(data.size).add(data.actual_free);

    if (total.greaterOrEquals(units.PETABYTE.inBytes)) {
        return {
            size: total.divide(units.PETABYTE.inBytes),
            unit: 'PETABYTE'
        };

    } else if (total.greaterOrEquals(units.TERABYTE.inBytes)) {
        return {
            size: total.divide(units.TERABYTE.inBytes),
            unit: 'TERABYTE'
        };
    } else if (total.greaterOrEquals(units.GIGABYTE.inBytes)) {
        return {
            size: total.divide(units.GIGABYTE.inBytes),
            unit: 'GIGABYTE'
        };

    } else {
        return {
            size: 1,
            unit: 'GIGABYTE'
        };
    }
}

class EditBucketQuotaModalViewModel extends Observer {
    constructor({ onClose, bucketName }) {
        super();

        this.close = onClose;
        this.bucketName = bucketName;
        this.formatSize = formatSize;
        this.unitOptions = Object.entries(units).map(
            ([ value, { label }]) => ({ value, label })
        );

        this.isUsingQuota = ko.observable();
        this.quotaUnit = ko.observable();
        this.quotaSize = ko.observable();
        this.barValues = ko.observable();
        this.dataSize = ko.observable();
        this.dataFree = ko.observable();

        this.observe(state$.get('buckets', bucketName), this.onBucket);

        this.barValues = ko.pureComputed(
            () => getBarValues(
                calcDataBreakdown(
                    { size: this.dataSize(), free: this.dataFree() },
                    { unit: this.quotaUnit(), size: this.quotaSize() }
                )
            )
        );
    }

    onBucket({ quota, data }) {
        const usingQuota = Boolean(quota);
        quota = quota || recommendQuota(data);

        this.isUsingQuota(usingQuota);
        this.quotaUnit(quota.unit);
        this.quotaSize(quota.size);
        this.dataSize(data.size);
        this.dataFree(data.actual_free);
    }

    formatBarLabel(value) {
        return value && formatSize(value);
    }

    onCancel() {
        this.close();
    }

    onSave() {
        const quota = this.isUsingQuota() ?
            { unit: this.quotaUnit(), size: Number(this.quotaSize()) } :
            null;

        updateBucketQuota(this.bucketName, quota);
        this.close();
    }
}

export default {
    viewModel: EditBucketQuotaModalViewModel,
    template: template
};
