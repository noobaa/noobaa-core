import './data-table-binding';
import template from './data-table.html';
import ColumnViewModel from './column';
import * as cellTemplates from './cell-templates';
import Disposable from 'disposable';
import ko from 'knockout';
import { noop, isFunction } from 'utils';

const scrollThrottle = 750;

const expandColumnDescriptor = {
    name: 'expand',
    type: 'expand',
    label: ''
};

class DataTableViewModel extends Disposable {
    constructor(params, inlineTemplates) {
        super();

        let {
            columns = [],
            rowFactory = noop,
            data,
            sorting,
            scroll = ko.observable(),
            rowCssProp,
            rowClick,
            subRow,
            emptyMessage
        } = params;

        let templates = Object.assign({}, cellTemplates, inlineTemplates);
        this.subRowTemplate = subRow && inlineTemplates[subRow];

        this.tableCss = {
            'has-sub-rows': Boolean(this.subRowTemplate)
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

        // Create view model for columns.
        this.columns = ko.pureComputed(
            () => {
                let descriptors = ko.unwrap(columns);

                // Add a descriptor for the sub row expand/collapse button.
                if (this.subRowTemplate) {
                    descriptors = descriptors.concat(expandColumnDescriptor);
                }

                return descriptors.map(
                    descriptor => new ColumnViewModel(descriptor, templates)
                );
            }
        );

        this.columnCount = ko.pureComputed(
            () => this.columns().length
        );

        this.rowFactory = rowFactory;
        this.rows = ko.observableArray();
        this.rowsMetaData = ko.observableArray();

        // This is used to generate a complete template for a row in order to
        // to skip using knockout template bindings for each column which will
        // strip down the observable and rerender the entire cell each time the
        // computeds in the rowViewModel change values.
        this.rowTemplate = ko.pureComputed(
            () => this.columns()
                .map(
                    column => column.generateCellTemplate()
                )
                .join('')
        );

        this.rowCssProp = rowCssProp;
        this.rowClick = rowClick;

        // Empty table message handling.
        this.emptyMessage = ko.pureComputed(
            () => this.rows().length === 0 ? ko.unwrap(emptyMessage) : null
        );

        this.rowsMeta = ko.observableArray();

        // This hold the expand state for the sub rows.
        this.expanded = ko.observableArray();

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
    }

    updateRows(data) {
        let curr = this.rows().length;
        let target = (ko.unwrap(data) || []).length;
        let diff = curr - target;

        if (diff < 0) {
            for (let i = curr; i < target; ++i) {
                let viewModel = this.rowFactory(
                    () => (ko.unwrap(data) || [])[i]
                );
                let metaData = this.newRowMetaData(viewModel);

                this.rows.push({
                    vm: viewModel,
                    md: metaData
                });
            }

        } else if (diff > 0) {
            while(diff-- > 0) {
                let viewModel = this.rows.pop().vm;
                isFunction(viewModel.dispose) && viewModel.dispose();
            }
        }
    }

    newRowMetaData(viewModel) {
        return {
            template: this.rowTemplate,
            subRowTemplate: this.subRowTemplate,
            columnCount: this.columnCount,
            css: ko.pureComputed(
                () => ko.unwrap(viewModel[this.rowCssProp])
            ),
            isExpanded: ko.observable(false),
            clickHandler: this.rowClick ?
                () => this.rowClick(viewModel) :
                undefined
        };
    }
}

function viewModelFactory(params, info) {
    let templates = info.templateNodes
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

    return new DataTableViewModel(params, templates);
}

export default {
    viewModel: { createViewModel: viewModelFactory },
    template: template
};
