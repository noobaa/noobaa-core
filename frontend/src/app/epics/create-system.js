/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { CREATE_SYSTEM } from 'action-types';
import { completeCreateSystem, failCreateSystem } from 'action-creators';
import { defaultTheme } from 'config';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(CREATE_SYSTEM),
        mergeMap(async action => {
            const {
                ownerEmail,
                password,
                systemName,
                dnsName,
                //dnsServers, //Should be introduced back after Issue #2469
                timeConfig
            } = action.payload;

            try {
                const { token } = await api.system.create_system({
                    name: systemName,
                    email: ownerEmail,
                    password: password,
                    dns_name: dnsName,
                    //dns_servers: dnsServers, //Should be introduced back after Issue #2469
                    time_config: timeConfig
                });

                return completeCreateSystem(systemName, ownerEmail, token, defaultTheme);

            } catch (error) {
                return failCreateSystem(mapErrorObject(error));
            }
        })
    );
}
