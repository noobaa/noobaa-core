import template from './bar-chart.html';
import Disposable from 'disposable';
import ko from 'knockout';
import style from 'style';

const height = 168;
const width = 168;
const gutter = 19;
const barSpacing = 4;
const barWidth = 45;
const maxBarHeight = height - 2 * gutter;
const minBarHeight = 2;
const underlineColor = style['bg-color6'];

class BarChartViewModel extends Disposable{
    constructor({ values }) {
        super();
        this.canvasWidth =  width;
        this.canvasHeight = height;

        this.colors = values.map(
            ({ color }) => color
        );

        let max = ko.pureComputed(
            () => values.reduce(
                (max, { value }) => Math.max(max, ko.unwrap(value)),
                0
            )
        );

        this.values = values.map(
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

        this.values.reduce(
            (offset, size, i) => {
                this.drawBar(ctx, offset, size(), this.colors[i]);
                return offset += barWidth + barSpacing;
            },
            left
        );

        this.drawUnderline(ctx);
    }

    drawBar(ctx, offset, size, color) {
        let top = gutter + (1 - size) * maxBarHeight;
        let height = size * maxBarHeight;

        ctx.fillStyle = color;
        ctx.fillRect(offset, top +.5|0, barWidth, height + .5|0);
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
