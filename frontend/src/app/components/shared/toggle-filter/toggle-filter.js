import template from './toggle-filter.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { randomString } from 'utils';

class ToggleFilterViewModel extends BaseViewModel {
    constructor({
            options = [],
            selected = ko.observable(),
            name = randomString(5)
        })
    {
        super();

        this.options = options;
        this.selected = selected;
        this.group = name;
    }
}

export default {
    viewModel: ToggleFilterViewModel,
    template: template
};
