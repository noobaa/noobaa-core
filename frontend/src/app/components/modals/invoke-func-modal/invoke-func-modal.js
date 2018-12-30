/* Copyright (C) 2016 NooBaa */

import template from './invoke-func-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { closeModal, invokeLambdaFunc } from 'action-creators';

const exampleEvent = {
    key1: 'value1',
    key2: 'value2',
    key3: 'value3'
};

class InvokeFuncModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    funcName = '';
    funcVersion = '';
    formFields = {
        event: JSON.stringify(exampleEvent, null, 4)
    };

    selectState(state, params) {
        return [
            params.funcName,
            params.funcVersion
        ];
    }

    mapStateToProps(funcName, funcVersion) {
        ko.assignToProps(this, {
            funcName,
            funcVersion
        });
    }

    onValidate(values) {
        const { event } = values;
        const errors = {};

        try {
            JSON.parse(event);

        } catch (_) {
            errors.event = 'Please enter a valid JSON object';
        }

        return errors;
    }

    onSubmit(values) {
        const { funcName, funcVersion } = this;
        const event = JSON.parse(values.event);

        this.dispatch(
            closeModal(),
            invokeLambdaFunc(funcName, funcVersion, event)
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: InvokeFuncModalViewModel,
    template: template
};
