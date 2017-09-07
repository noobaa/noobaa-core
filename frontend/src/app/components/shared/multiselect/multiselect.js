/* Copyright (C) 2016 NooBaa */

import template from './multiselect.html';
import ko from 'knockout';

function _normalizeOption(option) {
    const naked = ko.deepUnwrap(option);
    const {
        value = naked,
        label = value.toString(),
        tooltip = label,
        disabled = false
    } = naked;

    return { value, label, disabled, tooltip };
}

class MultiSelectViewModel {
    constructor({
        options = [],
        selected,
        disabled = false,
        insertValidationMessage = false
    }) {
        this.options = ko.pureComputed(
            () => (ko.unwrap(options) || []).map(_normalizeOption)
        );

        this.selected = ko.isWritableObservable(selected) ?
            ko.pureComputed({
                read: () => Array.from(ko.unwrap(selected) || []),
                write: selected
            }) :
            ko.observableArray(Array.from(ko.unwnrap(selected) || []));

        this.disabled = disabled;
        this.insertValidationMessage = insertValidationMessage;
    }
}

export default {
    viewModel: MultiSelectViewModel,
    template: template
};
