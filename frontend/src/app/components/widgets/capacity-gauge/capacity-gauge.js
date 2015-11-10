import template from './capacity-gauge.html';
import ko from 'knockout';
import mapper from 'knockout-mapping';

const radius = 98;
const lineWidth = 4;
const emphasiseWidth = 19;
const lineMargin = 3;

class CapacityGaugeViewModel {
	constructor(canvas, params) {
		canvas.width = radius * 2;
		canvas.height = radius * 2;
		this.ctx = canvas.getContext('2d');

		this.legend = params.legend;
		this.parts = ko.pureComputed(() => mapper.toJS(params.values || []));
		this.subscription = this.parts.subscribe(values => this.render());
		this.render();
	}

	dispose() {
		this.subscription.dispose();
	}

	render() {
		let parts = this.parts();
		let offset = 0		
		let total = parts.reduce((sum, { value }) => sum + value, 0);

		this.clear();

		for(let i = 0, l = parts.length; i < l; ++i) {
			this.renderPart(parts[i], offset, total);
			offset += parts[i].value / total;
		}
	}

	clear() {
		let { width, height } = this.ctx.canvas;
		this.ctx.clearRect(0, 0, width, height);
	}

	renderPart(part, start, total) {
		let ctx = this.ctx;
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
}

function createViewModel(params, componentInfo) {
	let element = componentInfo.element;
	let canvas = element.getElementsByTagName('canvas')[0];

	if (canvas == null) {
		throw new Error('Invalid canvas element');
	}

	return new CapacityGaugeViewModel(canvas, params);
}

export default {
	viewModel: { createViewModel },
	template: template
};