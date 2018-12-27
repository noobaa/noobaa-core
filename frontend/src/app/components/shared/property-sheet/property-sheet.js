/* Copyright (C) 2016 NooBaa */

import template from './property-sheet.html';
import ko from 'knockout';
import { copyTextToClipboard } from 'utils/browser-utils';

function _mapProperty(prop, templates) {
    const {
        label,
        value,
        visible = true,
        disabled = false,
        allowCopy = false,
        template: templateName
    } = ko.deepUnwrap(prop);

    const labelText = `${label}:`;
    const template = templates[templateName] || value || '';
    const css = {
        'push-next': allowCopy,
        disabled: disabled
    };

    return { labelText, value, css, visible, disabled,
        allowCopy, template};
}

class PropertySheetViewModel {
    constructor({ properties = [], loading = false }, templates) {
        this.properties = ko.pureComputed(
            () => ko.unwrap(properties).map(prop => _mapProperty(prop, templates))
        );
        this.loading = loading;
        this.tooltip = ko.observable();
    }

    copyToClipboard(text) {
        copyTextToClipboard(ko.unwrap(text));
    }
}

function viewModelFactory(params, info) {
    const templates = info.templateNodes
        .filter(({ nodeType }) => nodeType === 1)
        .reduce((templates, template) => {
            const name = template.getAttribute('name');
            const html = template.innerHTML;
            templates[name] = html;
            return templates;
        }, {});

    return new PropertySheetViewModel(params, templates);
}

export default {
    viewModel: { createViewModel: viewModelFactory },
    template: template
};
