/* Copyright (C) 2016 NooBaa */

import template from './multiselect.html';
import Observer from 'observer';
import ko from 'knockout';

class MultiSelectViewModel extends Observer {
    constructor({
        options = [],
        selected = ko.observable(),
        disabled = false,
        insertValidationMessage = false
    }) {
        super();

        this.options = ko.pureComputed(
            () => (ko.unwrap(options) || []).map(
                option => typeof ko.unwrap(option) === 'object' ?
                    ko.unwrap(option) :
                    { value: ko.unwrap(option), label: ko.unwrap(option).toString() }
            )
        );

        this.selected = ko.isObservable(selected) ?
            selected :
            ko.observableArray(selected);

        this.disabled = disabled;
        this.insertValidationMessage = insertValidationMessage;
    }
}

export default {
    viewModel: MultiSelectViewModel,
    template: template
};
