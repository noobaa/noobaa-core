import template from './multiselect.html';
import ko from 'knockout';

class MultiSelectViewModel {
    constructor({
        options = [],
        selected = ko.observable(),
        disabled = false,
        insertValidationMessage = false
    }) {
        this.options = ko.pureComputed(
            () => (ko.unwrap(options) || []).map(
                option => typeof ko.unwrap(option) === 'object' ?
                    ko.unwrap(option) :
                    { value: ko.unwrap(option),  label: ko.unwrap(option).toString() }
            )
        );

        this.selected = selected;
        this.selectedInternal = ko.observableArray();

        this.selectedSub = selected.subscribe(
            selection => this.selectedInternal(Array.from(selection))
        );

        // this.selectedInternal.subscribe(
        //     selection => this.selected(Array.from(selection))
        // );

        this.disabled = disabled;
        this.insertValidationMessage = insertValidationMessage;
    }

    dispose() {
        this.selectedSub.dispose();
    }
}

export default {
    viewModel: MultiSelectViewModel,
    template: template
};
