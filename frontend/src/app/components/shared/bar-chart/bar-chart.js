import template from './bar-chart.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import style from 'style';
import { deepFreeze, echo, isFunction, clamp, isString } from 'utils/core-utils';
import { formatSize } from 'utils/size-utils';
import numeral from 'numeral';

const height = 168;
const minWidth = 168;
const gutter = 19;
const barWidth = 45;
const maxBarHeight = height - 2.2 * gutter;
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

class BarChartViewModel extends BaseViewModel {
    constructor({ values, options = {} }) {
        super();

        this.values = ko.pureComputed(
            () => ko.deepUnwrap(values)
        );

        // Normalize the options
        this.options = ko.pureComputed(
            () => Object.assign(
                {},
                defaultOptions,
                ko.deepUnwrap(options)
            )
        );

        this.canvasWidth = ko.pureComputed(
            () => this.calcCanvasWidth(this.values().length, this.options().spacing)
        );

        this.canvasHeight = height;

        this.normalized = ko.pureComputed(
            () => {
                const max = this.options().scale || this.values().reduce(
                    (max, { value }) => Math.max(max, value),
                    0
                );

                return this.values().map(
                    ({ value }) => ko.pureComputed(
                        () => {
                            if (value === 0) {
                                return 0;
                            }

                            return clamp(value / max, minBarHeight / maxBarHeight, 1);
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
        );
    }

    format(value) {
        const { format = 'none' } = this.options();
        const formatter = isFunction(format) ? format : namedFormats[format];
        return formatter(value);
    }

    calcCanvasWidth(barCount, spacing) {
        return Math.max(
            minWidth,
            (barWidth + spacing) * barCount - spacing + 2 * gutter
        );
    }

    draw(ctx) {
        const options = this.options();
        const values = this.values();
        const contentWidth = (barWidth + options.spacing) * values.length - options.spacing;
        const left = (this.canvasWidth() - contentWidth) / 2;
        const bgColor = isString(options.background) ?
            options.background :
            backgroundColor;

        this.normalized().reduce(
            (offset, size, i) => {
                const { color, label, value } = values[i];
                const top = gutter + (1 - size()) * maxBarHeight + .5|0;

                if (options.background) {
                    this.drawBar(ctx, offset, gutter, bgColor);
                }

                this.drawBar(ctx, offset, top, color);

                if (options.values) {
                    this.drawValue(ctx, offset, top, value);
                }

                if (options.labels && label) {
                    this.drawLabel(ctx, offset, label);
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
        ctx.fillRect(0, gutter + maxBarHeight, this.canvasWidth(), 1);
    }
}

export default {
    viewModel: BarChartViewModel,
    template: template
};
