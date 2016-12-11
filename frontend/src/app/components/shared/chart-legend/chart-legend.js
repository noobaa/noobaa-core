import template from './chart-legend.html';
import Disposable from 'disposable';
import { echo, deepFreeze } from 'utils/core-utils';
import { formatSize } from 'utils/string-utils';
import ko from 'knockout';

const formatMapping = deepFreeze({
    echo: echo,
    size: formatSize
});

class ChartLegendViewModel extends Disposable{
    constructor({
        caption = '',
        items,
        format = 'echo',
        formatter = formatMapping[format]
    }) {
        super();

        this.caption = caption;
        this.items = items;
        this.formatter = formatter;
    }

    getFormattedValue(value) {
        return this.formatter(ko.unwrap(value));
    }
}

export default {
    viewModel: ChartLegendViewModel,
    template: template
};
