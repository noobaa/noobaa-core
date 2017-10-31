/* Copyright (C) 2016 NooBaa */

import template from './chart-legend.html';
import { echo, deepFreeze, isFunction } from 'utils/core-utils';
import { formatSize } from 'utils/size-utils';
import ko from 'knockout';

const namedFormats = deepFreeze({
    none: echo,
    size: formatSize
});

class ChartLegendViewModel {
    constructor({
        caption = '',
        items,
        format = 'none'
    }) {
        this.caption = caption;
        this.formatter = isFunction(format) ? format : namedFormats[format];
        this.items = ko.pureComputed(
            () => ko.unwrap(items).map(
                item => this.normalizeItem(item)
            )
        );
    }

    normalizeItem({ label, color, value, visible = true, disabled = false }) {
        const formattedValue = this.formatter(ko.unwrap(value) || 0);
        const style = { 'border-color': color };
        const toggable = ko.isWriteableObservable(disabled);
        const css = { disabled, toggable };
        const onToggle =  toggable ? () => disabled(!disabled()) : echo;

        return { label, style, formattedValue, visible, css, onToggle };
    }
}

export default {
    viewModel: ChartLegendViewModel,
    template: template
};
