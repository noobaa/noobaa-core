/* Copyright (C) 2016 NooBaa */

import template from './validation-message.html';
import ko from 'knockout';

class ValidationMessageViewModel {
    constructor({ field }) {
        const { isValid, wasTouched, error, warning } = field;

        this.visible = ko.pureComputed(
            () => error() ? wasTouched() : Boolean(warning())
        );

        this.css = ko.pureComputed(
            () => !isValid() ?  'error' : (warning() ? 'warning' : '')
        );

        this.text = ko.pureComputed(
            () => isValid() ? (warning() || '') : (error() || '')
        );
    }
}

export default {
    viewModel: ValidationMessageViewModel,
    template: template
};
