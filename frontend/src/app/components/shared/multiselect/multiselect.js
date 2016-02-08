import template from './multiselect.html';
import ko from 'knockout';

class MultiSelectViewModel {
    constructor({ options = [], selected = [] }) {
        this.options = options.map(
            option => typeof ko.unwrap(option) === 'object' ? 
                ko.unwrap(option) : 
                { value: ko.unwrap(option),  label: option.toString() } 
        );

        // Allows the ko checked binding to recognize that we are dealing with
        // mulipule selection event if the value of selected is null or undefined.
        this.selected = ko.pureComputed({
            read: () => selected() || [],
            write: selected
        });
    }
}

export default {
    viewModel: MultiSelectViewModel,
    template: template
}