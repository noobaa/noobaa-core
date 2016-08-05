import template from './chart-legend.html';
import Disposable from 'disposable';
import { formatSize } from 'utils';

class ChartLegendViewModel extends Disposable{
    constructor({ items }) {
        super();

        this.items = items;
        this.formatSize = formatSize;
    }
}

export default {
    viewModel: ChartLegendViewModel,
    template: template
};
