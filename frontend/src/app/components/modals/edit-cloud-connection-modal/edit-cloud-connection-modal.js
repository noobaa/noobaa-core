/* Copyright (C) 2016 NooBaa */

import template from './edit-cloud-connection-modal.html';
import ConnectableViewModel from 'components/connectable';
// import ko from 'knockout';
import { closeModal } from 'action-creators';

class EditCloudConnectionModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    asyncTriggers = [
    ];
    formFields = {
    };

    selectState(/*state, params*/) {
        return [];
    }

    mapStateToProps() {
    }

    onWarn(/*values*/) {
        const warnings = {};
        // const { } = values;

        return warnings;
    }

    onValidate(/*values*/) {
        const errors = {};
        // const { } = values;

        return errors;
    }

    async onValidateAsync(/*values*/) {
        const errors = {};
        // const { } = values;

        return errors;
    }

    onValidateSubmit() {
        const errors = {};
        // const { } = values;

        return errors;
    }

    onSubmit(/*values*/) {
        // const { } = values;

        this.dispatch(
            /* submit action */
            closeModal()
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: EditCloudConnectionModalViewModel,
    template: template
};
