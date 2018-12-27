/* Copyright (C) 2016 NooBaa */

import template from './edit-func-config-modal.html';
import ConnectableViewModel from 'components/connectable';
import { memorySizeOptions } from 'utils/func-utils';
import { getFieldError } from 'utils/form-utils';
import ko from 'knockout';
import { updateLambdaFuncConfig, closeModal } from 'action-creators';

class EditFuncConfigModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    memorySizeOptions = memorySizeOptions;
    funcName = '';
    funcVersion = '';
    timeoutError = ko.observable();
    formFields = ko.observable();

    selectState(state, params) {
        const { functions, forms } = state;
        const { funcName, funcVersion } = params;
        const funcId = `${funcName}:${funcVersion}`;
        return [
            functions && functions[funcId],
            forms[this.formName]
        ];
    }

    mapStateToProps(func, form) {
        if (func) {
            ko.assignToProps(this, {
                funcName: func.name,
                funcVersion: func.version,
                timeoutError: form && (getFieldError(form, 'timeout') || ''),
                formFields: !form ? {
                    runtime: func.runtime,
                    memorySize: func.memorySize,
                    timeoutMinutes: Math.floor(func.timeout / 60),
                    timeoutSeconds: func.timeout % 60,
                    description: func.description
                } : undefined
            });
        }
    }

    onValidate(values) {
        const errors = {};
        const { description, timeoutMinutes, timeoutSeconds } = values;

        const isTimeoutValid =
            Number.isInteger(timeoutMinutes) &&
            Number.isInteger(timeoutSeconds) &&
            timeoutMinutes >= 0 &&
            timeoutSeconds >= 0 &&
            (timeoutMinutes + timeoutSeconds) > 0;

        if (!isTimeoutValid) {
            errors.timeoutMinutes = errors.timeoutSeconds = '';
            errors.timeout = 'Please enter a timeout greater then 0';
        }

        const overflow = description.length - 256;
        if (overflow > 0) {
            errors.description = `${overflow} characters over the limit of 256`;
        }

        return errors;

    }

    onSubmit(values) {
        const { funcName, funcVersion } = this;
        const { description, runtime, memorySize, timeoutMinutes, timeoutSeconds } = values;
        const updateAction = updateLambdaFuncConfig(
            funcName,
            funcVersion,
            description,
            runtime,
            memorySize,
            timeoutMinutes * 60 + timeoutSeconds
        );

        this.dispatch(
            closeModal(),
            updateAction
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: EditFuncConfigModalViewModel,
    template: template
};
