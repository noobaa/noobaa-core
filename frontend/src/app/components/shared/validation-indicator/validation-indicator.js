/* Copyright (C) 2016 NooBaa */

import template from './validation-indicator.html';
import ko from 'knockout';

class ValidationIndicatorViewModel {
    constructor({ field }) {
        const { isDirty, isValid, isValidating } = field;

        this.visible = ko.pureComputed(
            () => isDirty() && (isValid() || isValidating())
        );

        this.icon = ko.pureComputed(
            () => isValid() ? 'healthy' : 'in-progress'
        );

        this.css = ko.pureComputed(
            () => ({
                success: isValid(),
                'match-theme': isValidating,
                spin: isValidating
            })
        );
    }
}

export default {
    viewModel: ValidationIndicatorViewModel,
    template: template
};
