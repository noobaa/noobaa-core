/* Copyright (C) 2016 NooBaa */

import template from './add-bucket-trigger-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import { state$, action$ } from 'state';
import { closeModal, addBucketTrigger } from 'action-creators';
import { bucketEvents } from 'utils/bucket-utils';
import { realizeUri } from 'utils/browser-utils';
import { getFunctionOption } from 'utils/func-utils';
import ko from 'knockout';
import * as routes from 'routes';

const formName = 'addBucketTrigger';

class AddBucketTriggerModalViewModel extends Observer {
    bucketName = '';
    triggerKeys = null;
    form = null;
    isFormReady = ko.observable();
    funcsUrl = ko.observable();
    eventOptions = bucketEvents;
    funcOptions = ko.observableArray();
    areFuncsLoaded = ko.observable();

    constructor({ bucketName }) {
        super();

        this.bucketName = ko.unwrap(bucketName);

        this.observe(
            state$.getMany(
                ['buckets', this.bucketName, 'triggers'],
                'functions',
                'accounts',
                ['location', 'params', 'system'],
            ),
            this.onState
        );

    }

    onState([triggers, funcs, accounts, system]) {
        if (!triggers) {
            this.isFormReady(false);
            return;
        }

        const existingTriggers = Object.values(triggers);

        if (!this.form) {
            this.form = new FormViewModel({
                name: formName,
                fields: {
                    func: '',
                    event: '',
                    prefix: '',
                    suffix: '',
                    active: true
                },
                onValidate: this.onValidate.bind(this),
                onValidateSubmit: values => this.onValidateSubmit(values, existingTriggers),
                onSubmit: this.onSubmit.bind(this)
            });
            this.isFormReady(true);
        }

        if (funcs && accounts) {
            const funcOptions = Object.values(funcs)
                .map(func => getFunctionOption(func, accounts, this.bucketName));

            this.funcOptions(funcOptions);
            this.areFuncsLoaded(true);
        } else {
            this.areFuncsLoaded(false);
        }


        const funcsUrl = realizeUri(routes.funcs, { system: system });
        this.funcsUrl(funcsUrl);
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

        action$.onNext(addBucketTrigger(this.bucketName, config));
        action$.onNext(closeModal());
    }

    onCancel() {
        action$.onNext(closeModal());
    }

    dispose() {
        this.form && this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: AddBucketTriggerModalViewModel,
    template: template
};
