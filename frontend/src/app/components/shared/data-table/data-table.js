/* Copyright (C) 2016 NooBaa */

import './data-table-binding';
import template from './data-table.html';
import ColumnViewModel from './column';
import * as cellTemplates from './cell-templates';
import ko from 'knockout';
import { isFunction } from 'utils/core-utils';
import { isString, echo } from 'utils/core-utils';

const scrollThrottle = 750;

const expandColumnDescriptor = {
    name: 'expand',
    type: 'expand',
    label: ''
};

class DataTableViewModel {
    constructor(params, inlineTemplates) {
        const {
            columns = [],
            // The default is used to strip the accessor in case the
            // data array is the actual rows view model array
            rowFactory,
            data,
            sorting,
            scroll = ko.observable(),
            rowCssProp,
            rowDisabledProp,
            rowClick,
            subRow,
            emptyMessage,
            loading = false,
            disabled = false,
            expandColumn = false,
            visibleColumns
        } = params;

        const templates = Object.assign({}, cellTemplates, inlineTemplates);
        this.subRowTemplate = subRow && inlineTemplates[subRow];

        this.tableCss = {
            'has-sub-rows': Boolean(this.subRowTemplate),
            'table-disabled': disabled
        };

        // Hold current position of vertical scroll of the table.
        this.scroll = scroll.extend({
            rateLimit: {
                method: 'notifyWhenChangesStop',
                timeout: scrollThrottle
            }
        });

        // Hold table sorting infromation (sortBy and order).
        this.sorting = sorting;
        this.expandColumn = expandColumn;

        // Create view model for columns.
        this.columns = ko.pureComputed(
            () => {
                let descriptors = ko.unwrap(columns);

                // Add a descriptor for the sub row expand/collapse button.
                if (this.subRowTemplate && this.expandColumn) {
                    descriptors = descriptors.concat(expandColumnDescriptor);
                }

                return descriptors.map(descriptor =>
                    new ColumnViewModel(descriptor, templates, sorting)
                );
            }
        );
        this.visibleColumns = visibleColumns;
        this.columnCount = ko.pureComputed(() => {
            const visible = ko.unwrap(this.visibleColumns) || this.columns();
            return visible.length;
        });

        this.rowFactory = rowFactory;
        this.rows = ko.observableArray();

        // This is used to generate a complete template for a row in order to
        // to skip using knockout template bindings for each column which will
        // strip down the observable and rerender the entire cell each time the
        // computeds in the rowViewModel change values.
        this.rowTemplate = ko.pureComputed(
            () => this.columns()
                .map(column => column.generateCellTemplate())
                .join('')
        );

        this.rowCssProp = rowCssProp;
        this.rowDisabledProp = rowDisabledProp;
        this.rowClick = rowClick;

        // Set loading flags
        this.loading = loading;

        // Empty table message handling.
        this.emptyMessage = ko.pureComputed(
            () => {
                if (ko.unwrap(loading) || this.rows().length !== 0) {
                    return null;
                }

                return ko.unwrap(emptyMessage);
            }
        );

        // Init the table rows.
        this.updateRows(data);

        // Update the table rows on data change event.
        if (ko.isObservable(data)) {
            this.updateSub = data.subscribe(() => this.updateRows(data));
        }
    }
    updateRows(data) {
        const currLen = this.rows().length;
        const nextLen = (ko.unwrap(data) || []).length;
        let diff = currLen - nextLen;

        if (diff < 0) {
            for (let i = currLen; i < nextLen; ++i) {
                const vm = isFunction(this.rowFactory) ?
                    this.rowFactory(() => (ko.unwrap(data) || [])[i]) :
                    (ko.unwrap(data) || [])[i];

                const md = this.newRowMetaData(vm);
                this.rows.push({ vm, md });
            }
        } else if (diff > 0) {
            while (diff-- > 0) {
                const { vm } = this.rows.pop();
                isFunction(vm.dispose) && vm.dispose();
            }
        }
    }

    newRowMetaData(rowVM) {
        let isExpanded = true;
        if (isString(this.expandColumn)) {
            const columnProp = rowVM[this.expandColumn];
            isExpanded = ko.isWritableObservable(columnProp) ?
                columnProp :
                ko.pureComputed({
                    read: () => ko.unwrap(columnProp),
                    write: echo
                });
        } else if (this.expandColumn) {
            isExpanded = ko.observable(false);
        }

        let isDisabled = false;
        if (isString(this.rowDisabledProp)) {
            const value = rowVM[this.rowDisabledProp];
            isDisabled = ko.isObservable(value) ?
                ko.pureComputed(value) :
                value;
        }

        return {
            template: this.rowTemplate,
            subRowTemplate: this.subRowTemplate,
            columnCount: this.columnCount,
            css: ko.pureComputed(() => ko.unwrap(rowVM[this.rowCssProp])),
            isExpanded,
            isDisabled,
            clickHandler: this.rowClick && (() => this.rowClick(rowVM))
        };
    }

    isColumnVisible(name) {
        const visibleColumns = ko.unwrap(this.visibleColumns);
        return !Array.isArray(visibleColumns) || visibleColumns.includes(name);
    }

    dispose() {
        const { rows, updateSub } = this;
        rows().forEach(row => isFunction(row.vm.dispose) && row.vm.dispose());
        updateSub && updateSub.dispose();
    }
}

function viewModelFactory(params, info) {
    const templates = info.templateNodes
        .filter(({ nodeType }) => nodeType === 1)
        .reduce((templates, template) => {
            const name = template.getAttribute('name');
            const html = template.innerHTML;
            templates[name] = html;
            return templates;
        }, {});

    return new DataTableViewModel(params, templates);
}

export default {
    viewModel: { createViewModel: viewModelFactory },
    template: template
};
