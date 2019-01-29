/* Copyright (C) 2016 NooBaa */

import template from './counter.html';
import ko from 'knockout';
import { getFormatter } from 'utils/chart-utils';

class CounterViewModel  {
    constructor(params) {
        const { label, color = '', value, format, tween = true } = params;
        const formatter = getFormatter(format);
        const pureValue = ko.pureComputed(() =>
            ko.unwrap(value) || 0
        ).extend(tween ? {
            tween: { useDiscreteValues: true }
        } : {});

        this.label = label;
        this.color = ko.pureComputed(() =>
            ko.unwrap(color)
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
