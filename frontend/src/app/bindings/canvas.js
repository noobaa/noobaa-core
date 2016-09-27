import ko from 'knockout';
import { noop } from 'utils';

export default {
    update: function(canvas, valueAccessor, allBindings, viewModel) {
        if (canvas.tagName.toUpperCase() !== 'CANVAS') {
            throw new Error('Invalid binding target');
        }

        let {
            draw = noop,
            width = canvas.width,
            height = canvas.height
        } = valueAccessor();

        canvas.width = width;
        canvas.height = height;

        draw.call(
            viewModel,
            canvas.getContext('2d'),
            { width: ko.unwrap(width), height: ko.unwrap(height)
        });
    }
};
