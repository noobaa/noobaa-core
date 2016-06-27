import template from './radio-group.html';
import ko from 'knockout';
import { randomString } from 'utils';

class RadioGroupViewModel {
    constructor({
            selected = ko.observable(),
            name = randomString(5),
            options,
            multiline = false,
            disabled = false
    }) {
        this.name = name;
        this.selected = selected;
        this.options = options;
        this.disabled = disabled;
        this.layoutClass = multiline ? 'column' : 'row';
    }
}

export default {
    viewModel: RadioGroupViewModel,
    template: template
};
