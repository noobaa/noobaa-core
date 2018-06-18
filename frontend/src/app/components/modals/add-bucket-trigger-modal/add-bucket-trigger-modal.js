/* Copyright (C) 2016 NooBaa */

import template from './add-bucket-trigger-modal.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { bucketEvents } from 'utils/bucket-utils';
import { getFunctionOption } from 'utils/func-utils';
import { getMany } from 'rx-extensions';
import ko from 'knockout';
import { addBucketTrigger as learnMoreHref } from 'knowledge-base-articles';
import {
    openCreateFuncModal,
    addBucketTrigger,
    closeModal
} from 'action-creators';

class AddBucketTriggerModalViewModel extends Observer {
    learnMoreHref = learnMoreHref;
    formName = this.constructor.name;
    bucketName = '';
    existingTriggers = null;
    eventOptions = bucketEvents;
    funcActions = [{
        label: 'Create new function',
        onClick: this.onCreateNewFunction
    }];
    funcOptions = ko.observableArray();
    fields = {
        func: null,
        event: '',
        prefix: '',
        suffix: '',
        active: true
    };

    constructor({ bucketName }) {
        super();

        this.bucketName = ko.unwrap(bucketName);

        this.observe(
            state$.pipe(
                getMany(
                    ['buckets', this.bucketName, 'triggers'],
                    'functions',
                    'accounts'
                )
            ),
            this.onState
        );
    }

    onState([triggers, funcs, accounts]) {
        if (!triggers || !funcs || !accounts) {
            return;
        }

        const funcOptions = Object.values(funcs)
            .map(func => getFunctionOption(func, accounts, this.bucketName));

        this.existingTriggers = Object.values(triggers);
        this.funcOptions(funcOptions);
    }

    onCreateNewFunction() {
        action$.next(openCreateFuncModal());
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

        const unique = existingTriggers
            .every(trigger =>
                trigger.event !== event ||
                    trigger.func.name !== func.name ||
                    trigger.func.version !== func.version ||
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
        const config = {
            funcName: values.func.name,
            funcVersion: values.func.version,
            event: values.event,
            prefix: values.prefix,
            suffix: values.suffix,
            enabled: values.active
        };

        action$.next(addBucketTrigger(this.bucketName, config));
        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
    }
}

export default {
    viewModel: AddBucketTriggerModalViewModel,
    template: template
};
