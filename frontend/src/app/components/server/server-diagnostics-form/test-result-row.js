import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils/core-utils';

const icons = deepFreeze({
    success: {
        name: 'healthy',
        css: 'success'
    },
    problem: {
        name: 'problem',
        css: 'error'
    }
});

export default class TestResultRowViewModel extends Disposable {
    constructor(server, testResults) {
        super();

        this.result = ko.pureComputed(
            () => {
                if (!server()) {
                    return '';
                }

                const { status, secret } = server();
                if (status !== 'CONNECTED') {
                    return Object.assign(
                        { tooltip: 'Server not connected' },
                        icons.problem
                    );

                } else if (testResults()[secret] !== 'OPERATIONAL') {
                    return Object.assign(
                        { tooltip: 'Cannot communicate with server' },
                        icons.problem
                    );

                } else {
                    return Object.assign(
                        { tooltip: 'Test completed successfully' },
                        icons.success
                    );
                }
            }
        );

        this.name = ko.pureComputed(
            () => {
                const masterSecret = systemInfo() && systemInfo().cluster.master_secret;
                const { secret, hostname } = server() || {};
                return server() ?
                    `${hostname}-${secret} ${secret === masterSecret ? '(Master)' : ''}` :
                    '';
            }
        );

        this.address = ko.pureComputed(
            () => server() && server().address
        );
    }
}
