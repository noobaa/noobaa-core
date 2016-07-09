import template from './dropdown.html';
import { randomString } from 'utils';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { isDefined, clamp } from 'utils';

const INPUT_THROTTLE = 1000;

function matchByPrefix({ label, value }, input) {
    return (label || value) .toString().toLowerCase().startsWith(input);
}

class DropdownViewModel extends BaseViewModel {
    constructor({
        selected = ko.observable(),
        options = [],
        placeholder = '',
        disabled = false,
        matchOperator = matchByPrefix
    }) {
        super();

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
        let optionsCount = ko.unwrap(this.options).length;

        switch(which) {
            case 9: /* tab */
                this.searchInput = '';
                this.active(false);
                break;

            case 13: /* enter */
                this.searchInput = '';
                this.active.toggle();
                break;

            case 33: /* page up */
                this.active(true);
                this.moveSelectionBy(-6);
                break;

            case 34: /* page down */
                this.active(true);
                this.moveSelectionBy(6);
                break;

            case 35: /* end */
                this.active(true);
                this.moveSelectionBy(optionsCount);
                break;

            case 36: /* home */
                this.active(true);
                this.moveSelectionBy(-optionsCount);
                break;

            case 38: /* up arrow */
                this.active(true);
                this.moveSelectionBy(-1);
                break;

            case 40: /* down arrow */
                this.active(true);
                this.moveSelectionBy(1);
                break;

            default:
                this.sreachBy(which);
                break;
        }

        return true;
    }

    moveSelectionBy(step) {
        let options = ko.unwrap(this.options);

        let i = clamp(this.selectedIndex() + step, 0, options.length - 1);
        let dir = clamp(step, -1, 1);

        while (options[i] === null) {
            i += dir;
        }

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
