import template from './pie-chart.html';
import Disposable from 'disposable';
import ko from 'knockout';
import {  makeArray, deepFreeze } from 'utils';
import style from 'style';

const radius = 84;
const lineWidth = 30;
const seperator = (2 * Math.PI) / 1000;
const threshold = 2 * seperator;
const silhouetteColor = style['bg-color1'];

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
    let sum = values.reduce(
        (sum, value) => sum + value
    );

    let ratios = values.map(
        value => value / sum
    );

    let underThreshold = ratios
        .filter(
            ratio => 0 < ratio && ratio < threshold
        )
        .length;

    return ratios.map(
        ratio => {
            if (ratio == 0) {
                return 0;

            } else if (ratio < threshold) {
                return threshold;

            } else  {
                return ratio * (1 - threshold * underThreshold);
            }
        }
    );
}

class PieChartViewModel extends Disposable{
    constructor({ values, primaryText = '', secondaryText = '' }) {
        super();

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

        let normalized = ko.pureComputed(
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

        let colors = this.colors();
        this.values.reduce(
            (offset, ratio, i) => {
                let len = Math.max(ratio() - seperator, 0);
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
        let r = radius - (lineWidth / 2 | 0);
        let sAngle = start * 2  * Math.PI;
        let eAngle = end * 2 * Math.PI;

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
