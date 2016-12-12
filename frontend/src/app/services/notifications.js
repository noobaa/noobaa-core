export function alert(req) {
    console.log('ALERT', req.rpc_params);
}


export function notify_on_system_store({
    rpc_params
}) {
    console.log('ON_SYSTEM_STORE', rpc_params.event);
}
