import Disposable from 'disposable';
import { isObject, isString, noop, toDashedCase } from 'utils';

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
            accessor = noop,
            css = `${toDashedCase(name)}-col`,
            sortable = false
        } = config;

        this.name = name;
        this.label = label;
        this.accessor = accessor;
        this.cellTemplate = cellTemplates[cellTemplate];
        this.css = css;
        this.sortKey = sortable && (isString(sortable) ? sortable : name);
    }
}
