import Disposable from 'disposable';
import ko from 'knockout';
import { isObject, isString, noop, toDashedCase } from 'utils/all';

function addSpaces(str) {
    return str.replace(/[A-Z1-9]+/g, match => ` ${match}`);
}

export default class ColumnViewModel extends Disposable {
    constructor(config, templates, sorting) {
        super();

        config = isObject(config) ? config : { name: config.toString() };

        let {
            name,
            label = addSpaces(name),
            type = 'text',
            accessor = noop,
            css = `${toDashedCase(name)}-col`,
            sortable = false
        } = config;

        this.name = name;
        this.label = label;
        this.accessor = accessor;
        this.template = templates[type];
        this.css = css;

        this.sorting = sorting;
        this.sortKey = sortable && (isString(sortable) ? sortable : name);

        this.sortCss = ko.pureComputed(
            () => this.getSortCss()
        );
    }

    getSortCss() {
        let { sorting, sortKey } = this;

        if (!sorting || !sortKey) {
            return '';
        }

        let { sortBy, order } = ko.unwrap(sorting) || {};
        return `sortable ${
            sortBy === sortKey ? (order === 1 ? 'des' : 'asc') : ''
        }`;
    }

    sortBy() {
        if (!this.sortKey) {
            return;
        }

        let { sortBy, order } = this.sorting();
        this.sorting({
            sortBy: this.sortKey,
            order: sortBy === this.sortKey ? 0 - order : 1
        });
    }

    generateCellTemplate() {
        let { css, name, template } = this;
        return `<td data-bind="css:'${css}',let:{ $data: $data.${name}, $rawData: $data.${name} }">${
            template
        }</td>`;
    }
}
