/* Copyright (C) 2016 NooBaa */

import template from './validation-rules-list.html';
import ko from 'knockout';

class ValidationRulesListViewModel {
    constructor({ field, highlightErrors = false }) {
        this.validationRules = ko.pureComputed(
            () => ko.validation.fullValidationState(field)()
                .map(
                    ({ message, isValid }) => ({
                        message: message,
                        css: {
                            success: field() && isValid,
                            error: highlightErrors() && (!field() || !isValid)
                        }
                    })
                )
        );
    }
}

export default {
    viewModel: ValidationRulesListViewModel,
    template: template
};
