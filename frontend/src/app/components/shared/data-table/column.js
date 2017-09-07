/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { isObject, isString, noop } from 'utils/core-utils';
import { toDashedCase } from 'utils/string-utils';

function addSpaces(str) {
    return str.replace(/[A-Z1-9]+/g, match => ` ${match}`);
}

export default class ColumnViewModel {
    constructor(config, templates, sorting) {
        const normalized = isObject(config) ? config : { name: config.toString() };
        const {
            name,
            label = addSpaces(name),
            type = 'text',
            accessor = noop,
            css = `${toDashedCase(name)}-col`,
            sortable = false
        } = normalized;

        this.name = name;
        this.label = label;
        this.accessor = accessor;
        this.template = templates[type];
        this.css = css;

        this.sorting = sorting;
        this.sortKey = sortable && (isString(sortable) ? sortable : name);
        this.sortCss = ko.pureComputed(() => this.getSortCss());
    }

    getSortCss() {
        const { sorting, sortKey } = this;

        if (!sorting || !sortKey) {
            return '';
        }

        const { sortBy, order } = ko.unwrap(sorting) || {};
        return `sortable ${
            sortBy === sortKey ? (order === 1 ? 'des' : 'asc') : ''
        }`;
    }

    sortBy() {
        if (!this.sortKey) {
            return;
        }

        const { sortBy, order } = this.sorting();
        this.sorting({
            sortBy: this.sortKey,
            order: sortBy === this.sortKey ? 0 - order : 1
        });
    }

    generateCellTemplate() {
        const { css, name, template } = this;
        return `<td ko.css="'${css}'" ko.let="{ $data: $data.${name}, $rawData: $data.${name} }">${
            template
        }</td>`;
    }
}
