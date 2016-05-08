import template from "./dropdown.html";
import { randomString } from 'utils';
import ko from 'knockout';
import { isDefined } from 'utils';

const INPUT_THROTTLE = 1000;

function defaultSearchSelector({ label }, input) {
    return label.toString().toLowerCase().startsWith(input);
}

class DropdownViewModel {
    constructor({ 
        selected = ko.observable(), 
        options = [], 
        placeholder = '', 
        disabled = false,
        searchSelector = defaultSearchSelector
    }) {
        this.name = randomString(5);
        this.options = options;
        this.selected = selected;
        this.selectedIndex = ko.pureComputed(
            () => ko.unwrap(options).findIndex(
                opt => opt.value === ko.unwrap(selected)
            )
        );

        this.disabled = disabled;
        this.focused = ko.observable(false);

        let _active = ko.observable(false);
        this.active = ko.pureComputed({
            read: () => this.focused() && _active(),
            write: _active
        });

        this.selectedLabel = ko.pureComputed(
            () => {
                let selectedOpt = isDefined(selected()) ? ko.unwrap(options).find( 
                    opt => !!opt && opt.value === this.selected()
                ) : null;

                return !!selectedOpt ? 
                    (selectedOpt.label || selectedOpt.value) :
                    placeholder;
            }
        );

        this.searchSelector = searchSelector;
        this.searchInput = '';
        this.lastInput = 0;
    }

    scrollTo({ which }) {
        let char = String.fromCharCode(which).toLowerCase();
        this.searchInput = Date.now() - this.lastInput <= INPUT_THROTTLE ?
            this.searchInput + char : 
            char;

        let option = ko.unwrap(this.options).find(
            option => this.searchSelector(option, this.searchInput)
        );

        if (option) {
            this.selected(option.value);
        }

        this.lastInput = Date.now();
    }
}

export default {
    viewModel: DropdownViewModel,
    template: template
}