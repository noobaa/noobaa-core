/* Copyright (C) 2016 NooBaa */

import template from './dropdown.html';
import { randomString } from 'utils/string-utils';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { isDefined, clamp } from 'utils/core-utils';

const inputThrottle = 1000;

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
        hasFocus = false,
        loading = false,
        invalid,
    }) {
        super();

        this.name = randomString(5);

        this.options = ko.pureComputed(
            () => {
                let selectedFound = false;
                const normalized = (ko.deepUnwrap(options) || [])
                    .map(option => {
                        // Handle seperators
                        if (!options) return null;

                        // Normalize option.
                        const {
                            value = option,
                            label = value,
                            remark,
                            css,
                            icon: _icon,
                            selectedIcon,
                            tooltip,
                            disabled = false
                        } = option;

                        const icon = !selectedIcon ?
                            _icon :
                            ko.pureComputed(
                                () => selected() === value ? selectedIcon : icon
                            );

                        if (selected.peek() === value) {
                            selectedFound = true;
                        }

                        return { value ,label, remark, css, tooltip, disabled, icon };
                    });

                if (selected.peek() && !selectedFound) {
                    selected(null);
                }

                return normalized;
            }
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

        this.invalid = isDefined(invalid) ? invalid : ko.pureComputed(
            () => ko.unwrap(selected.isModified) && !ko.unwrap(selected.isValid)
        );

        this.disabled = disabled;
        this.hasFocus = hasFocus;
        this.loading = loading;
        this.active = ko.observable(false);
        this.matchOperator = matchOperator;
        this.searchInput = '';
        this.lastInput = 0;
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
        const last = options.length - 1;

        let i = clamp(this.selectedIndex() + step, 0, last);
        const dir = clamp(step, -1, 1);
        while (options[i] === null || (options[i] || {}).disabled) {
            i += dir;
        }

        if (options[i]) {
            this.selected(options[i].value);
        }
        this.searchInput = '';
    }

    sreachBy(keyCode) {
        const char = String.fromCharCode(keyCode).toLowerCase();
        this.searchInput = Date.now() - this.lastInput <= inputThrottle ?
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
