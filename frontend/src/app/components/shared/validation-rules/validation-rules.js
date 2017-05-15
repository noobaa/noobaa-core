/* Copyright (C) 2016 NooBaa */

import template from './validation-rules.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';

class ValidationRulesViewModel extends BaseViewModel {
    constructor({ field }) {
        super();
        this.validationRules = ko.pureComputed(
            () => ko.validation.fullValidationState(field)()
                .map(
                    validator => ({
                        message: validator.message,
                        isValid: validator.isValid
                    })
                )
        );
    }
}

export default {
    viewModel: ValidationRulesViewModel,
    template: template
};
