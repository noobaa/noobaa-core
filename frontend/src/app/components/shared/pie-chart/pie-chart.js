/* Copyright (C) 2016 NooBaa */

import template from './pie-chart.html';
import ko from 'knockout';
import {  makeArray, deepFreeze, decimalRound } from 'utils/core-utils';
import style from 'style';

const radius = 84;
const lineWidth = 20;
const separator = (2 * Math.PI) / 1000;
const threshold = 2 * separator;
const silhouetteColor = style['color1'];
const changeResilience = 3;

const primaryTextStyle = deepFreeze({
    font: `${style['font-family1']}` ,
    size: style['font-size5'],
    weight: style['font-thin'],
    color: style['color6']
});

const secondaryTextStyle = deepFreeze({
    font: style['font-family1'],
    size: style['font-size3'],
    weight: style['font-regular'],
    color: style['color7']
});

function normalizeValues(values) {
    const sum = values.reduce(
        (sum, value) => sum + value
    );

    const thresholdSize = threshold * sum;
    const { delta, overhead } = values.reduce(
        ({ delta = 0, overhead = 0 }, value) => {
            if(value > 0){
                value < thresholdSize ?
                    delta += thresholdSize - value :
                    overhead += value - thresholdSize;
            }

            return { delta, overhead };
        },
        {}
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
        primaryText = '',
        secondaryText = ''
    }) {
        this.canvasWidth = this.canvasHeight = radius * 2;
        this.primaryText = primaryText;
        this.secondaryText = secondaryText;

        this.colors = ko.pureComputed(
            () => values.map(
                entry => entry.color
            )
        );

        this.total = ko.pureComputed(
            () => values.reduce(
                (sum, entry) => sum + ko.unwrap(entry.value),
                0
            )
        );

        const normalized = ko.pureComputed(
            () => normalizeValues(
                values.map(
                    entry => ko.unwrap(entry.value)
                )
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
    }

    draw(ctx) {
        ctx.translate(radius, radius);
        this.drawGraph(ctx);
        this.drawText(ctx, this.primaryText, primaryTextStyle);
        this.drawText(ctx, this.secondaryText, secondaryTextStyle, parseInt(primaryTextStyle.size));
    }

    drawGraph(ctx) {
        ctx.save();

        ctx.rotate(Math.PI / 1.3);
        this.drawArc(ctx, 0, 1, silhouetteColor);

        const colors = this.colors();
        const hasSeparator = this.values.filter(value => value() > 0).length > 1;
        this.values.reduce(
            (offset, ratio, i) => {
                const len = hasSeparator ? Math.max(ratio() - separator, 0): ratio();
                if (len > 0) {
                    this.drawArc(ctx, offset, offset + len, colors[i]);
                }
                return offset + ratio();
            },
            0
        );

        ctx.restore();
    }

    drawArc(ctx, start, end, color) {
        const r = radius - (lineWidth / 2 | 0);
        const sAngle = start * 2  * Math.PI;
        const eAngle = end * 2 * Math.PI;

        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, r, sAngle, eAngle);
        ctx.stroke();
        ctx.closePath();
    }

    drawText(ctx, text, { font, size, weight, color }, offsetY = 0) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${weight} ${size} ${font}`;
        ctx.fillStyle = color;
        ctx.fillText(ko.unwrap(text), 0, offsetY);
        ctx.restore();
    }
}

export default {
    viewModel: PieChartViewModel,
    template: template
};
