import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';

export default class TestRowViewModel extends Disposable {
    constructor(result) {
        super();

        this.test = ko.pureComputed(
            () => result() ? result().testType : ''
        );

        this.targetNode = ko.pureComputed(
            () => {
                if (!result) {
                    return;
                }

                let { targetName } = result();
                return { text: targetName, tooltip: targetName };
            }
        );

        this.protocol = ko.pureComputed(
            () => result() ? result().protocol.toUpperCase() : ''
        );

        this.time = ko.pureComputed(
            () => result() ? `${(result().time / 1000).toFixed(2)} seconds` : ''
        );

        this.stateClass = ko.pureComputed(
            () => result() ? result().state.toLowerCase() : ''
        );

        this.speed = ko.pureComputed(
            () => {
                if (!result()) {
                    return '';
                }

                return `${
                    (result().speed * 1000 / Math.pow(1024, 2)).toFixed(1)
                } MB/s`;
            }
        );

        this.progress = ko.pureComputed(
            () => {
                if (!result()) {
                    return {};
                }

                let { state, progress } = result();
                return {
                    css: state.toLowerCase(),
                    text: state === 'RUNNING' ? numeral(progress).format('0%') : state.toLowerCase()
                };
            }
        );
    }
}
