/* Copyright (C) 2016 NooBaa */

import template from './counter.html';
import ko from 'knockout';
import { getFormatter } from 'utils/chart-utils';
import style from 'style';

function _getColor(color) {
    return color[0] === '@' ?
        style[color.slice(1)] :
        color;
}

class CounterViewModel  {
    constructor({ label, color, value, format }) {
        const formatter = getFormatter(format);
        const pureValue = ko.pureComputed(() =>
            ko.unwrap(value) || 0
        ).extend({
            tween: { useDiscreteValues: true }
        });

        this.label = label;
        this.color = ko.pureComputed(() =>
            _getColor(ko.unwrap(color))
        );
        this.value = ko.pureComputed(() =>
            formatter(pureValue())
        );
    }
}

export default {
    viewModel: CounterViewModel,
    template: template
};
