import template from "./dropdown.html";
import { randomString } from 'utils';
import ko from 'knockout';

class DropdownViewModel {
    constructor({ 
        selected = ko.observable(), 
        options = [], 
        placeholder = '', 
        disabled = false 
    }) {
        this.name = randomString(5);
        this.options = options;
        this.selected = selected;
        this.disabled = disabled;
        this.focused = ko.observable(false)

        this.selectedLabel = ko.pureComputed(
            () => !!selected() ? options.find( 
                    opt => opt.value === this.selected()
                ).label : placeholder
        );
    }
}

export default {
    viewModel: DropdownViewModel,
    template: template
}