import template from "./dropdown.html";
import { randomString } from 'utils';
import ko from 'knockout';
import { isDefined } from 'utils';

const INPUT_THROTTLE = 1000;

function matchByPrefix({ label }, input) {
    return label.toString().toLowerCase().startsWith(input);
}

class DropdownViewModel {
    constructor({ 
        selected = ko.observable(), 
        options = [], 
        placeholder = '', 
        disabled = false,
        matchOperator = matchByPrefix
    }) {
        this.name = randomString(5);
        this.options = options;
        this.selected = selected;
        this.selectedIndex = ko.pureComputed(
            () => ko.unwrap(options).findIndex(
                opt => opt && opt.value === ko.unwrap(selected)
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

        this.matchOperator = matchOperator;
        this.searchInput = '';
        this.lastInput = 0;
    }

    handleKeyPress({ which }) {
        switch(which) {
            case 9: /* tab */
            case 13: /* enter */
                this.searchInput = '';
                this.active(false);

                break;

            case 38: /* up arrow */
                this.active(true);
                this.selectPrevOption();
                break;

            case 40: /* down arrow */
                this.active(true);
                this.selectNextOption()
                break;

            default:
                this.sreachBy(which);
                break;
        }

        return true;
    }

    selectPrevOption() {
        let options = ko.unwrap(this.options);
        let prev = options[Math.max(this.selectedIndex() - 1, 0)];
        this.selected(prev.value);
        this.searchInput = ''; 
    }

    selectNextOption() {
        let options = ko.unwrap(this.options);
        let next = options[Math.min(this.selectedIndex() + 1, options.length - 1)];
        this.selected(next.value);
        this.searchInput = '';
    }

    sreachBy(keyCode) {
        let char = String.fromCharCode(keyCode).toLowerCase();
        this.searchInput = Date.now() - this.lastInput <= INPUT_THROTTLE ?
            this.searchInput + char : 
            char;

        let option = ko.unwrap(this.options).find(
            option => this.matchOperator(option, this.searchInput)
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