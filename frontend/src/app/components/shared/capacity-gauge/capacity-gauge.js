import template from './capacity-gauge.html';
import ko from 'knockout';
import style from 'style';

const radius = 98;
const lineWidth = 4;
const emphasiseWidth = 19;
const lineMargin = 3;

class CapacityGaugeViewModel {
	constructor({ legend, values }) {
		this.legend = legend;
		this.values = values;
		this.canvasWidth = radius * 2;
		this.canvasHeight = radius * 2;		
	}

	draw(ctx, { width, height }) {
		let parts = ko.unwrap(this.values);
		let offset = 0		
		let total = parts.reduce((sum, { value }) => sum + value, 0);

		ctx.clearRect(0, 0, width, height);
		for(let i = 0, l = parts.length; i < l; ++i) {
			this._drawPart(ctx, parts[i], offset, total);
			offset += parts[i].value / total;
		}

		this._drawPercentage(ctx, 0/0);
	}

	_drawPart(ctx, part, start, total) {
		let { value, color, emphasise } = part;
		let end = start + value/total;

		ctx.strokeStyle = color;
		ctx.beginPath();
		ctx.lineWidth = lineWidth;
		ctx.arc(radius, radius, radius - (lineWidth/2|0), (start + .5) * 1.5 * Math.PI, (end + .5) * 1.5 * Math.PI);
		ctx.stroke();
		ctx.closePath();			

		if (emphasise) {
			ctx.beginPath();
			ctx.lineWidth = emphasiseWidth;
			ctx.arc(radius, radius, radius - (lineWidth + lineMargin + emphasiseWidth / 2 | 0), (start + .5) * 1.5 * Math.PI, (end + .5) * 1.5 * Math.PI);
			ctx.stroke();
			ctx.closePath();				
		}		
	}

	_drawPercentage(ctx, percentage) {
		let text = Number.isNaN(percentage) ? 'N/A' : `${percentage}%`;

		// Set timeout to allow the font-face to load before drawing the text.
		setTimeout(() => {
			ctx.fillStyle = style['text-color4'];
			ctx.font = `${style['font-size-large']} ${style['font-type2']} Arial`;
			ctx.fillText(text, radius - ctx.measureText(text).width / 2 | 0, radius);	
		}, 10)
		
	}
}

export default {
	viewModel: CapacityGaugeViewModel,
	template: template
};