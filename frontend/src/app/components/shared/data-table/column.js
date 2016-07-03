import { isObject, toDashedCase } from 'utils';

export default class ColumnViewModel {
    constructor(config) {
        config = isObject(config) ? config : { name: config.toString() };
        let { name, label = name, template = 'text', sortable = false } = config;

        this.name = name;
        this.label = label;
        this.template = template;
        this.sortable = sortable;
        this.cellCss = `${toDashedCase(name)}-col`;
    }
}
