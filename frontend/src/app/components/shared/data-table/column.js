import Disposable from 'disposable';
import { isObject, noop, toDashedCase } from 'utils';

export default class ColumnViewModel extends Disposable {
    constructor(config) {
        super();

        config = isObject(config) ? config : { name: config.toString() };
        let {
            name,
            label = name,
            template = 'text',
            sortable = false,
            accessor = noop,
            css = `${toDashedCase(name)}-col`
        } = config;

        this.name = name;
        this.label = label;
        this.accessor = accessor;
        this.template = template;
        this.sortable = sortable;
        this.css = css;
    }
}
