import template from './p2p-form.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';
import { makeRange } from 'utils/all';
import { updateP2PSettings } from 'actions';

const [ SINGLE_PORT, PORT_RANGE ] = makeRange(2);

const portOptions = [
    { label: 'Single Port', value: SINGLE_PORT },
    { label: 'Port Range', value: PORT_RANGE }
];

class P2PFormViewModel extends Disposable {
    constructor({ isCollapsed }) {
        super();

        this.isCollapsed = isCollapsed;
        this.portOptions = portOptions;

        let ports = ko.pureComputed(
            () => (systemInfo() && systemInfo().n2n_config.tcp_permanent_passive)
        );

        this.portType = ko.observableWithDefault(
            () => ports() && (ports().port ? SINGLE_PORT : PORT_RANGE)
        );

        this.usingSinglePort = this.portType.is(SINGLE_PORT);
        this.usingPortRange = this.portType.is(PORT_RANGE);

        this.rangeMin = ko.observableWithDefault(
            () => ports() && (ports().min || ports().port)
        )
            .extend({ min: 1 });

        this.rangeMax = ko.observableWithDefault(
            () => ports() && (ports().max || ports().port)
        )
            .extend({ min: this.rangeMin });

        this.ports = ko.pureComputed(
            () => this.rangeMin() + (this.usingPortRange() ? ` - ${this.rangeMax()}` : '')
        );

        this.errors = ko.validation.group([
            this.rangeMin,
            this.rangeMax
        ]);

        this.errorMessage = ko.pureComputed(
            () => this.errors()[0]
        );
    }

    applyChanges() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            updateP2PSettings(
                parseInt(this.rangeMin()),
                parseInt(this.rangeMax())
            );
        }
    }
}

export default {
    viewModel: P2PFormViewModel,
    template: template
};
