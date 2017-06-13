/* Copyright (C) 2016 NooBaa */

import template from './chart-legend.html';
import BaseViewModel from 'components/base-view-model';
import { echo, deepFreeze, isFunction } from 'utils/core-utils';
import { formatSize } from 'utils/size-utils';
import ko from 'knockout';

const namedFormats = deepFreeze({
    none: echo,
    size: formatSize
});

class ChartLegendViewModel extends BaseViewModel {
    constructor({
        caption = '',
        items,
        format = 'none'
    }) {
        super();

        this.caption = caption;
        this.formatter = isFunction(format) ? format : namedFormats[format];

        this.items = ko.pureComputed(
            () => ko.unwrap(items).map(
                item => this.normalizeItem(item)
            )
        );

    }

    normalizeItem({ label, color, value, visible = true, icon }) {
        const formattedValue = this.formatter(ko.unwrap(value));
        const style = { 'border-color': color };

        return { label, style, formattedValue, visible, icon };
    }

}

export default {
    viewModel: ChartLegendViewModel,
    template: template
};
