/* Copyright (C) 2016 NooBaa */

import template from './risky-bucket-data-resiliency-warning-modal.html';
import ConnectableViewModel from 'components/connectable';
import { closeModal } from 'action-creators';
import { all, sleep } from 'utils/promise-utils';
import { api } from 'services';
import ko from 'knockout';

class RiskyBucketDataResiliencyWarningModalViewModel extends ConnectableViewModel{
    formName = this.constructor.name;
    action = null;
    fields = { password: '' }

    selectState(_, params) {
        return [
            params.action
        ];
    }

    mapStateToProps(action) {
        ko.assignToProps(this, { action });
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
        this.dispatch(
            closeModal(Infinity),
            this.action
        );
    }

    onBack() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: RiskyBucketDataResiliencyWarningModalViewModel,
    template: template
};
