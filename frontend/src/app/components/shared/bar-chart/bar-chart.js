import template from './bar-chart.html';
import Disposable from 'disposable';
import ko from 'knockout';
import style from 'style';
import { formatSize } from 'utils';

const height = 168;
const width = 168;
const gutter = 19;
const barSpacing = 4;
const barWidth = 45;
const maxBarHeight = height - 2 * gutter;
const minBarHeight = 2;

const underlineColor = style['color7'];
const labelFont = `${style['font-size1']} ${style['font-family1']}`;
const valueColor = style['color'];

class BarChartViewModel extends Disposable{
    constructor({ values, drawValues = false, drawLabels = false }) {
        super();
        this.canvasWidth =  width;
        this.canvasHeight = height;

        this.values = values;
        this.drawValues = drawValues;
        this.drawLabels = drawLabels;

        let max = ko.pureComputed(
            () => values.reduce(
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

                    return Math.max(
                        ko.unwrap(value) / max(),
                        minBarHeight / maxBarHeight
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

    draw(ctx) {
        let contentWidth = (barWidth + barSpacing) * this.values.length - barSpacing;
        let left = (this.canvasWidth - contentWidth) / 2;

        this.normalized.reduce(
            (offset, size, i) => {
                let { color, label, value } = this.values[i];
                let top = gutter + (1 - size()) * maxBarHeight + .5|0;

                if (this.drawValues) {
                    this.drawValue(ctx, offset, top, ko.unwrap(value));
                }

                this.drawBar(ctx, offset, top, color);

                if (this.drawLabels && label) {
                    this.drawLabel(ctx, offset, label, color);
                }

                return offset += barWidth + barSpacing;
            },
            left
        );

        this.drawUnderline(ctx);
    }

    drawValue(ctx, left, top, value) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = valueColor;
        ctx.font = labelFont;

        ctx.fillText(
            formatSize(value),
            left + barWidth / 2 + .5|0,
            top - 2,
            barWidth
        );
    }

    drawBar(ctx, left, top, color) {
        let height = gutter + maxBarHeight - top;
        ctx.fillStyle = color;
        ctx.fillRect(left, top, barWidth, height);
    }

    drawLabel(ctx, left, text, color) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = color;
        ctx.font = labelFont;

        ctx.fillText(
            text,
            left + barWidth / 2 + .5|0,
            gutter + maxBarHeight + 2,
            barWidth
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
