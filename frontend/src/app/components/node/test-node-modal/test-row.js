import ko from 'knockout';
import numeral from 'numeral';

export default class TestRowViewModel {
    constructor(result) {
        this.isVisible = ko.pureComputed(
            () => !!result()
        );

        this.test = ko.pureComputed(
            () => result() && result().testType
        );

        this.target = ko.pureComputed(
            () => result() && result().targetName
        );

        this.time = ko.pureComputed(
            () => result() && `${(result().time / 1000).toFixed(2)} seconds`
        );

        this.stateClass = ko.pureComputed(
            () => result() && result().state.toLowerCase()
        );

        this.speed = ko.pureComputed(
            () => result() && `${
                ( result().speed * 1000 / Math.pow(1024, 2) ).toFixed(1)
            } MB/s`
        );

        this.progress = ko.pureComputed(
            () => result() && (
                result().state === 'RUNNING' ?
                    numeral(result().progress).format('0%') :
                    result().state
                )
            );
    }
}
