/* Copyright (C) 2016 NooBaa */

import template from './add-func-trigger-modal.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { flatMap } from 'utils/core-utils';
import { bucketEvents } from 'utils/bucket-utils';
import { getMany } from 'rx-extensions';
import ko from 'knockout';
import { addBucketTrigger as learnMoreHref } from 'knowledge-base-articles';
import {
    addBucketTrigger,
    closeModal
} from 'action-creators';

class AddFuncTriggerModalViewModel extends Observer {
    learnMoreHref = learnMoreHref;
    formName = this.constructor.name;
    funcName = '';
    funcVersion = ''
    existingTriggers = null;
    eventOptions = bucketEvents;
    bucketOptions = ko.observableArray();
    fields = {
        bucket: null,
        event: '',
        prefix: '',
        suffix: '',
        active: true
    };

    constructor({ funcName, funcVersion }) {
        super();

        this.funcName = ko.unwrap(funcName);
        this.funcVersion = ko.unwrap(funcVersion);

        this.observe(
            state$.pipe(
                getMany(
                    'buckets',
                    'accounts'
                )
            ),
            this.onState
        );
    }

    onState([buckets, accounts]) {
        if (!buckets || !accounts) {
            return;
        }

        const bucketOptions = Object.keys(buckets);
        this.existingTriggers = flatMap(
            Object.values(buckets).filter(bucket => Object.keys(bucket.triggers).length !== 0),
            b => Object.values(b.triggers).map(t => ({...t, bucketName: b.name}))
        );
        this.bucketOptions(bucketOptions);
    }

    onValidate(values) {
        const errors = {};
        const { event, bucket } = values;

        if (!bucket) {
            errors.bucket = 'Please select a bucket';
        }

        if (!event) {
            errors.event = 'Please select an event type';
        }

        return errors;
    }

    async onValidateSubmit(values, existingTriggers) {
        const errors = {};
        const { event, bucket, prefix, suffix } = values;

        const unique = existingTriggers
            .every(trigger =>
                trigger.event !== event ||
                    trigger.func.name !== this.funcName ||
                    trigger.func.version !== this.funcVersion ||
                    trigger.prefix !== prefix ||
                    trigger.suffix !== suffix ||
                    trigger.bucketName !== bucket
            );

        if (!unique) {
            errors.event = errors.func = errors.prefix = errors.suffix = ' ';
            errors.global = 'A trigger with the same setting already exists';
        }

        return errors;
    }

    onSubmit(values) {
        const config = {
            funcName: this.funcName,
            funcVersion: this.funcVersion,
            event: values.event,
            prefix: values.prefix,
            suffix: values.suffix,
            enabled: values.active
        };

        action$.next(addBucketTrigger(values.bucket, config));
        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
    }
}

export default {
    viewModel: AddFuncTriggerModalViewModel,
    template: template
};
