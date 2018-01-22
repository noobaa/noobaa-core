import ko from 'knockout';
import { tween } from 'shifty';

export default class BarViewModel {
    constructor(color) {
        this.color = color;
        this.height = ko.observable();
        this.onStep = this.onStep.bind(this);
    }

    onState(height, animate) {
        const lastHeight = this.height() || 0;

        if (animate) {
            tween({
                duration: 1000,
                delay: 350,
                easing: 'easeOutQuad',
                step: this.onStep,
                from: { val: lastHeight },
                to: { val: height }
            });
        } else {
            this.height(height);
        }
    }

    onStep({ val }) {
        this.height(val);
    }
}

