/* Copyright (C) 2016 NooBaa */

import template from './add-bucket-trigger-modal.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { bucketEvents } from 'utils/bucket-utils';
import { realizeUri } from 'utils/browser-utils';
import { getFunctionOption } from 'utils/func-utils';
import { getMany } from 'rx-extensions';
import ko from 'knockout';
import * as routes from 'routes';
import {
    openCreateFuncModal,
    addBucketTrigger,
    closeModal
} from 'action-creators';

class AddBucketTriggerModalViewModel extends Observer {
    formName = this.constructor.name;
    bucketName = '';
    existingTriggers = null;
    funcsUrl = ko.observable();
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
                    'accounts',
                    ['location', 'params', 'system']
                )
            ),
            this.onState
        );
    }

    onState([triggers, funcs, accounts, system]) {
        if (!triggers || !funcs || !accounts) {
            return;
        }

        const funcsUrl = realizeUri(routes.funcs, { system: system });
        const funcOptions = Object.values(funcs)
            .map(func => getFunctionOption(func, accounts, this.bucketName));

        this.existingTriggers = Object.values(triggers);
        this.funcsUrl(funcsUrl);
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
