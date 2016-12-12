import template from './chart-legend.html';
import Disposable from 'disposable';
import { echo, deepFreeze } from 'utils/core-utils';
import { formatSize } from 'utils/string-utils';
import ko from 'knockout';

const formatMapping = deepFreeze({
    none: echo,
    size: formatSize
});

class ChartLegendViewModel extends Disposable{
    constructor({
        caption = '',
        items,
        format = 'none',
        formatter = formatMapping[format]
    }) {
        super();

        this.caption = caption;
        this.formatter = formatter;

        this.items = ko.pureComputed(
            () => ko.unwrap(items).map(
                item => this.normalizeItem(item)
            )
        );

    }

    normalizeItem({ label, color, value, visible = true }) {
        const formattedValue = this.formatter(ko.unwrap(value));
        const style = { 'border-color': color };

        return { label, style, formattedValue, visible };
    }

}

export default {
    viewModel: ChartLegendViewModel,
    template: template
};
