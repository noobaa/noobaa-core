/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-quota-modal.html';
import Observer from 'observer';
import { deepFreeze, mapValues } from 'utils/core-utils';
import { getDataBreakdown, getQuotaValue } from 'utils/bucket-utils';
import style from 'style';
import ko from 'knockout';
import { getMany } from 'rx-extensions';
import { state$, action$ } from 'state';
import { updateBucketQuotaPolicy, closeModal } from 'action-creators';
import { formatSize, toBytes, toBigInteger, fromBigInteger,
    unitsInBytes, isSizeZero, sumSize } from 'utils/size-utils';

const unitOptions = deepFreeze([
    {
        label: 'GB',
        value: 'GIGABYTE'
    },
    {
        label: 'TB',
        value: 'TERABYTE'
    },
    {
        label: 'PB',
        value: 'PETABYTE'
    }
]);

function _findMaxQuotaPossible(data) {
    const { PETABYTE, TERABYTE, GIGABYTE } = unitsInBytes;

    const { size, availableForUpload } = data;
    const total = toBigInteger(size).add(toBigInteger(availableForUpload));

    if (total.greaterOrEquals(PETABYTE)) {
        return {
            size: fromBigInteger(total.divide(PETABYTE)),
            unit: 'PETABYTE'
        };

    } else if (total.greaterOrEquals(TERABYTE)) {
        return {
            size: fromBigInteger(total.divide(TERABYTE)),
            unit: 'TERABYTE'
        };
    } else if (total.greaterOrEquals(GIGABYTE)) {
        return {
            size: fromBigInteger(total.divide(GIGABYTE)),
            unit: 'GIGABYTE'
        };

    } else {
        return {
            size: 1,
            unit: 'GIGABYTE'
        };
    }
}

function _getQuota(formValues, bucket) {
    if (formValues) {
        const size = Number.isInteger(formValues.size) ? Math.max(formValues.size, 0) : 0;
        const unit = formValues.unit;
        return { size, unit };

    } else {
        return bucket.quota || _findMaxQuotaPossible(bucket.data);
    }
}

class EditBucketQuotaModalViewModel extends Observer {
    formName = this.constructor.name;
    unitOptions = unitOptions;
    bucketName = '';
    fields = ko.observable();
    markers = ko.observableArray();
    barValues = [
        {
            label: 'Used Data',
            color: style['color8'],
            value: ko.observable()
        },
        {
            label: 'Overused',
            color: style['color10'],
            value: ko.observable(),
            visible: ko.observable()
        },
        {
            label: 'Available',
            color: style['color5'],
            value: ko.observable()
        },
        {
            label: 'Potential',
            color: style['color1'],
            value: ko.observable(),
            visible: false
        },
        {
            label: 'Overallocated',
            color: style['color11'],
            value: ko.observable(),
            visible: ko.observable()
        }
    ];

    constructor({ bucketName }) {
        super();

        this.bucketName = ko.unwrap(bucketName);

        this.observe(
            state$.pipe(
                getMany(
                    ['buckets', this.bucketName],
                    ['forms', this.formName]
                )
            ),
            this.onState
        );
    }

    onState([ bucket, form ]) {
        if (!bucket) return;

        const formValues = form && mapValues(form.fields, field => field.value);
        const enabled = formValues ? formValues.enabled : Boolean(bucket.quota);
        const quota = _getQuota(formValues, bucket);
        const breakdown = getDataBreakdown(bucket.data, enabled ? quota : undefined);
        const potential = breakdown.potentialForUpload;
        this.barValues[0].value(toBytes(breakdown.used));
        this.barValues[1].value(toBytes(breakdown.overused));
        this.barValues[1].visible(!isSizeZero(breakdown.overused));
        this.barValues[2].value(toBytes(breakdown.availableForUpload));
        this.barValues[3].value(toBytes(potential));
        this.barValues[4].value(toBytes(breakdown.overallocated));
        this.barValues[4].visible(!isSizeZero(breakdown.overallocated));

        const markers = [];
        if (enabled) {
            const value = getQuotaValue(quota);
            const placement = toBytes(value);
            const label = `Quota: ${formatSize(value)}`;

            markers.push({ placement, label });
        }

        this.markers(markers);

        if (!this.fields()) {
            this.fields({
                enabled: enabled,
                unit: quota.unit,
                size: quota.size
            });
        }
    }

    onValidate(values) {
        const errors = {};
        const { size, enabled } = values;

        if (enabled && (!Number.isInteger(size) || size < 1)) {
            errors.size = 'Please enter an integer bigger or equal to 1';
        }

        return errors;
    }

    onSubmit(values) {
        const quota = values.enabled ?
            { unit: values.unit, size: Number(values.size) } :
            null;

        action$.next(updateBucketQuotaPolicy(this.bucketName, quota));
        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
    }
}

export default {
    viewModel: EditBucketQuotaModalViewModel,
    template: template
};
