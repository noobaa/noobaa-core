import template from './dropdown.html';
import { randomString } from 'utils';
import ko from 'knockout';
import { isDefined } from 'utils';

const INPUT_THROTTLE = 1000;

function matchByPrefix({ label, value }, input) {
    return (label || value) .toString().toLowerCase().startsWith(input);
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
            () => (ko.unwrap(options) || []).findIndex(
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
                let options = ko.unwrap(this.options);
                let selected = this.selected();

                let selectedOpt = options && isDefined(selected) ? options.find(
                    opt => !!opt && opt.value === selected
                ) : null;

                return selectedOpt ? (selectedOpt.label || selectedOpt.value) : placeholder;
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
                this.moveSelection(false);
                break;

            case 40: /* down arrow */
                this.active(true);
                this.moveSelection(true);
                break;

            default:
                this.sreachBy(which);
                break;
        }

        return true;
    }

    moveSelection(moveDown) {
        let options = ko.unwrap(this.options);

        let i = this.selectedIndex();
        do {
            i += moveDown ? 1 : -1;
        } while (options[i] == null);


        if (options[i]) {
            this.selected(options[i].value);
        }
        this.searchInput = '';
    }

    sreachBy(keyCode) {
        let char = String.fromCharCode(keyCode).toLowerCase();
        this.searchInput = Date.now() - this.lastInput <= INPUT_THROTTLE ?
            this.searchInput + char :
            char;

        let option = ko.unwrap(this.options).find(
            option => option && this.matchOperator(option, this.searchInput)
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
};
