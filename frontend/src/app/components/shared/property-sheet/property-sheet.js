/* Copyright (C) 2016 NooBaa */

import template from './property-sheet.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { copyTextToClipboard } from 'utils/browser-utils';

// const idelTooltip

class PropertySheetViewModel extends BaseViewModel {
    constructor({ properties = [] }) {
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
                } = ko.deepUnwrap(prop);

                const labelText = `${label}:`;
                const css = {
                    'push-next': allowCopy,
                    disabled: disabled,
                };

                return {
                    labelText,
                    value,
                    css,
                    visible,
                    disabled,
                    multiline,
                    allowCopy
                };
            })
        );
        this.tooltip = ko.observable();
    }

    copyToClipboard(text) {
        copyTextToClipboard(ko.unwrap(text));
    }
}

export default {
    viewModel: PropertySheetViewModel,
    template: template
};
