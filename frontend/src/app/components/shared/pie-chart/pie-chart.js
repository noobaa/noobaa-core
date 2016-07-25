import template from './pie-chart.html';
import Disposable from 'disposable';
import ko from 'knockout';
import style from 'style';

const radius = 84;
const lineWidth = 30;
const seperator = (2 * Math.PI) / 1000;
const threshold = 2 * seperator;

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
    constructor({ values }) {
        super();

        this.canvasWidth = this.canvasHeight = radius * 2;

        this.colors = ko.pureComputed(
            () => values.map(
                entry => entry.color
            )
        );

        this.values = ko.pureComputed(
            () => normalizeValues(
                    values.map(
                        entry => ko.unwrap(entry.value)
                    )
                ).map(
                    value => ko.pureComputed(
                        () => value
                    ).extend({
                        tween: {
                            resetOnChange: true,
                            resetValue: 0
                        }
                    })
                )
        );
    }

    draw(ctx) {
        ctx.translate(radius, radius);
        ctx.rotate(Math.PI / 1.3);
        this.drawArc(ctx, 0, 1, style['bg-color1']);

        let colors = this.colors();
        this.values().reduce(
            (offset, ratio, i) => {
                let len = Math.max(ratio() - seperator, 0);
                if (len > 0) {
                    this.drawArc(ctx, offset, offset + len, colors[i]);
                }
                return offset + ratio();
            },
            0
        );
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
}

export default {
    viewModel: PieChartViewModel,
    template: template
};
