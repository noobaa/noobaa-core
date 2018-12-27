/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-trigger-modal.html';
import ConnectableViewModel from 'components/connectable';
import { bucketEvents } from 'utils/bucket-utils';
import { flatMap } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getFunctionOption } from 'utils/func-utils';
import ko from 'knockout';
import * as routes from 'routes';
import {
    openCreateFuncModal,
    updateBucketTrigger,
    closeModal
} from 'action-creators';

function _selectTrigger(buckets, bucketName, triggerId) {
    const bucket = bucketName ?
        buckets[bucketName] :
        Object.values(buckets).find(bucket => bucket.triggers[triggerId]);

    return bucket && {
        ...bucket.triggers[triggerId],
        bucketName: bucket.name
    };
}

class EditBucketTriggerModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    bucketName = '';
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
        const { buckets, functions, accounts, location, forms } = state;
        const { bucketName, triggerId } = params;

        return [
            bucketName,
            triggerId,
            buckets,
            functions,
            accounts,
            location.params.system,
            Boolean(forms && forms[this.formName])
        ];
    }

    mapStateToProps(
        bucketName,
        triggerId,
        buckets,
        funcs,
        accounts,
        system,
        isFormInitialized
    ) {
        if (!buckets || !funcs || !accounts) {
            return;
        }

        const trigger = _selectTrigger(buckets, bucketName, triggerId);
        if (!bucketName) bucketName = trigger.bucketName;
        const funcsUrl = realizeUri(routes.funcs, { system: system });
        const existingTriggers = flatMap(
            Object.values(buckets),
            bucket => Object.values(bucket.triggers).map(trigger => ({
                ...trigger,
                bucketName: bucket.name}
            ))
        ).filter(other => other !== trigger);

        const bucketOptions = this.funcName ? Object.keys(buckets) : [];
        const funcOptions = Object.values(funcs)
            .map(func => getFunctionOption(func, accounts, bucketName));

        ko.assignToProps(this, {
            bucketName,
            triggerId,
            funcsUrl,
            funcOptions,
            bucketOptions,
            existingTriggers,
            fields: !isFormInitialized ? {
                func: `${trigger.func.name}:${trigger.func.version}`,
                bucket: bucketName,
                event: trigger.event,
                prefix: trigger.prefix,
                suffix: trigger.suffix,
                active: trigger.mode !== 'DISABLED'
            } : undefined
        });
    }

    onCreateNewFunction() {
        this.dispatch(openCreateFuncModal());
    }

    async onValidateSubmit(values, existingTriggers) {
        const errors = {};
        const { event, func, prefix, suffix, bucket } = values;
        const [funcName, funcVersion] = func.split(':');

        const unique = existingTriggers
            .every(trigger =>
                trigger.event !== event ||
                trigger.func.name !== funcName ||
                trigger.func.version !== funcVersion ||
                trigger.bucketName !== bucket ||
                trigger.prefix !== prefix ||
                trigger.suffix !== suffix
            );

        if (!unique) {
            errors.event = errors.func = errors.bucket = errors.prefix = errors.suffix = ' ';
            errors.global = 'A trigger with the same setting already exists';
        }

        return errors;
    }

    onSubmit(values) {
        const { bucketName, triggerId } = this;
        const [funcName, funcVersion] = values.func.split(':');
        const config = {
            bucketName,
            funcName,
            funcVersion,
            event: values.event,
            prefix: values.prefix,
            suffix: values.suffix,
            enabled: values.active
        };

        const displayName = this.funcName ?
            `function ${this.funcName}` :
            `bucket ${this.bucketName}`;

        this.dispatch(
            closeModal(),
            updateBucketTrigger(bucketName, triggerId, config, displayName)
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
