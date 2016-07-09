import template from './quantity-gauge.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import numeral from 'numeral';
import style from 'style';

const radius = 98;
const canvasWidth = radius * 2;
const canvasHeight = radius * 2 - 30;
const lineWidth = 4;
const emphasiseWidth = 19;
const lineMargin = 3;
const emptyColor = style['text-color5'];

const textFont = `${style['font-size-xlarge']} ${style['font-type2']}`;
const textColor = style['gray-lv6'];

class CapacityGaugeViewModel extends BaseViewModel {
    constructor({ values }) {
        super();

        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.values = values;
        this.tweened = values.map(
            ({ value }) => ko.pureComputed(
                () => ko.unwrap(value)
            )
            .extend({ tween: { resetValue: 0, resetOnChange: true } })
        );
    }

    draw(ctx) {
        ctx.translate(radius, radius);
        ctx.clearRect(-radius, -radius, radius * 2, radius * 2);

        let total = ko.unwrap(this.values).reduce(
            (sum, { value }) => sum + ko.unwrap(value),
            0
        );

        if (total > 0) {
            let offset = 0;
            let sum = 0;
            this.values.forEach(
                (item, i) => {
                    let value = this.tweened[i]();
                    let ratio = value/total;
                    this._drawSection(ctx, offset, ratio, item.color, item.emphasize);
                    offset += ratio;
                    sum += item.emphasize ? value : 0;
                }
            );

            let percentage = sum/total;


            let text = 0 < percentage && percentage < 0.01 ?
                '<1%' :
                numeral(sum/total).format('0%');

            this._drawText(ctx, text);

        } else {
            this._drawSection(ctx, 0, 1, emptyColor);
            this._drawText(ctx, 'N/A');
        }
    }

    _drawSection(ctx, offset, size, color, emphasize) {
        let start =this._toAngle(offset);
        let end = this._toAngle(offset + size);

        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.lineWidth = lineWidth;
        ctx.arc(0, 0, radius - (lineWidth/2|0), start, end);
        ctx.stroke();
        ctx.closePath();

        if (emphasize) {
            ctx.beginPath();
            ctx.lineWidth = emphasiseWidth;
            ctx.arc(0, 0, radius - (lineWidth + lineMargin + emphasiseWidth / 2 | 0), start, end);
            ctx.stroke();
            ctx.closePath();
        }
    }

    _drawText(ctx, text) {
        ctx.fillStyle = textColor;
        ctx.font = textFont;
        ctx.fillText(text, -ctx.measureText(text).width / 2 | 0, 0);
    }

    _toAngle(value) {
        return (value * 1.5 + .75) * Math.PI;
    }

}

export default {
    viewModel: CapacityGaugeViewModel,
    template: template
};
