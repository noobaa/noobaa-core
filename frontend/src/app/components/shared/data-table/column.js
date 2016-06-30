import ko from 'knockout';
import { isObject, toDashedCase } from 'utils';

export default class ColumnViewModel {
    constructor(config, templates, sorting) {
        config = isObject(config) ? config : { name: config.toString() };
        let { name, label = name, template = 'text', sortable = false } = config;

        this.name = name;
        this.label = label;
        this.templateHtml = templates[template];
        this.sortable = sortable;
        this.thCss = `${toDashedCase(name)}-col`;

        // The computed is used in order to prevent creation of a new Column
        // instance on each sorting change.
        this.spanCss = ko.pureComputed(
            () => {
                let sort = ko.unwrap(sorting);
                if (!sorting || !sortable) {
                    return '';
                }

                return `sortable ${
                    sort.sortBy === name ? (sort.order === 1 ? 'des' : 'asc') : ''
                }`;
            }
        );
    }
}
