import template from './multiselect.html';
import ko from 'knockout';

class MultiSelectViewModel {
    constructor({ options = [], selected = [] }) {
        this.options = options.map(
            option => typeof ko.unwrap(option) === 'object' ? 
                ko.unwrap(option) : 
                { value: ko.unwrap(option),  label: option.toString() } 
        );

        this.selected = selected;
    }
}

export default {
    viewModel: MultiSelectViewModel,
    template: template
}