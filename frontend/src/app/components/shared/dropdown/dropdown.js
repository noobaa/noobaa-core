/* Copyright (C) 2016 NooBaa */

// import './dropdown-binding';
import template from './dropdown.html';
import OptionRowViewModel from './option-row';
import ActionRowViewModel from './action-row';
import ko from 'knockout';
import { isObject } from 'utils/core-utils';
import { stringifyAmount, pluralize } from 'utils/string-utils';
import { inputThrottle } from 'config';

const maxOptionCount = 1000;

// Cannot use ensure array util (core utils) because
// of the special case of an empty string (which in this case)
// should become an empty string.
function _toArray(value) {
    if (Array.isArray(value)) {
        return value;
    }

    if (value) {
        return [value];
    }

    return [];
}

function _normalizeOptions(options) {
    return options.map(option => {
        const {
            value = option,
            label = value,
            remark = '',
            icon,
            selectedIcon = icon,
            css,
            disabled = false
        } = option;

        return {
            value,
            label,
            remark,
            icon,
            selectedIcon,
            css,
            disabled
        };
    });
}

function _summarizeSelected(subject, values, placeholder, options) {
    const count = values.length;
    if (count == 0) {
        return placeholder;
    }

    if (count === 1) {
        const [first] = values;
        const selected = options.find(opt => opt.value === first);
        return selected && selected.label;
    }

    if (count === options.length) {
        return `All ${subject}s selected`;
    }

    return `${stringifyAmount(subject, count)} selected`;
}

function _getEmptyMessage(
    optionCount,
    filteredCount,
    visibleCount,
    isLoading,
    inError,
    errorMessage,
    emptyMessage,
    filterMessage,
    listTooLongMessage
) {
    if (isLoading) {
        return null;
    }

    if (inError) {
        return {
            text: errorMessage,
            isError: true
        };
    }

    if (optionCount === 0) {
        return {
            text: emptyMessage,
            isError: false
        };
    }

    if (filteredCount === 0) {
        return {
            text: filterMessage,
            isError: false
        };
    }

    if (visibleCount === 0) {
        return {
            text: listTooLongMessage,
            isError: false
        };
    }

    return null;
}

function _matchOption(option, filter) {
    const text = option.label.toString().toLowerCase();
    return !filter || text.includes(filter);
}

function _findFirstFocusId(filterVisible, actionRows, selectAllVisible, optionRows) {
    if (filterVisible) {
        return 'FILTER';
    }

    const [actionFocusId] = actionRows
        .filter(row => !row.disabled())
        .map(row => row.focusId);

    if (actionFocusId) {
        return actionFocusId;
    }

    if (selectAllVisible) {
        return 'SELECT_ALL';
    }

    const [optionFocusId] = optionRows
        .filter(row => !row.disabled())
        .map(row => row.focusId);

    if (optionFocusId) {
        return optionFocusId;
    }

    return 'SUMMARY';
}

class DropdownViewModel {
    sub = null;
    subject = '';
    selectableValues = [];
    selected = null;
    fistItemFocusId = '';
    summary = ko.observable();
    usingPlacholderText = ko.observable();
    multiselect = ko.observable();
    disabled = ko.observable();
    focus = ko.observable('');
    active = ko.observable(false);
    loading = ko.observable();
    isListVisible = ko.observable();
    optionRows = ko.observableArray();
    actionRows = ko.observableArray();
    hiddenOptionCount = ko.observable();
    isFilterVisible = ko.observable();
    isSelectAllVisible = ko.observable();
    selectAllLabel = ko.observable();
    filter = ko.observable().throttle(inputThrottle);
    filterPlaceholder = ko.observable();
    selectAllValue = ko.observable();
    emptyMessage = ko.observable();
    tabIndex = ko.observable();
    summaryHasFocus = ko.observable();
    filterHasFocus = ko.observable();
    selectAllHasFocus = ko.observable();
    rowParams = {
        onFocus: this.focus
    };

    constructor({ selected, hasFocus, ...rest }) {
        // Check if the dropdown should be focused on initial render.
        if (ko.unwrap(hasFocus)) {
            this.focus('SUMMARY');
        }

        this.selected = ko.isWritableObservable(selected) ?
            selected :
            ko.observable();

        const comp = ko.pureComputed(() => ko.deepUnwrap({
            ...rest,
            selected: this.selected,
            filterText: this.filter,
            focus: this.focus,
            active: this.active
        })).extend({
            rateLimit: 10
        });

        this.onUpdate(comp());
        this.sub = comp.subscribe(val => this.onUpdate(val));
    }

    onUpdate(args) {
        const {
            subject = 'item',
            multiselect = false,
            placeholder = multiselect ? `Select ${pluralize(subject)}` : `Choose ${subject}`,
            filter = false,
            filterPlaceholder = `Search ${subject || ''}`,
            filterText = '',
            disabled = false,
            loading = false,
            error = false,
            emptyMessage = stringifyAmount(subject, 0, 'No'),
            errorMessage = 'Ooops... Someting went wrong',
            filterMessage = 'No Match',
            listTooLongMessage = 'List too long to show',
            selectAllLabel = 'Select All',
            actions = [],
            options: rawOptions = [],
            selected,
            focus,
            active
        } = args;

        // Fix active in case we lost the focus.
        if (!focus && active) {
            // Updating active will create a second onUpdate.
            // so in order to prevent duplicate updates we terminate the
            // currnet update.
            this.active(false);
            this.filter('');
            return;
        }

        const options = _normalizeOptions(rawOptions);
        const isFilterVisible = filter && !loading && !error && options.length > 0;
        const isSelectAllVisible = multiselect && !filterText;
        const selectedValues = _toArray(selected);
        const normalizedFilter = filterText.trim().toLowerCase();
        const usingPlacholderText = selectedValues.length === 0;
        const tabIndex = disabled ? false : '0';

        const filteredOptions = options
            .filter(option => !error && _matchOption(option, normalizedFilter));

        const visibleOptions = filteredOptions.length < maxOptionCount ?
            filteredOptions
            : [];

        const selectAllValue =
            (selectedValues.length === options.length && 'ALL') ||
            (selectedValues.length > 0 && 'SOME') ||
            'NONE';

        const emptyMessageInfo = _getEmptyMessage(
            options.length,
            filteredOptions.length,
            visibleOptions.length,
            loading,
            error,
            errorMessage,
            emptyMessage,
            filterMessage,
            listTooLongMessage
        );

        const actionRows = actions
            .map((action, i) => {
                const row = this.actionRows.get(i) || new ActionRowViewModel(this.rowParams);
                row.onUpdate(action, focus);
                return row;
            });

        const optionRows = visibleOptions
            .map((option, i) => {
                const row = this.optionRows.get(i) || new OptionRowViewModel(this.rowParams);
                row.onUpdate(option, multiselect, selectedValues, focus);
                return row;
            });

        const selectableValues = options
            .filter(option => !option.disabled)
            .map(option => isObject(option) ? option.value : option);

        const firstItemFocusId = _findFirstFocusId(
            isFilterVisible,
            actionRows,
            isSelectAllVisible,
            optionRows
        );

        this.isListVisible(!disabled && active);
        this.selectableValues = selectableValues;
        this.isFilterVisible(isFilterVisible);
        this.filterPlaceholder(filterPlaceholder);
        this.isSelectAllVisible(isSelectAllVisible);
        this.selectAllLabel(selectAllLabel);
        this.multiselect(multiselect);
        this.disabled(disabled);
        this.selectAllValue(selectAllValue);
        this.loading(loading);
        this.tabIndex(tabIndex);
        this.summary(_summarizeSelected(subject, selectedValues, placeholder, options));
        this.usingPlacholderText(usingPlacholderText);
        this.emptyMessage(emptyMessageInfo);
        this.actionRows(actionRows);
        this.optionRows(optionRows);
        this.summaryHasFocus(focus === 'SUMMARY');
        this.filterHasFocus(focus === 'FILTER');
        this.selectAllHasFocus(focus === 'SELECT_ALL');
        this.firstItemFocusId = firstItemFocusId;
    }

    onSummaryFocus(val) {
        this.focus(val ? 'SUMMARY' : '');
    }

    onSummaryClick() {
        this._toggleList();
    }

    onSummaryKeyDown(_, evt) {
        const code = evt.code.toLowerCase();

        switch (code) {
            case 'space':
            case 'enter': {
                this._toggleList();
                return false;
            }

            case 'arrowup': {
                this._toggleList(true);
                return false;
            }

            case 'escape': {
                if (this.active()) {
                    evt.stopPropagation();
                    this._toggleList(true);
                    return false;
                }
                return true;
            }

            case 'arrowdown': {
                if (!this.active()) {
                    this.active(true);

                } else {
                    this.focus(this.firstItemFocusId);
                }

                return false;
            }
        }
    }

    onListKeydown(_, evt) {
        const code = evt.code.toLowerCase();

        switch (code) {
            case 'escape': {
                evt.stopPropagation();
                this._toggleList(true);
                return false;
            }

            case 'arrowup': {
                if (this.focus() === this.firstItemFocusId) {
                    this.focus('SUMMARY');
                    return false;
                }
            }
        }


        return true;
    }

    onSelectAllFocus(val) {
        this.focus(val ? 'SELECT_ALL' : '');
    }

    onSelectAllClick() {
        const selected = _toArray(this.selected());
        const values = selected.length === 0 ?
            this.selectableValues :
            [];

        this.selected(values);
    }

    onFilterKeyDown(_, evt) {
        // Prevent enter on filter form submitting outer forms.
        return evt.code.toLowerCase() !== 'enter';
    }

    onFilterFocus(val) {
        this.focus(val ? 'FILTER' : '');
    }

    onActionClick(actionRow) {
        actionRow.onClick();
        this._toggleList(true);
    }

    onOptionClick(optionRow) {
        if (optionRow.disabled()) {
            return;
        }

        if (this.multiselect()) {
            const value = optionRow.value();
            const before = _toArray(this.selected());
            const after = before.filter(other => other !== value);
            if (before.length === after.length) after.push(value);

            this.selected(after);

        } else {
            this.selected(optionRow.value());
            this._toggleList(true);
        }

        return true;
    }

    _toggleList(close = this.active()) {
        if (close) {
            this.focus('SUMMARY');
            this.active(false);
            this.filter('');
        } else {
            this.active(true);
        }

    }

    dispose() {
        this.sub.dispose();
    }
}

export default {
    viewModel: DropdownViewModel,
    template: template
};
