/* Copyright (C) 2016 NooBaa */

import template from './more-info-icon.html';
import { deepFreeze } from 'utils/core-utils';
import ko from 'knockout';

const severityMapping = deepFreeze({
    normal: {
        css: 'normal',
        icon: 'question'
    },
    warning: {
        css: 'warning',
        icon: 'problem'
    },
    error: {
        css: 'error',
        icon: 'problem'
    },
    success: {
        css: 'sucess',
        icon: 'healthy'
    }
});

class MoreInfoIconViewModel{
    constructor({ tooltip = '', disabled = false, severity = 'normal' }) {
        const meta = ko.pureComputed(() =>
            severityMapping[severity] || severityMapping.info
        );

        this.tooltip = ko.pureComputed(() =>
            ko.unwrap(disabled) ? '' : ko.unwrap(tooltip)
        );
        this.icon = ko.pureComputed(() =>
            meta().icon
        );
        this.css = ko.pureComputed(() =>
            `${meta().css} ${ko.unwrap(disabled) ? 'disabled' : ''}`
        );
    }
}

export default {
    viewModel: MoreInfoIconViewModel,
    template: template
};
