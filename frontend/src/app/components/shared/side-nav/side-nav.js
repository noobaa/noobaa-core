import template from './side-nav.html';
import ko from 'knockout';

class SideNavViewModel {
    constructor({ items, selected }) {
        this.items = items;
        this.selected = selected;
    }

    isSelected(item) {
        return item === ko.unwrap(this.selected);
    }
}

export default {
    viewModel: SideNavViewModel,
    template: template
};
