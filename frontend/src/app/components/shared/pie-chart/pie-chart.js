/* Copyright (C) 2016 NooBaa */

import template from './pie-chart.html';
import ko from 'knockout';
import {  makeArray, decimalRound, sumBy, isDefined } from 'utils/core-utils';
import { getFormatter } from 'utils/chart-utils';

const { PI, max, cos, sin } = Math;
const separator = (2 * PI) / 1000;
const threshold = 2 * separator;
const changeResilience = 3;

function _normalizeValues(values) {
    const sum = sumBy(values);
    const thresholdSize = threshold * sum;
    const { delta, overhead } = values.reduce(
        (aggr, value) => {
            if (value > 0){
                if (value < thresholdSize) {
                    aggr.delta += thresholdSize - value;
                } else {
                    aggr.overhead += value - thresholdSize;
                }
            }
            return aggr;
        },
        { delta: 0, overhead: 0 }
    );

    let reminder = 0;
    return values.map(
        (value, i) => {
            if (value === 0) {
                return 0;
            }

            if (value <= thresholdSize) {
                return threshold;
            }

            const ratio = (value - (value - thresholdSize) * delta / overhead) / sum;
            if (i < values.length - 1) {
                const rounded = decimalRound(ratio, changeResilience);
                reminder += ratio - rounded;
                return rounded;

            } else {
                return decimalRound(ratio + reminder, changeResilience);
            }
        }
    );
}

class PieChartViewModel {
    constructor({
        values = [],
        sumLabel = '',
        format
    }) {

        const formatValue = getFormatter(format);

        this.sumValue = ko.pureComputed(() => {
            const sum = sumBy(values, entry => ko.unwrap(entry.value));
            return formatValue(sum);
        });

        this.sumLabel = sumLabel;

        this.colors = ko.pureComputed(
            () => values.map(
                entry => entry.color
            )
        );

        const normalized = ko.pureComputed(
            () => _normalizeValues(
                values.map(entry => ko.unwrap(entry.value) || 0)
            )
        );

        this.values = makeArray(
            values.length,
            i => ko.pureComputed(
                () => normalized()[i]
            ).extend({
                tween: {
                    resetOnChange: true,
                    resetValue: 0
                }
            })
        );

        this.segments = ko.pureComputed(() => {
            const hasSeparator = this.values.filter(value => value() > 0).length > 1;
            const colors = this.colors();

            let offset = 0;
            return this.values
                .map((ratio, i) => {
                    const len = hasSeparator ? max(ratio() - separator, 0): ratio();
                    if (len <= 0) {
                        return;
                    }

                    const start = offset * 2 * PI;
                    const end = (offset + len) * 2 * PI;
                    const d = `M${cos(start)} ${sin(start)} A1 1 0 ${len < .5 ? 0 : 1} 1 ${cos(end)} ${sin(end)}`;
                    const stroke = colors[i];
                    const value = ko.unwrap(values[i].value);
                    const label = ko.unwrap(values[i].label);
                    const formattedValue = isDefined(value) ? formatValue(value) : '';

                    offset += ratio();
                    return { d, stroke, formattedValue, label };
                })
                .filter(Boolean);
        });
    }
}

export default {
    viewModel: PieChartViewModel,
    template: template
};
