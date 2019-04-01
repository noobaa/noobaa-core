/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-trigger-modal.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { bucketEvents } from 'utils/bucket-utils';
import { flatMap } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getFunctionOption } from 'utils/func-utils';
import ko from 'knockout';
import { getMany } from 'rx-extensions';
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

class EditBucketTriggerModalViewModel extends Observer {
    formName = this.constructor.name;
    bucketName = '';
    funcName = '';
    fieldChoice = 'function';
    existingTriggers = [];
    fields = ko.observable();
    funcsUrl = ko.observable();
    eventOptions = bucketEvents;
    funcOptions = ko.observableArray();
    bucketOptions = ko.observableArray();
    funcActions = [{
        label: 'Create new function',
        onClick: this.onCreateNewFunction
    }]

    constructor({ bucketName, triggerId , funcName, funcVersion}) {
        super();

        this.bucketName = ko.unwrap(bucketName);
        this.triggerId = ko.unwrap(triggerId);
        this.funcName = ko.unwrap(funcName);
        this.funcVersion = ko.unwrap(funcVersion);

        this.observe(
            state$.pipe(
                getMany(
                    'buckets',
                    'functions',
                    'accounts',
                    ['location', 'params', 'system']
                )
            ),
            this.onState
        );

    }

    onState([buckets, funcs, accounts, system]) {
        if (!funcs || !buckets || !accounts) {
            this.isFormReady(false);
            return;
        }

        const trigger = _selectTrigger(buckets, this.bucketName, this.triggerId); 
        if (!this.bucketName) {
            this.bucketName = trigger.bucketName;
        }

        const funcsUrl = realizeUri(routes.funcs, { system: system });
        const existingTriggers = flatMap(
            Object.values(buckets), 
            bucket => Object.values(bucket.triggers).map(trigger => ({
                ...trigger, 
                bucketName: bucket.name}
            ))
        ).filter(other => other !== trigger);
       
        this.existingTriggers = existingTriggers;
        this.funcsUrl(funcsUrl);

        if (!this.fields()) {
            const bucketOptions = this.funcName ? Object.keys(buckets) : [];
            const funcOptions = Object.values(funcs).map(func => 
                getFunctionOption(func, accounts, this.bucketName)
            );
            
            this.funcOptions(funcOptions);
            this.bucketOptions(bucketOptions);

            // Dropdown compare values by idnetity so we need to find
            // the object set in the options list that have the same name and version
            // as the one in the trigger state.
            const selectedFunction = funcOptions.find(opt =>
                opt.value.name === trigger.func.name &&
                opt.value.version === trigger.func.version
            );

            this.fields({
                func: selectedFunction ? selectedFunction.value : null,
                bucket: this.bucketName,
                event: trigger.event,
                prefix: trigger.prefix,
                suffix: trigger.suffix,
                active: trigger.mode !== 'DISABLED'
            });
        }
    }

    onCreateNewFunction() {
        action$.next(openCreateFuncModal());
    }

    async onValidateSubmit(values, existingTriggers) {
        const errors = {};
        const { event, func, prefix, suffix, bucket } = values;

        const unique = existingTriggers
            .every(trigger =>
                trigger.event !== event ||
                trigger.func.name !== func.name ||
                trigger.func.version !== func.version ||
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
        const config = {
            bucketName: values.bucket,
            funcName: values.func.name,
            funcVersion: values.func.version,
            event: values.event,
            prefix: values.prefix,
            suffix: values.suffix,
            enabled: values.active
        };

        const displayName = this.funcName ? 
            `function ${this.funcName}` :
            `bucket ${this.bucketName}`;

        action$.next(updateBucketTrigger(
            this.bucketName, 
            this.triggerId, 
            config,
            displayName 
        ));
        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
    }
}

export default {
    viewModel: EditBucketTriggerModalViewModel,
    template: template
};
