import template from './chart-legend.html';
import Disposable from 'disposable';
import { formatSize } from 'utils';

class ChartLegendViewModel extends Disposable{
    constructor({ caption = '', items }) {
        super();

        this.caption = caption;
        this.items = items;
        this.formatSize = formatSize;
    }
}

export default {
    viewModel: ChartLegendViewModel,
    template: template
};
