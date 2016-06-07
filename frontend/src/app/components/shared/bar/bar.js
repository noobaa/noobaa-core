import template from './bar.html';
import ko from 'knockout';

class BarViewModel {
    constructor({ values }) {
        this.values = values;
    }

    draw(ctx, { width, height }) {
        let values = ko.unwrap(this.values);
        let total = values.reduce(
            (sum, item) => sum + ko.unwrap(item.value),
            0
        );
        let pos = 0;

        ctx.clearRect(0, 0, width, height);
        values.forEach(
            item => {
                let w = (ko.unwrap(item.value) / total * width) + .5 | 0;
                ctx.fillStyle = ko.unwrap(item.color);
                ctx.fillRect(pos, 0, w, height);
                pos += w;
            }
        );
    }
}

export default {
    viewModel: BarViewModel,
    template: template
};
