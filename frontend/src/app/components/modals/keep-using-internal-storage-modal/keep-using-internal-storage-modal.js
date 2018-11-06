/* Copyright (C) 2016 NooBaa */

import template from './keep-using-internal-storage-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { closeModal } from 'action-creators';

const options = [
    {
        label: 'Keep using the internal disks storage until new resources will be added',
        value: 'DROP_ACTION'
    },
    {
        label: 'Leave this bucket without resources (non-writable)',
        value: 'APPLY_ACTION'
    }
];

class KeepUsingInternalStorageModalViewModel extends ConnectableViewModel {
    options = options;
    action = null;
    formName = this.constructor.name;
    formFields = {
        selection: ''
    };

    selectState(state, params) {
        return [
            params.action
        ];
    }

    mapStateToProps(action) {
        ko.assignToProps(this, { action });
    }

    onValidate(values) {
        const errors = {};

        if (values.selection === ''){
            errors.selection = 'Please select one of the options above';
        }

        return errors;
    }

    onSubmit(values) {
        this.dispatch(closeModal(Infinity));

        if (values.selection === 'APPLY_ACTION') {
            this.dispatch(this.action);
        }
    }

    onBack() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: KeepUsingInternalStorageModalViewModel,
    template: template
};
