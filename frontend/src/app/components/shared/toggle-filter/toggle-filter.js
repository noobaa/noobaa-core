import template from './toggle-filter.html';
import ko from 'knockout';
import { randomString } from 'utils';

class ToggleFilterViewModel {
    constructor({
            options = [],
            selected = ko.observable(),
            name = randomString(5)
        })
    {
        this.options = options;
        this.selected = selected;
        this.group = name;
    }
}

export default {
    viewModel: ToggleFilterViewModel,
    template: template
};
