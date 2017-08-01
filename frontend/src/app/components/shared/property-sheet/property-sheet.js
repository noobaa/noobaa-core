/* Copyright (C) 2016 NooBaa */

import template from './property-sheet.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { copyTextToClipboard } from 'utils/browser-utils';

class PropertySheetViewModel extends BaseViewModel {
    constructor({ properties = [] }, templates) {
        super();

        this.properties = ko.pureComputed(
            () => properties.map(prop => {
                const {
                    label,
                    value,
                    visible = true,
                    disabled = false,
                    multiline = false,
                    allowCopy = false,
                    template: templateName,
                } = ko.deepUnwrap(prop);

                const labelText = `${label}:`;
                const css = {
                    'push-next': allowCopy,
                    disabled: disabled,
                };

                const template = templates[templateName] || value || '';
                return { labelText, value, css, visible, disabled,
                    multiline, allowCopy, template};
            })
        );
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
