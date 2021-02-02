/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-trigger-modal.html';
import ConnectableViewModel from 'components/connectable';
import { bucketEvents } from 'utils/bucket-utils';
import { realizeUri } from 'utils/browser-utils';
import { getFunctionOption } from 'utils/func-utils';
import ko from 'knockout';
import * as routes from 'routes';
import {
    openCreateFuncModal,
    updateBucketTrigger,
    closeModal
} from 'action-creators';

const retriesTooltip = 'Number of retries Noobaa will make if the trigger fails';

function _getDataBucketOption(bucket) {
    return {
        value: bucket.name,
        remark: 'Data bucket'
    };
}

function _getNamespaceBucketOptions(bucket) {
    return {
        value: bucket.name,
        remark: 'Namespace bucket'
    };
}

class EditBucketTriggerModalViewModel extends ConnectableViewModel {
    retriesTooltip = retriesTooltip;
    formName = this.constructor.name;
    updateDisplayName = '';
    originalBucketName = '';
    funcName = '';
    triggerId = '';
    existingTriggers = [];
    fields = ko.observable();
    funcsUrl = ko.observable();
    eventOptions = bucketEvents;
    funcOptions = ko.observableArray();
    bucketOptions = ko.observableArray();
    funcActions = [{
        label: 'Create new function',
        onClick: () => this.onCreateNewFunction()
    }]

    selectState(state, params) {
        return [
            params.mode,
            params.triggerId,
            state.buckets,
            state.namespaceBuckets,
            state.functions,
            state.bucketTriggers,
            state.accounts,
            state.location.params.system,
            Boolean(state.forms && state.forms[this.formName])
        ];
    }

    mapStateToProps(
        modalMode,
        triggerId,
        buckets,
        namespaceBuckets,
        funcs,
        triggers,
        accounts,
        system,
        isFormInitialized
    ) {
        if (!buckets || !funcs || !accounts) {
            return;
        }
        const inBucketMode = modalMode === 'BUCKET';
        const inFuncMode = modalMode === 'FUNCTION';
        const trigger = triggers[triggerId];
        const existingTriggers = Object.values(triggers).filter(other => other !== trigger);
        const funcsUrl = realizeUri(routes.funcs, { system: system });
        const bucketOptions = inFuncMode ? [
            ...Object.values(buckets).map(_getDataBucketOption),
            ...Object.values(namespaceBuckets).map(_getNamespaceBucketOptions)
        ] : null;
        const funcOptions = inBucketMode ?
            Object.values(funcs).map(func =>
                getFunctionOption(func, accounts, trigger.bucket.name)
            ) : null;

        ko.assignToProps(this, {
            updateDisplayName: inBucketMode ?
                `function ${trigger.func.name}` : `bucket ${trigger.bucket.name}`,
            originalBucketName: trigger.bucket.name,
            triggerId,
            funcsUrl,
            funcOptions,
            bucketOptions,
            existingTriggers,
            fields: !isFormInitialized ? {
                bucket: trigger.bucket.name,
                func: `${trigger.func.name}:${trigger.func.version}`,
                event: trigger.event,
                prefix: trigger.prefix,
                suffix: trigger.suffix,
                attempts: trigger.attempts,
                active: trigger.mode !== 'DISABLED'
            } : undefined
        });
    }

    onCreateNewFunction() {
        this.dispatch(openCreateFuncModal());
    }

    async onValidateSubmit(values, existingTriggers) {
        const errors = {};
        const { event, func, prefix, suffix, bucket, attempts } = values;
        const [funcName, funcVersion] = func.split(':');

        const unique = existingTriggers
            .every(trigger =>
                (trigger.bucket.name !== bucket) ||
                (trigger.event !== event) ||
                (trigger.func.name !== funcName) ||
                (trigger.func.version !== funcVersion) ||
                (trigger.prefix !== prefix) ||
                (trigger.suffix !== suffix) ||
                (trigger.attempts !== attempts)
            );

        if (!unique) {
            errors.event = errors.func = errors.bucket = errors.prefix = errors.suffix = errors.attempts = ' ';
            errors.global = 'A trigger with the same setting already exists';
        }

        if (!Number.isInteger(attempts) || attempts < 0 || attempts > 99) {
            errors.attempts = 'Please Select retries number as a whole positive number between 0 to 99';
        }

        return errors;
    }

    onSubmit(values) {
        const { triggerId, originalBucketName, updateDisplayName } = this;
        const bucketName = values.bucket;
        const [funcName, funcVersion] = values.func.split(':');
        const config = {
            bucketName,
            funcName,
            funcVersion,
            event: values.event,
            prefix: values.prefix,
            suffix: values.suffix,
            attempts: values.attempts + 1,
            enabled: values.active
        };

        this.dispatch(
            closeModal(),
            updateBucketTrigger(originalBucketName, triggerId, config, updateDisplayName)
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: EditBucketTriggerModalViewModel,
    template: template
};
