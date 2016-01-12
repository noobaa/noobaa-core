import template from './bar.html';
import ko from 'knockout';

const canvasWidth = 1000;
const canvasHeight = 10;

class BarViewModel {
	constructor({ values }) {
		this.canvasWidth = canvasWidth;
		this.canvasHeight = canvasHeight;
		this.values = values;	
	}

	draw(ctx, { width, height }) {
		let values = ko.unwrap(this.values);
		let total = values.reduce(
			(sum, item) => sum + item.value,
			0
		);
		let pos = 0;

		ctx.clearRect(0, 0, width, height);
		values.forEach(
			item => {
				let w = item.value / total * width;
				ctx.fillStyle = item.color;
				ctx.fillRect(pos, 0, w, height);
				pos += w
			}
		);
	}
}

export default {
	viewModel: BarViewModel,
	template: template
}