import template from './radio-group.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { randomString } from 'utils';

class RadioGroupViewModel extends BaseViewModel {
    constructor({
            selected = ko.observable(),
            name = randomString(5),
            options,
            multiline = false,
            disabled = false
    }) {
        super();

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
