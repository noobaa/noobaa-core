/* Copyright (C) 2016 NooBaa */

import template from './gauge-chart.html';
import ko from 'knockout';
import { getFormatter } from 'utils/chart-utils';
import { tween } from 'shifty';

const { PI, cos, sin } = Math;

class GaugeChartViewModel {
    sub = null;
    label = ko.observable();
    value = 0;
    formattedValue = ko.observable();
    path = ko.observable();

    constructor(params) {
        this.sub = ko.computed(() =>
            this.onParams(ko.deepUnwrap(params))
        );
    }

    onParams(params) {
        const {
            scale = 1,
            value = 0,
            format,
            label
        } = params;

        const formatter = getFormatter(format);
        const lastValue = this.value;

        ko.assignToProps(this, {
            label,
            value
        });

        tween({
            from: { value: lastValue },
            to: { value: value },
            duration: 1000,
            easing: 'easeOutQuad',
            attachment: { scale, formatter },
            step: this.onTweenStep.bind(this)
        });
    }

    onTweenStep(step, attachment) {
        const { value } = step;
        const { scale, formatter } = attachment;
        const ratio = Math.min(scale > 0 ? value / scale : 0, 1);
        const angle = (1 + ratio) * PI;
        ko.assignToProps(this, {
            formattedValue: formatter(value),
            path: `path("M-1 0 A1 1 0 0 1 ${cos(angle)} ${sin(angle)}")`
        });
    }

    dispose() {
        this.sub && this.sub.dispose();
    }
}

export default {
    viewModel: GaugeChartViewModel,
    template: template
};
