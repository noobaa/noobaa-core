/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-quota-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import { deepFreeze, mapValues } from 'utils/core-utils';
import { getDataBreakdown, getQuotaValue } from 'utils/bucket-utils';
import style from 'style';
import ko from 'knockout';
import { state$, action$ } from 'state';
import { updateBucketQuota, closeModal } from 'action-creators';
import { formatSize, toBytes, toBigInteger,
    unitsInBytes, isSizeZero } from 'utils/size-utils';


const formName = 'editBucketQuota';
const unitOptions = deepFreeze([
    {
        label: 'GB',
        value: 'GIGABYTE',
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
            size: total.divide(PETABYTE),
            unit: 'PETABYTE'
        };

    } else if (total.greaterOrEquals(TERABYTE)) {
        return {
            size: total.divide(TERABYTE),
            unit: 'TERABYTE'
        };
    } else if (total.greaterOrEquals(GIGABYTE)) {
        return {
            size: total.divide(GIGABYTE),
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
    constructor({ bucketName }) {
        super();

        this.bucketName = ko.unwrap(bucketName);
        this.unitOptions = unitOptions;
        this.form = null;
        this.isFormInitalized = ko.observable();
        this.markers = ko.observableArray();
        this.barValues = [
            {
                key: 'used',
                label: 'Used Data',
                color: style['color8'],
                value: ko.observable()
            },
            {
                key: 'overused',
                label: 'Overused',
                color: style['color10'],
                value: ko.observable(),
                visible: ko.observable()
            },
            {
                key: 'availableForUpload',
                label: 'Available',
                color: style['color7'],
                value: ko.observable()
            },
            {
                key: 'potentialForUpload',
                label: 'Potential for upload',
                color: style['color15'],
                value: ko.observable(),
                visible: ko.observable()
            },
            {
                key: 'availableForSpillover',
                label: 'Available for spillover',
                color: style['color6'],
                value: ko.observable(),
                visible: ko.observable()
            },
            {
                key: 'potentialForSpillover',
                label: 'Potential for spillover',
                color: style['color16'],
                value: ko.observable(),
                visible: ko.observable()
            },
            {
                key: 'overallocated',
                label: 'Overallocated',
                color: style['color11'],
                value: ko.observable(),
                visible: ko.observable()
            }
        ];

        this.observe(
            state$.getMany(
                ['buckets', this.bucketName],
                ['forms', formName]
            ),
            this.onState
        );
    }

    onState([ bucket, form ]) {
        if (!bucket) {
            this.isFormInitalized(false);
            return;
        }

        const formValues = form && mapValues(form.fields, field => field.value);
        const enabled = formValues ? formValues.enabled : Boolean(bucket.quota);
        const quota = formValues ?
            { size: Math.max(formValues.size, 0), unit: formValues.unit } :
            (bucket.quota || _findMaxQuotaPossible(bucket.data));

        const breakdown = getDataBreakdown(bucket.data, enabled ? quota : undefined);
        this.barValues.forEach(part => {
            const value = breakdown[part.key];
            part.value(toBytes(value));
            part.visible && part.visible(!isSizeZero(value));
        });

        const markers = [];
        if (enabled) {
            const value = getQuotaValue(quota);
            const placement = toBytes(value);
            const label = `Quota: ${formatSize(value)}`;

            markers.push({ placement, label });
        }

        this.markers(markers);

        if (!form) {
            this.form = new FormViewModel({
                name: formName,
                fields: {
                    enabled: enabled,
                    unit: quota.unit,
                    size: quota.size
                },
                onValidate: this.onValidate.bind(this),
                onSubmit: this.onSubmit.bind(this)
            });
            this.isFormInitalized(true);
        }
    }

    onValidate(values) {
        const errors = {};

        const size = Number(values.size);
        if (values.enabled && (!Number.isInteger(size) || size < 1)) {
            errors.size = 'Must be a number bigger or equal to 1';
        }

        return errors;
    }

    onSubmit(values) {
        const quota = values.enabled ?
            { unit: values.unit, size: Number(values.size) } :
            null;

        action$.onNext(updateBucketQuota(this.bucketName, quota));
        action$.onNext(closeModal());
    }

    onCancel() {
        action$.onNext(closeModal());
    }

    // onSave() {
    //     if (this.errors().length > 0) {
    //         this.errors.showAllMessages();

    //     } else {
    //         const quota = this.isUsingQuota() ?
    //             { unit: this.quotaUnit(), size: Number(this.quotaSize()) } :
    //             null;

    //         action$.onNext(updateBucketQuota(this.bucketName, quota));
    //         action$.onNext(closeModal());
    //     }
    // }

    dispose() {
        this.form && this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: EditBucketQuotaModalViewModel,
    template: template
};
