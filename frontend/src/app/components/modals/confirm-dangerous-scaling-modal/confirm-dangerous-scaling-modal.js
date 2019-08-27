/* Copyright (C) 2016 NooBaa */

import template from './confirm-dangerous-scaling-modal.html';
import ConnectableViewModel from 'components/connectable';
import { closeModal } from 'action-creators';

class ConfirmDangerousScalingModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    scaleAction = null;
    formFields = {
        confirm: ''
    };

    selectState(state, params) {
        return [
            params.action
        ];
    }

    mapStateToProps(action) {
        this.scaleAction = action;
    }

    onValidate(values) {
        const errors = {};
        const { confirm } = values;

        if (confirm.trim().toLowerCase() !== 'scale') {
            errors.confirm = 'Please type "scale" to confirm your action';
        }

        return errors;
    }


    onSubmit() {
        this.dispatch(
            closeModal(Infinity),
            this.scaleAction
        );
    }

    onBack() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: ConfirmDangerousScalingModalViewModel,
    template: template
};
