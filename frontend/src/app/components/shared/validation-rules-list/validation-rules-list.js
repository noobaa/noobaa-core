/* Copyright (C) 2016 NooBaa */

import template from './validation-rules-list.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';

class ValidationRulesListViewModel extends BaseViewModel {
    constructor({ field, highlightErrors = false }) {
        super();
        this.validationRules = ko.pureComputed(
            () => ko.validation.fullValidationState(field)()
                .filter(
                    validator => validator.rule !== 'required'
                )
                .map(
                    validator => ({
                        message: validator.message,
                        isValid: field() && validator.isValid,
                        isError: highlightErrors() && (!field() || !validator.isValid)
                    })
                )
        );
    }
}

export default {
    viewModel: ValidationRulesListViewModel,
    template: template
};
