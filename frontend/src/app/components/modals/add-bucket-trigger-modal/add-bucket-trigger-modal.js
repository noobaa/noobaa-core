/* Copyright (C) 2016 NooBaa */

import template from './add-bucket-trigger-modal.html';
import ConnectableViewModel from 'components/connectable';
import { bucketEvents } from 'utils/bucket-utils';
import { getFunctionOption } from 'utils/func-utils';
import ko from 'knockout';
import {
    openCreateFuncModal,
    addBucketTrigger,
    closeModal
} from 'action-creators';

const retriesTooltip = 'Number of retries Noobaa will make if the trigger fails';

function _mapDataBucketOption(bucket) {
    return {
        value: bucket.name,
        remark: 'Data bucket'
    };
}

function _mapNamespaceBucketOption(bucket) {
    return {
        value: bucket.name,
        remark: 'Namespace bucket'
    };
}

class AddBucketTriggerModalViewModel extends ConnectableViewModel {
    retriesTooltip = retriesTooltip;
    formName = this.constructor.name;
    bucketName = '';
    existingTriggers = null;
    eventOptions = bucketEvents;
    bucketOptions = ko.observableArray();
    funcActions = [{
        label: 'Create new function',
        onClick: () => this.onCreateNewFunction()
    }];
    funcOptions = ko.observableArray();
    fields = ko.observable();

    selectState(state, params) {
        return [
            params.bucketName,
            params.funcId,
            state.buckets,
            state.namespaceBuckets,
            state.bucketTriggers,
            state.functions,
            state.accounts,
            Boolean(state.forms && state.forms[this.formName])
        ];
    }

    mapStateToProps(
        bucketName,
        funcId,
        buckets,
        namespaceBuckets,
        triggers,
        funcs,
        accounts,
        isFormInitialized
    ) {
        if (!buckets || !namespaceBuckets || !triggers || !funcs || !accounts) {
            return;
        }

        ko.assignToProps(this, {
            bucketName,
            existingTriggers: Object.values(triggers),
            bucketOptions: bucketName ? null : [
                ...Object.values(buckets).map(_mapDataBucketOption),
                ...Object.values(namespaceBuckets).map(_mapNamespaceBucketOption)
            ],
            funcOptions: funcId ? null : Object.values(funcs).map(func =>
                getFunctionOption(func, accounts, bucketName)
            ),
            fields: !isFormInitialized ? {
                bucket: bucketName || '',
                func: funcId || '',
                event: '',
                prefix: '',
                suffix: '',
                attempts: 0,
                active: true
            } : undefined
        });
    }

    onValidate(values) {
        const errors = {};
        const { event, func, attempts } = values;

        if (!func) {
            errors.func = 'Please select a function';
        }

        if (!event) {
            errors.event = 'Please select an event type';
        }

        if (!Number.isInteger(attempts) || attempts < 0 || attempts > 99) {
            errors.attempts = 'Please Select retries number as a whole positive number between 0 to 99';
        }

        return errors;
    }

    async onValidateSubmit(values, existingTriggers) {
        const errors = {};
        const { event, func, prefix, suffix, bucket, attempts } = values;
        const [funcName, funcVersion] = func.split(':');

        const unique = existingTriggers
            .every(trigger =>
                (trigger.bucket.name !== bucket) ||
                (trigger.func.name !== funcName) ||
                (trigger.func.version !== funcVersion) ||
                (trigger.event !== event) ||
                (trigger.prefix !== prefix) ||
                (trigger.suffix !== suffix) ||
                (trigger.attempts !== attempts)
            );

        if (!unique) {
            errors.bucket = errors.event = errors.func = errors.prefix = errors.suffix = errors.attempts = '';
            errors.global = 'A trigger with the same setting already exists';
        }

        return errors;
    }

    onSubmit(values) {
        const [funcName, funcVersion] = values.func.split(':');
        const config = {
            bucket: values.bucket,
            funcName: funcName,
            funcVersion: funcVersion,
            event: values.event,
            prefix: values.prefix,
            suffix: values.suffix,
            attempts: values.attempts + 1,
            enabled: values.active
        };

        this.dispatch(
            closeModal(),
            addBucketTrigger(config)
        );
    }

    onCreateNewFunction() {
        this.dispatch(openCreateFuncModal());
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: AddBucketTriggerModalViewModel,
    template: template
};
