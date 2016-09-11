import template from './chart-legend.html';
import Disposable from 'disposable';
import { formatSize } from 'utils';
import ko from 'knockout';

class ChartLegendViewModel extends Disposable{
    constructor({ caption = '', items }) {
        super();

        this.caption = caption;
        this.items = items;
        this.formatSize = formatSize;
    }

    getFormattedValue(value) {
        return formatSize(ko.unwrap(value));
    }
}

export default {
    viewModel: ChartLegendViewModel,
    template: template
};
