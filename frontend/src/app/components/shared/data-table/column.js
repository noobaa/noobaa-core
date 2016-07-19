import Disposable from 'disposable';
import { isObject, noop, toDashedCase } from 'utils';

function addSpaces(str) {
    return str.replace(/[A-Z1-9]+/g, match => ` ${match}`);
}

export default class ColumnViewModel extends Disposable {
    constructor(config, cellTemplates) {
        super();
        config = isObject(config) ? config : { name: config.toString() };
        let {
            name,
            label = addSpaces(name),
            cellTemplate = 'text',
            sortable = false,
            accessor = noop,
            css = `${toDashedCase(name)}-col`
        } = config;

        this.name = name;
        this.label = label;
        this.accessor = accessor;
        this.cellTemplate = cellTemplates[cellTemplate];
        this.sortable = sortable;
        this.css = css;
    }
}
