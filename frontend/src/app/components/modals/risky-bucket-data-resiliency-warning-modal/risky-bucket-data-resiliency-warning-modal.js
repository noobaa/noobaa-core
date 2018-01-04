/* Copyright (C) 2016 NooBaa */

import template from './risky-bucket-data-resiliency-warning-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import { action$ } from 'state';
import { updateBucketResiliencyPolicy, closeModal } from 'action-creators';
import { all, sleep } from 'utils/promise-utils';
import api from 'services/api';

const formName = 'confirmRiskyDataResiliencyPolicy';

class RiskyBucketDataResiliencyWarningModalViewModel extends Observer {
    form = null;
    bucketName = '';
    tierName = '';
    policy = null;

    constructor({ bucketName, tierName, policy }) {
        super();

        this.bucketName = bucketName;
        this.tierName = tierName;
        this.policy = policy;
        this.form = new FormViewModel({
            name: formName,
            fields: {
                password: ''
            },
            asyncTriggers: [
                'password'
            ],
            onValidate: this.onValidate.bind(this),
            onValidateAsync: this.onValidateAsync.bind(this),
            onSubmit: this.onSubmit.bind(this)
        });
    }

    onValidate(values) {
        const errors = {};

        if (!values.password) {
            errors.password = 'Please enter your account\'s password';
        }

        return errors;

    }

    async onValidateAsync(values) {
        const errors = {};

        const [match] = await all(
            api.account.verify_authorized_account({
                verification_password: values.password
            }),
            sleep(500)
        );

        if (!match) {
            errors.password = 'Please enter your account\'s password';
        }

        return errors;
    }

    onSubmit() {
        const { bucketName, tierName, policy } = this;
        action$.onNext(updateBucketResiliencyPolicy(bucketName, tierName, policy));
        action$.onNext(closeModal(2));
    }

    onBack() {
        action$.onNext(closeModal());
    }

    dispose() {
        this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: RiskyBucketDataResiliencyWarningModalViewModel,
    template: template
};
