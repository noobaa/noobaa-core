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

class EditBucketTriggerModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    bucketName = '';
    triggerId = '';
    existingTriggers = [];
    fields = ko.observable();
    funcsUrl = ko.observable();
    eventOptions = bucketEvents;
    funcOptions = ko.observableArray();
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
            buckets && buckets[bucketName].triggers,
            functions,
            accounts,
            location.params.system,
            Boolean(forms && forms[this.formName])
        ];
    }

    mapStateToProps(
        bucketName,
        triggerId,
        triggers,
        funcs,
        accounts,
        system,
        isFormInitialized
    ) {
        if (!triggers || !funcs || !accounts) {
            return;
        }

        const trigger = triggers[triggerId];
        const funcsUrl = realizeUri(routes.funcs, { system: system });
        const existingTriggers = Object.values(triggers)
            .filter(other => other !== trigger);
        const funcOptions = Object.values(funcs)
            .map(func => getFunctionOption(func, accounts, bucketName));

        ko.assignToProps(this, {
            bucketName,
            triggerId,
            funcsUrl,
            funcOptions,
            existingTriggers,
            fields: !isFormInitialized ? {
                func: `${trigger.func.name}:${trigger.func.version}`,
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
        const { event, func, prefix, suffix } = values;
        const [funcName, funcVersion] = func.split(':');

        const unique = existingTriggers
            .every(trigger =>
                trigger.event !== event ||
                trigger.func.name !== funcName ||
                trigger.func.version !== funcVersion ||
                trigger.prefix !== prefix ||
                trigger.suffix !== suffix
            );

        if (!unique) {
            errors.event = errors.func = errors.prefix = errors.suffix = ' ';
            errors.global = 'A trigger with the same setting already exists';
        }

        return errors;
    }

    onSubmit(values) {
        const { bucketName, triggerId } = this;
        const [funcName, funcVersion] = values.func.split(':');
        const config = {
            funcName,
            funcVersion,
            event: values.event,
            prefix: values.prefix,
            suffix: values.suffix,
            enabled: values.active
        };

        this.dispatch(
            closeModal(),
            updateBucketTrigger(bucketName, triggerId, config)
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
