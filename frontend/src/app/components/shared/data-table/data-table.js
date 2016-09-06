import template from './data-table.html';
import ColumnViewModel from './column';
import * as defaultCellTemplates from './cell-templates';
import Disposable from 'disposable';
import ko from 'knockout';
import { noop, isFunction } from 'utils';

const scrollThrottle = 750;

function generateRowTemplate(columns, rowCssProp, hasRowClickHandler) {
    let rowCss = rowCssProp ? `css: ${rowCssProp}` : '';
    let rowClick = hasRowClickHandler ? ',click: $component.rowClick' : '';

    return `<tr class="data-row" data-bind="${rowCss}${rowClick}">${
        columns.map(
            ({ name, css, cellTemplate }) =>
                `<td data-bind="css:'${css}',let:{$data:${name},$rawData:${name}}">${
                    cellTemplate
                }</td>`
        )
        .join('\n')
    }</tr> `;
}

class DataTableViewModel extends Disposable {
    constructor(params, customTemplates) {
        super();

        let {
            columns = [],
            rowFactory = noop,
            data,
            sorting,
            scroll = ko.observable(),
            rowCssProp,
            rowClick,
            emptyMessage
        } = params;

        // Combine default templates with inline templates.
        let cellTemplates = Object.assign(
            {},
            defaultCellTemplates,
            customTemplates
        );

        // Create view model for columns.
        this.columns = ko.pureComputed(
            () => ko.unwrap(columns).map(
                value => new ColumnViewModel(value, cellTemplates)
            )
        );

        this.rowFactory = rowFactory;
        this.rows = ko.observableArray();

        // Empty table message handling.
        this.emptyMessage = emptyMessage;
        this.isEmpty = ko.pureComputed(
            () => this.rows().length === 0
        );

        // Init the table rows.
        this.updateRows(data);

        // Update the table rows on data change event.
        if (ko.isObservable(data)) {
            this.addToDisposeList(
                data.subscribe(
                    () => this.updateRows(data)
                )
            );
        }

        // Hold table sorting infromation (sortBy and order).
        this.sorting = sorting;

        // Hold current position of vertical scroll of the table.
        this.scroll = scroll.extend({
            rateLimit: {
                method: 'notifyWhenChangesStop',
                timeout: scrollThrottle
            }
        });

        // Generate a row template
        this.rowTemplate = ko.pureComputed(
            () => generateRowTemplate(
                ko.unwrap(this.columns),
                rowCssProp,
                rowClick instanceof Function
            )
        );

        this.rowClick = rowClick;
    }

    updateRows(data) {
        let curr = this.rows().length;
        let target = (ko.unwrap(data) || []).length;
        let diff = curr - target;

        if (diff < 0) {
            for (let i = curr; i < target; ++i) {
                this.rows.push(
                    this.rowFactory(() => (ko.unwrap(data) || [])[i])
                );
            }

        } else if (diff > 0) {
            while(diff-- > 0) {
                let row = this.rows.pop();
                isFunction(row.dispose) && row.dispose();
            }
        }

        let table = document.querySelector('table[data-bind]');
        if (table.scrollHeight < table.clientHeight)
            table.tHead.className='shrinked';
        else
            table.tHead.className='';
    }

    getSortCss(sortKey) {
        if (!this.sorting || !sortKey) {
            return '';
        }

        let { sortBy, order } = ko.unwrap(this.sorting) || {};
        return `sortable ${
            sortBy === sortKey ? (order === 1 ? 'des' : 'asc') : ''
        }`;
    }

    sortBy(sortKey) {
        let { sortBy, order } = this.sorting();
        this.sorting({
            sortBy:sortKey,
            order: sortBy === sortKey ? 0 - order : 1
        });
    }
}

function viewModelFactory(params, info) {
    let cellTemplates = info.templateNodes
        .filter(
            ({ nodeType }) => nodeType === 1
        )
        .reduce(
            (templates, template) => {
                let name = template.getAttribute('name');
                let html = template.innerHTML;
                templates[name] = html;
                return templates;
            },
            {}
        );

    return new DataTableViewModel(params, cellTemplates);
}

export default {
    viewModel: { createViewModel: viewModelFactory },
    template: template
};
