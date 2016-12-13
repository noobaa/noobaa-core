import template from './bar-chart.html';
import Disposable from 'disposable';
import ko from 'knockout';
import style from 'style';
import { deepFreeze, echo, isFunction, clamp } from 'utils/core-utils';
import { formatSize } from 'utils/string-utils';
import numeral from 'numeral';

const height = 168;
const minWidth = 168;
const gutter = 19;
const barWidth = 45;
const maxBarHeight = height - 2 * gutter;
const minBarHeight = 2;

const labelFont = `${style['font-size1']} ${style['font-family1']}`;
const underlineColor = style['color7'];
const valueColor = style['color6'];
const labelColor = style['color6'];
const backgroundColor = style['color7'];

const defaultOptions = deepFreeze({
    values: false,
    labels: false,
    underline: true,
    background: false,
    format: 'none',
    spacing: gutter / 2
});

const namedFormats = deepFreeze({
    none: echo,
    size: formatSize,
    percentage: value => numeral(value).format('%')
});

class BarChartViewModel extends Disposable{
    constructor({ values, options = {} }) {
        super();
        this.values = values;
        this.options = Object.assign({}, defaultOptions, options);

        this.canvasWidth = this.calcCanvasWidth(values.length, this.options.spacing);
        this.canvasHeight = height;

        const { format = 'none' } = options;
        this.format = isFunction(format) ? options.format : namedFormats[format];

        const max = ko.pureComputed(
            () => this.options.scale || values.reduce(
                (max, { value }) => Math.max(max, ko.unwrap(value)),
                0
            )
        );

        this.normalized = values.map(
            ({ value }) => ko.pureComputed(
                () => {
                    if (ko.unwrap(value) === 0) {
                        return 0;
                    }

                    return clamp(
                        ko.unwrap(value) / max(),
                        minBarHeight / maxBarHeight,
                        1
                    );
                }
            )
            .extend({
                tween: {
                    resetOnChange: true,
                    resetValue: 0
                }
            })
        );
    }

    calcCanvasWidth(barCount, spacing) {
        return Math.max(
            minWidth,
            (barWidth + spacing) * barCount - spacing + 2 * gutter
        );
    }

    draw(ctx) {
        const options = this.options;
        const contentWidth = (barWidth + options.spacing) * this.values.length - options.spacing;
        const left = (this.canvasWidth - contentWidth) / 2;

        this.normalized.reduce(
            (offset, size, i) => {
                const { color, label, value } = this.values[i];
                const top = gutter + (1 - size()) * maxBarHeight + .5|0;

                if (options.background) {
                    this.drawBar(ctx, offset, gutter, backgroundColor);
                }

                this.drawBar(ctx, offset, top, color);

                if (options.values) {
                    this.drawValue(ctx, offset, top, ko.unwrap(value));
                }

                const nakedLabel = ko.unwrap(label);
                if (options.labels && nakedLabel) {
                    this.drawLabel(ctx, offset, nakedLabel);
                }

                return offset += barWidth + options.spacing;
            },
            left
        );

        if (options.underline) {
            this.drawUnderline(ctx);
        }
    }

    drawValue(ctx, left, top, value) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = valueColor;
        ctx.font = labelFont;

        ctx.fillText(
            this.format(value),
            left + barWidth / 2 + .5|0,
            top - 2,
            barWidth
        );
    }

    drawBar(ctx, left, top, color) {
        const height = gutter + maxBarHeight - top;
        ctx.fillStyle = color;
        ctx.fillRect(left, top, barWidth, height);
    }

    drawLabel(ctx, left, text) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = labelColor;
        ctx.font = labelFont;

        ctx.fillText(
            text,
            left + barWidth / 2 + .5|0,
            1.3 * gutter + maxBarHeight
        );
    }

    drawUnderline(ctx) {
        ctx.fillStyle = underlineColor;
        ctx.fillRect(0, this.canvasHeight - gutter, this.canvasWidth, 1);
    }
}

export default {
    viewModel: BarChartViewModel,
    template: template
};
