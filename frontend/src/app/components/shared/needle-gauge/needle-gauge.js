import template from './needle-gauge.html';
import ko from 'knockout';
import numeral from 'numeral';
import style from 'style';

const radius = 98;
const canvasWidth = radius * 2;
const canvasHeight = radius * 2;
const lineWidth = 4;
const outlineColor = style['gray-lv5'];

const overflowWidth = 19;
const overflowMargin = 3;
const overflowOutlineColor = style['red-dark'];
const overflowBarColor = style['red-dark'];

const needleBaseRadius = 10;
const needleThickness = lineWidth;
const needlelength = radius - 11;
const needleColor = style['gray-lv6'];

const textFont = `${style['font-size-large']} ${style['font-type2']} Arial`;
const textColor = style['gray-lv6'];

class NeedleGaugeViewModel {
    constructor({ value, threshold, scale = 1  }) {
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.threshold = threshold;

        this.limit = ko.pureComputed(
            () => ko.unwrap(threshold) * (ko.unwrap(scale) < 1 ? 1 : ko.unwrap(scale))
        );

        let tweened = ko.pureComputed(
            () => ko.unwrap(value)
        ).extend({ tween: { resetValue: 0 } });

        this.text = ko .pureComputed(
            () => numeral(tweened() | 0).format('0,0')
        );

        this.clippedValue = ko.pureComputed(
            () => this._clipValue(tweened())
        );
    }

    draw(ctx, { width, height }) {
        ctx.translate(radius, radius);
        ctx.clearRect(-radius, -radius, radius * 2, radius * 2);

        this._drawOutline(ctx);
        this._drawOverflow(ctx);
        this._drawNeedle(ctx, this.clippedValue());
        this._drawText(ctx, this.text());
    }

    _drawOutline(ctx)  {
        ctx.strokeStyle = outlineColor;
        
        ctx.beginPath();
        ctx.lineWidth = lineWidth;
        ctx.arc(0, 0, radius - (lineWidth/2|0), this._toAngle(0), this._toAngle(1));
        ctx.stroke();
        ctx.closePath();
    }

    _drawOverflow(ctx) {
        let ratio = ko.unwrap(this.threshold) / ko.unwrap(this.limit);

        ctx.strokeStyle = overflowOutlineColor;
        ctx.beginPath();
        ctx.lineWidth = lineWidth;
        ctx.arc(0, 0, radius - (lineWidth/2|0), this._toAngle(ratio), 
                this._toAngle(1));
        ctx.stroke();
        ctx.closePath();

        ctx.strokeStyle = overflowBarColor;        
        ctx.beginPath()
        ctx.lineWidth = overflowWidth;
        ctx.arc(0, 0, radius - (lineWidth + overflowMargin + overflowWidth / 2 | 0), 
            this._toAngle(ratio), this._toAngle(1));
        ctx.stroke();        
        ctx.closePath();    

    }

    _drawNeedle(ctx, value) {
        ctx.save();
        
        ctx.strokeStyle = needleColor;
        
        ctx.beginPath()
        ctx.lineWidth = overflowWidth;
        ctx.arc(0, 0, needleBaseRadius, 0, 2 * Math.PI);
        ctx.stroke();        
        ctx.closePath();

        ctx.beginPath();
        ctx.lineWidth = needleThickness;
        ctx.rotate(this._toAngle(value));
        ctx.moveTo(0, 0);
        ctx.lineTo(needlelength, 0);
        ctx.stroke();
        ctx.closePath();

        ctx.restore();
    }

    _drawText(ctx, text) {
        ctx.fillStyle = textColor;
        ctx.font = textFont;
        ctx.fillText(text, -ctx.measureText(text).width / 2, radius * 3/4);
    }

    _clipValue(value){
        let limit = ko.unwrap(this.limit);
        return Math.min(Math.max(0, ko.unwrap(value)), limit) / limit;
    }

    _toAngle(value) {
        return (value * 1.5 + .75) * Math.PI;
    }
}

export default {
    viewModel: NeedleGaugeViewModel,
    template: template
}