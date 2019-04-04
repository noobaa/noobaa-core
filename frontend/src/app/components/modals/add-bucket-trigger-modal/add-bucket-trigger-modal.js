/* Copyright (C) 2016 NooBaa */

import template from './add-bucket-trigger-modal.html';
import ConnectableViewModel from 'components/connectable';
import { bucketEvents } from 'utils/bucket-utils';
import { getFunctionOption } from 'utils/func-utils';
import ko from 'knockout';
import { addBucketTrigger as learnMoreHref } from 'knowledge-base-articles';
import {
    openCreateFuncModal,
    addBucketTrigger,
    closeModal
} from 'action-creators';

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
    learnMoreHref = learnMoreHref;
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
                active: true
            } : undefined
        });
    }

    onValidate(values) {
        const errors = {};
        const { event, func } = values;

        if (!func) {
            errors.func = 'Please select a function';
        }

        if (!event) {
            errors.event = 'Please select an event type';
        }

        return errors;
    }

    async onValidateSubmit(values, existingTriggers) {
        const errors = {};
        const { event, func, prefix, suffix, bucket } = values;
        const [funcName, funcVersion] = func.split(':');

        const unique = existingTriggers
            .every(trigger =>
                (trigger.bucket.name !== bucket) ||
                (trigger.func.name !== funcName) ||
                (trigger.func.version !== funcVersion) ||
                (trigger.event !== event) ||
                (trigger.prefix !== prefix) ||
                (trigger.suffix !== suffix)
            );

        if (!unique) {
            errors.bucket = errors.event = errors.func = errors.prefix = errors.suffix = '';
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
