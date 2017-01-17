import template from './dropdown.html';
import { randomString } from 'utils/string-utils';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { isDefined, clamp } from 'utils/core-utils';

const INPUT_THROTTLE = 1000;

function matchByPrefix({ label }, input) {
    return label.toLowerCase().startsWith(input);
}

class DropdownViewModel extends BaseViewModel {
    constructor({
        selected = ko.observable(),
        options = [],
        placeholder = 'Choose...',
        disabled = false,
        matchOperator = matchByPrefix,
        hasFocus = false
    }) {
        super();

        this.name = randomString(5);
        this.options = ko.pureComputed(
            () => (ko.unwrap(options) || []).map(
                option => {
                    // Handle seperators
                    if (!option) {
                        return null;
                    }

                    // Normalize option.
                    const { value, label = value, remark,
                        css, icon, selectedIcon, tooltip,
                        disabled = false } = option;

                    let _icon = icon;
                    if (selectedIcon) {
                        _icon = ko.pureComputed(
                            () => ko.unwrap(
                                selected() === value ? selectedIcon : icon
                            )
                        );
                    }

                    return { value ,label, remark, css, tooltip,
                        disabled, icon: _icon };
                }
            )
        );

        this.selected = selected;
        this.selectedIndex = ko.pureComputed(
            () => this.options().findIndex(
                opt => opt && opt.value === ko.unwrap(selected)
            )
        );
        this.selectedLabel = ko.pureComputed(
            () => {
                const selected = this.selected();
                const selectedOpt = isDefined(selected) ? this.options().find(
                    opt => !!opt && opt.value === selected
                ) : null;

                return selectedOpt ? selectedOpt.label : ko.unwrap(placeholder);
            }
        );

        this.disabled = disabled;
        this.hasFocus = hasFocus;
        this.active = ko.observable(false);
        this.matchOperator = matchOperator;
        this.searchInput = '';
        this.lastInput = 0;
    }

    isInvalid() {
        return ko.unwrap(this.selected.isModified) &&
            !ko.unwrap(this.selected.isValid);
    }

    handleClick() {
        if (!ko.unwrap(this.disabled)) {
            this.active.toggle();
        }

        return true;
    }

    handleKeyPress({ which }) {
        const optionsCount = this.options().length;

        switch(which) {
            case 9: /* tab */
                this.searchInput = '';
                this.active(false);
                return true;

            case 13: /* enter */
                this.searchInput = '';
                this.active.toggle();
                return false;

            case 33: /* page up */
                this.active(true);
                this.moveSelectionBy(-6);
                return false;

            case 34: /* page down */
                this.active(true);
                this.moveSelectionBy(6);
                return false;

            case 35: /* end */
                this.active(true);
                this.moveSelectionBy(optionsCount);
                return false;

            case 36: /* home */
                this.active(true);
                this.moveSelectionBy(-optionsCount);
                return false;

            case 38: /* up arrow */
                this.active(true);
                this.moveSelectionBy(-1);
                return false;

            case 40: /* down arrow */
                this.active(true);
                this.moveSelectionBy(1);
                return false;

            default:
                this.sreachBy(which);
                return true;
        }
    }

    moveSelectionBy(step) {
        const options = this.options();

        let i = clamp(this.selectedIndex() + step, 0, options.length - 1);
        const dir = clamp(step, -1, 1);

        while (options[i] === null || options[i].disabled) {
            i += dir;
        }

        if (options[i]) {
            this.selected(options[i].value);
        }
        this.searchInput = '';
    }

    sreachBy(keyCode) {
        const char = String.fromCharCode(keyCode).toLowerCase();
        this.searchInput = Date.now() - this.lastInput <= INPUT_THROTTLE ?
            this.searchInput + char :
            char;

        const option = this.options().find(
            option => option && !option.disabled &&
                this.matchOperator(option, this.searchInput)
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
