/* Copyright (C) 2016 NooBaa */

import template from './chart-legend.html';
import { echo, isObject } from 'utils/core-utils';
import { getFormatter } from 'utils/chart-utils';
import ko from 'knockout';

function _noramlizeTooltip(tooltip) {
    if (!tooltip) {
        return;

    } else if (isObject(tooltip)) {
        return {
            ...tooltip,
            position: 'after',
            align: 'center'
        };

    } else {
        return {
            text: tooltip,
            position: 'after',
            align: 'center'
        };
    }
}

class ChartLegendViewModel {
    constructor({
        caption = '',
        items,
        format = 'none'
    }) {
        this.caption = caption;
        this.formatter = getFormatter(format);
        this.items = ko.pureComputed(
            () => ko.unwrap(items).map(
                item => this.normalizeItem(item)
            )
        );
    }

    normalizeItem({ label, color, value, visible = true, disabled = false, tooltip }) {
        const toggable = ko.isWriteableObservable(disabled);
        const onToggle =  toggable ? () => disabled(!disabled()) : echo;

        return {
            label,
            style: { 'border-color': color },
            formattedValue: this.formatter(ko.unwrap(value) || 0),
            visible,
            css: { disabled, toggable },
            tooltip: _noramlizeTooltip(ko.unwrap(tooltip)),
            onToggle
        };
    }
}

export default {
    viewModel: ChartLegendViewModel,
    template: template
};
