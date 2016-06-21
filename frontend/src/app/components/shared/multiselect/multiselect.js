import template from './multiselect.html';
import ko from 'knockout';

class MultiSelectViewModel {
    constructor({
        options = [],
        selected = [],
        disabled = false,
        insertValidationMessage = false
    }) {
        this.options = ko.pureComputed(
            () => ko.unwrap(options).map(
                option => typeof ko.unwrap(option) === 'object' ?
                    ko.unwrap(option) :
                    { value: ko.unwrap(option),  label: ko.unwrap(option).toString() }
            )
        );

        this.selected = selected;
        this.disabled = disabled;
        this.insertValidationMessage = insertValidationMessage;
    }
}

export default {
    viewModel: MultiSelectViewModel,
    template: template
};
