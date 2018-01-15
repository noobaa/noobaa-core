import ko from 'knockout';
import { tween } from 'shifty';

export default class BarViewModel {
    constructor(color) {
        this.color = color;
        this.height = ko.observable();
        this.onStep = this.onStep.bind(this);
    }

    onState(height) {
        const lastHeight = this.height() || 0;
        tween({
            duration: 1000,
            easing: 'easeOutQuad',
            step: this.onStep,
            from: { val: lastHeight },
            to: { val: height }
        });
    }

    onStep({ val }) {
        this.height(val);
    }
}

