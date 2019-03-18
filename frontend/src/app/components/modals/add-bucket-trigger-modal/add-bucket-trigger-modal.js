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

class AddBucketTriggerModalViewModel extends ConnectableViewModel {
    learnMoreHref = learnMoreHref;
    formName = this.constructor.name;
    bucketName = '';
    existingTriggers = null;
    eventOptions = bucketEvents;
    funcActions = [{
        label: 'Create new function',
        onClick: () => this.onCreateNewFunction()
    }];
    funcOptions = ko.observableArray();
    fields = {
        func: null,
        event: '',
        prefix: '',
        suffix: '',
        active: true
    };

    selectState(state, params) {
        const { buckets, functions, accounts } = state;
        const { bucketName } = params;

        return [
            bucketName,
            buckets && buckets[bucketName].triggers,
            functions,
            accounts
        ];
    }

    mapStateToProps(bucketName, triggers, funcs, accounts) {
        if (!triggers || !funcs || !accounts) {
            return;
        }

        ko.assignToProps(this, {
            bucketName,
            existingTriggers: Object.values(triggers),
            funcOptions: Object.values(funcs).map(func =>
                getFunctionOption(func, accounts, bucketName)
            )
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
        const [funcName, funcVersion] = values.func.split(':');
        const config = {
            funcName: funcName,
            funcVersion: funcVersion,
            event: values.event,
            prefix: values.prefix,
            suffix: values.suffix,
            enabled: values.active
        };

        this.dispatch(
            closeModal(),
            addBucketTrigger(this.bucketName, config)
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: AddBucketTriggerModalViewModel,
    template: template
};
