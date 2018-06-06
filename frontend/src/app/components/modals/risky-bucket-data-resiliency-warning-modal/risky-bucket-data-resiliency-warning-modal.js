/* Copyright (C) 2016 NooBaa */

import template from './risky-bucket-data-resiliency-warning-modal.html';
import Observer from 'observer';
import { action$ } from 'state';
import { updateBucketResiliencyPolicy, closeModal } from 'action-creators';
import { all, sleep } from 'utils/promise-utils';
import api from 'services/api';
import ko from 'knockout';

class RiskyBucketDataResiliencyWarningModalViewModel extends Observer {
    formName = this.constructor.name;
    bucketName = '';
    tierName = '';
    policy = null;
    fields = { password: '' }

    constructor(params) {
        super();

        const { bucketName, tierName, policy } = ko.deepUnwrap(params);

        this.bucketName = bucketName;
        this.tierName = tierName;
        this.policy = policy;
    }

    onValidate(values) {
        const errors = {};

        if (!values.password) {
            errors.password = 'Please enter your account\'s password';
        }

        return errors;
    }

    async onValidateSubmit(values) {
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
        action$.next(updateBucketResiliencyPolicy(bucketName, tierName, policy));
        action$.next(closeModal(2));
    }

    onBack() {
        action$.next(closeModal());
    }
}

export default {
    viewModel: RiskyBucketDataResiliencyWarningModalViewModel,
    template: template
};
