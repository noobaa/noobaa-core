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
        this.focused = ko.observable(false);
        
        let _active = ko.observable(false);
        this.active = ko.pureComputed({
            read: () => this.focused() && _active(),
            write: _active
        });

        this.selectedLabel = ko.pureComputed(
            () => {
                let selectedOpt = !!selected() ? ko.unwrap(options).find( 
                    opt => !!opt && opt.value === this.selected()
                ) : null;

                return !!selectedOpt ? 
                    (selectedOpt.label || selectedOpt.value) :
                    placeholder;
            }
        );
    }
}

export default {
    viewModel: DropdownViewModel,
    template: template
}