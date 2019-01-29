/* Copyright (C) 2016 NooBaa */

import template from './property-sheet.html';
import ko from 'knockout';
import { copyTextToClipboard } from 'utils/browser-utils';

const defaultTemplate = '{{$data}}';

function _mapProperty(prop, templates) {
    const {
        label,
        value,
        visible = true,
        disabled = false,
        allowCopy = false,
        template: templateName
    } = prop;

    const labelText = `${label}:`;
    const template = templates[templateName] || defaultTemplate;
    const css = {
        'push-next': allowCopy,
        disabled: disabled
    };

    return { labelText, value, css, visible, disabled,
        allowCopy, template};
}

class PropertyRowViewModel {
    labelText = ko.observable();
    value = ko.observable();
    css = ko.observable();
    visible = ko.observable();
    disabled = ko.observable();
    allowCopy = ko.observable();
    template = ko.observable();
}

class PropertySheetViewModel {
    sub = null;
    loading = ko.observable();
    properties = ko.observableArray()
        .ofType(PropertyRowViewModel);

    constructor(params, templates) {
        this.sub = ko.computed(() =>
            this.onParams(ko.deepUnwrap(params), templates)
        );
    }

    onParams(params, templates) {
        const loading = Boolean(params.loading);
        const properties = params.properties.map(prop =>
            _mapProperty(prop, templates)
        );

        ko.assignToProps(this, {
            loading,
            properties
        });
    }

    copyToClipboard(text) {
        copyTextToClipboard(ko.unwrap(text));
    }

    dispose() {
        this.sub && this.sub.dispose();
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
